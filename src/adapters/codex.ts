import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session, ToolCallEvent, TokenSample, CompactionEvent } from "../types.js";
import { findWslRoots } from "./wslRoots.js";

export function defaultCodexRoot(): string {
  return join(homedir(), ".codex", "sessions");
}

/** Recursively finds every rollout-*.jsonl file under ~/.codex/sessions/YYYY/MM/DD/. */
export function findCodexSessionFiles(root: string = defaultCodexRoot()): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...findCodexSessionFiles(full));
    } else if (entry.startsWith("rollout-") && entry.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

// Codex has (at least) two call shapes in the wild: a typed `function_call`
// with a JSON `arguments` string, and a `custom_tool_call` whose `input` is
// a raw JS snippet like `tools.exec_command({"cmd":"...", "workdir":"..."})`.
// Both get the same best-effort target extraction rather than two separate
// parsers per shape, since a missed target just means "not grouped", never
// a wrong grouping.
const TARGET_ARG_KEYS = ["path", "file_path", "pattern", "cmd", "command", "query", "url"];

function extractTargetFromArguments(argsRaw: string): string | undefined {
  try {
    const parsed = JSON.parse(argsRaw);
    if (parsed && typeof parsed === "object") {
      for (const key of TARGET_ARG_KEYS) {
        const value = (parsed as Record<string, unknown>)[key];
        if (typeof value === "string" && value.length > 0) return value;
      }
    }
  } catch {
    // Not JSON (e.g. a custom_tool_call's raw JS `input`) — fall through to regex.
  }
  for (const key of TARGET_ARG_KEYS) {
    const match = argsRaw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

const TITLE_MAX_CHARS = 200;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") {
      parts.push((block as Record<string, unknown>).text as string);
    }
  }
  return parts.join(" ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

function outputChars(output: unknown): number {
  if (typeof output === "string") return output.length;
  if (Array.isArray(output)) {
    return output.reduce((sum: number, item) => {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
        return sum + ((item as Record<string, unknown>).text as string).length;
      }
      return sum;
    }, 0);
  }
  return 0;
}

const CALL_TYPES = new Set(["function_call", "custom_tool_call"]);
const OUTPUT_TYPES: Record<string, string> = {
  function_call_output: "function_call",
  custom_tool_call_output: "custom_tool_call",
};

interface PendingCall {
  turnId: string;
  name: string;
  target: string | undefined;
  timestamp: string;
}

/**
 * Parses one Codex rollout-*.jsonl file into the normalized Session shape.
 * Every line is `{ timestamp, type, payload }`; the interesting inner types
 * (session_meta, token_count, function_call(_output), custom_tool_call(_output))
 * all live inside `payload`, keyed by call_id for call/output pairing.
 */
export function parseCodexSession(filePath: string): Session {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);

  let id = filePath;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let turnCount = 0;
  let isFork = false;
  // Codex has no dedicated title field (unlike Claude Code's ai-title
  // record) — derived from actual user messages instead: the first one as
  // a title, the most recent one as "what's this session doing right now".
  let title: string | undefined;
  let lastMessage: string | undefined;

  const toolCalls: ToolCallEvent[] = [];
  const tokenSamples: TokenSample[] = [];
  // Codex's own `compacted`/`context_compacted` records carry no
  // trigger/preTokens/postTokens (unlike Claude Code's compact_boundary) —
  // just the timestamp here, backfilled from the surrounding token_count
  // samples in a pass after the main loop, once every sample is collected.
  const compactionTimestamps: string[] = [];
  const pending = new Map<string, PendingCall>();
  let currentTurnId = "turn-0";
  let turnSeq = 0;

  for (const line of lines) {
    let record: { timestamp?: string; type?: string; payload?: Record<string, unknown> };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = record.timestamp ?? "";
    if (timestamp) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }

    const payload = record.payload;
    if (!payload) continue;

    if (record.type === "session_meta") {
      if (typeof payload.session_id === "string") id = payload.session_id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      // A subagent/forked session is its own entire rollout file here
      // (unlike Claude Code's nested subagents/ folder) — session_meta's
      // `source` carries a `subagent` key when it is one.
      const source = payload.source;
      if (source && typeof source === "object" && "subagent" in source) isFork = true;
      continue;
    }

    if (record.type === "event_msg") {
      const kind = payload.type;
      if (kind === "context_compacted") {
        compactionTimestamps.push(timestamp);
      } else if (kind === "task_started") {
        turnSeq += 1;
        currentTurnId = typeof payload.turn_id === "string" ? payload.turn_id : `turn-${turnSeq}`;
        turnCount += 1;
      } else if (kind === "token_count") {
        // Codex reports its own running session total directly — unlike
        // Claude Code, there's no need (or way) to reconstruct it from
        // per-turn deltas here. That's a genuinely different methodology
        // from claudeCode.ts's computed sum, so the two tools' "fresh
        // tokens" totals in a report are each internally consistent but
        // not a precise apples-to-apples comparison against each other.
        const info = payload.info as { total_token_usage?: { total_tokens?: number } } | undefined;
        const total = info?.total_token_usage?.total_tokens;
        if (typeof total === "number") tokenSamples.push({ timestamp, cumulativeTotal: total });
      }
      continue;
    }

    if (record.type !== "response_item") continue;
    const itemType = payload.type;
    if (typeof itemType !== "string") continue;

    if (itemType === "message" && payload.role === "user") {
      const text = extractText(payload.content);
      if (text) {
        title ??= truncate(text, TITLE_MAX_CHARS);
        lastMessage = truncate(text, TITLE_MAX_CHARS);
      }
      continue;
    }

    if (CALL_TYPES.has(itemType)) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      if (!callId) continue;
      const meta = payload.internal_chat_message_metadata_passthrough as { turn_id?: string } | undefined;
      const argsRaw =
        typeof payload.arguments === "string" ? payload.arguments : typeof payload.input === "string" ? payload.input : "";
      pending.set(callId, {
        turnId: meta?.turn_id ?? currentTurnId,
        name: typeof payload.name === "string" ? payload.name : itemType,
        target: extractTargetFromArguments(argsRaw),
        timestamp,
      });
      continue;
    }

    const callKind = OUTPUT_TYPES[itemType];
    if (callKind) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const call = callId ? pending.get(callId) : undefined;
      if (!call) continue;
      toolCalls.push({
        turnId: call.turnId,
        name: call.name,
        target: call.target,
        outputChars: outputChars(payload.output),
        timestamp: call.timestamp,
      });
      pending.delete(callId!);
    }
  }

  // Date.parse, not a raw string compare: real Codex timestamps are
  // consistently millisecond-precision ("...06.258Z"), but nothing
  // guarantees that everywhere, and a millisecond-less timestamp sorts
  // *after* a millisecond one as a plain string ("...06Z" > "...06.5Z"
  // lexicographically, despite being the same instant) — happy to compare
  // by string right up until two records disagree on precision.
  const compactions: CompactionEvent[] = compactionTimestamps.map((ts) => {
    const tsMs = Date.parse(ts);
    let preTokens: number | undefined;
    let postTokens: number | undefined;
    for (const sample of tokenSamples) {
      const sampleMs = Date.parse(sample.timestamp);
      if (Number.isNaN(sampleMs)) continue;
      if (sampleMs <= tsMs) preTokens = sample.cumulativeTotal;
      else if (postTokens === undefined) postTokens = sample.cumulativeTotal;
    }
    return { timestamp: ts, trigger: "unknown", preTokens, postTokens, durationMs: undefined };
  });

  return {
    id,
    tool: "codex",
    sourcePath: filePath,
    cwd,
    startedAt,
    endedAt,
    toolCalls,
    tokenSamples,
    compactions,
    turnCount,
    isFork,
    title,
    lastMessage,
  };
}

export function loadCodexSessions(
  root: string = defaultCodexRoot(),
  additionalRoots: string[] = findWslRoots([".codex", "sessions"]),
): Session[] {
  // Not deduped by session id — see claudeCode.ts's loader for why
  // (fork/subagent sessions can share an id with something else while
  // being genuinely separate). Path-level duplication across WSL UNC
  // prefixes is avoided upstream in findWslRoots instead.
  return [root, ...additionalRoots]
    .flatMap((r) => findCodexSessionFiles(r))
    .map((f) => {
      try {
        return parseCodexSession(f);
      } catch {
        return undefined;
      }
    })
    .filter((s): s is Session => !!s);
}
