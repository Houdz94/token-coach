import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Session, ToolCallEvent, TokenSample, CompactionEvent } from "../types.js";
import { findWslRoots } from "./wslRoots.js";

const TITLE_MAX_CHARS = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

export function defaultClaudeCodeRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/** Recursively finds every session transcript under ~/.claude/projects. */
export function findClaudeCodeSessionFiles(root: string = defaultClaudeCodeRoot()): string[] {
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
      out.push(...findClaudeCodeSessionFiles(full));
    } else if (entry.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

// The handful of input keys that name a file/pattern across the built-in
// tools (Read/Edit/Write/NotebookEdit/Grep/Glob). Anything else — Bash
// commands, WebFetch URLs, Task prompts — is size-counted but not grouped
// into a "target", since a false repeated-read flag is worse than a missed one.
const TARGET_KEYS = ["file_path", "path", "notebook_path", "pattern"];

function extractTarget(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = rec[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function contentLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((sum: number, block) => {
      if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") {
        return sum + ((block as Record<string, unknown>).text as string).length;
      }
      return sum;
    }, 0);
  }
  return 0;
}

interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

// Deliberately excludes cache_read_input_tokens. Each assistant message's
// `usage` reports that turn's FULL context, not a delta — cache_read is
// (almost) the entire prior conversation, resent and re-reported on every
// single turn. Summing it across a session double/triple/N-counts the same
// tokens as many times as there were turns and produces a nonsense total
// (tested against this project's own real logs: billions of tokens for a
// few dozen sessions). input + cache_creation + output approximates
// genuinely NEW tokens each turn — cache reads are heavily-discounted
// reuse of tokens already paid for once, not fresh spend.
function usageTotal(usage: ClaudeUsage | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0);
}

/**
 * Parses one Claude Code session transcript (one JSONL file) into the
 * normalized Session shape. Tool calls and their results live on different
 * lines (a tool_use on an "assistant" record, its tool_result on a later
 * "user" record) — this does a single forward pass, holding pending calls
 * in a map keyed by tool_use id until their result line arrives.
 */
export function parseClaudeCodeSession(filePath: string): Session {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);

  let cwd: string | undefined;
  let sessionId: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let turnCount = 0;
  let cumulative = 0;
  let isFork = false;
  let title: string | undefined;
  let lastMessage: string | undefined;

  const toolCalls: ToolCallEvent[] = [];
  const tokenSamples: TokenSample[] = [];
  const compactions: CompactionEvent[] = [];
  const pending = new Map<string, { turnId: string; name: string; target: string | undefined; timestamp: string }>();

  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
    if (timestamp) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    if (typeof record.cwd === "string") cwd ??= record.cwd;
    if (typeof record.sessionId === "string") sessionId ??= record.sessionId;
    if (record.isSidechain === true) isFork = true;

    // Both overwrite (not ??=) as they're encountered — Claude Code emits
    // a fresh ai-title/last-prompt record as the conversation evolves, and
    // the latest one in the file is the one that actually identifies what
    // this session is *now*, not what it started as.
    if (record.type === "ai-title" && typeof record.aiTitle === "string") {
      title = truncate(record.aiTitle, TITLE_MAX_CHARS);
    }
    if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
      lastMessage = truncate(record.lastPrompt, TITLE_MAX_CHARS);
    }

    if (record.type === "system" && record.subtype === "compact_boundary") {
      const meta = record.compactMetadata as
        | { trigger?: string; preTokens?: number; postTokens?: number; durationMs?: number }
        | undefined;
      compactions.push({
        timestamp: timestamp ?? "",
        trigger: meta?.trigger === "auto" ? "auto" : meta?.trigger === "manual" ? "manual" : "unknown",
        preTokens: meta?.preTokens,
        postTokens: meta?.postTokens,
        durationMs: meta?.durationMs,
      });
    }

    if (record.type === "assistant") {
      turnCount += 1;
      const message = record.message as { content?: unknown[]; usage?: ClaudeUsage } | undefined;
      if (!message) continue;

      cumulative += usageTotal(message.usage);
      tokenSamples.push({ timestamp: timestamp ?? "", cumulativeTotal: cumulative });

      const turnId = typeof record.uuid === "string" ? record.uuid : String(toolCalls.length);
      for (const block of message.content ?? []) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") {
          const b = block as Record<string, unknown>;
          const id = typeof b.id === "string" ? b.id : undefined;
          if (!id) continue;
          pending.set(id, {
            turnId,
            name: typeof b.name === "string" ? b.name : "unknown",
            target: extractTarget(b.input),
            timestamp: timestamp ?? "",
          });
        }
      }
    }

    if (record.type === "user") {
      const message = record.message as { content?: unknown[] } | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_result") {
          const b = block as Record<string, unknown>;
          const id = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
          const call = id ? pending.get(id) : undefined;
          if (!call) continue;
          toolCalls.push({
            turnId: call.turnId,
            name: call.name,
            target: call.target,
            outputChars: contentLength(b.content),
            timestamp: call.timestamp,
          });
          pending.delete(id!);
        }
      }
    }
  }

  return {
    id: sessionId ?? filePath,
    tool: "claude-code",
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

export function loadClaudeCodeSessions(
  root: string = defaultClaudeCodeRoot(),
  additionalRoots: string[] = findWslRoots([".claude", "projects"]),
): Session[] {
  // Not deduped by session id: a fork/subagent file frequently shares its
  // parent's sessionId while being a genuinely separate file with its own
  // content (see isFork above) — deduping on id here would silently drop
  // real fork sessions, not just double-mounted WSL paths. Path-level
  // duplication across WSL UNC prefixes is instead avoided upstream, in
  // findWslRoots, which only ever returns one prefix per distro.
  return [root, ...additionalRoots]
    .flatMap((r) => findClaudeCodeSessionFiles(r))
    .map((f) => {
      try {
        return parseClaudeCodeSession(f);
      } catch {
        return undefined;
      }
    })
    .filter((s): s is Session => !!s);
}
