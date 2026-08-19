// The normalized shape every adapter (Claude Code, Codex, ...) produces.
// Heuristics in src/analyze/* only ever see this — they never touch a raw
// JSONL record, so adding a third tool later means writing one more
// adapter, not touching any analysis code.

export type ToolKind = "claude-code" | "codex";

export interface ToolCallEvent {
  /** Groups calls within the same request/response round-trip. */
  turnId: string;
  /** Raw tool/function name as the CLI recorded it (e.g. "Read", "Bash", "exec"). */
  name: string;
  /**
   * Best-effort extracted target — a file path, url, or command, when one
   * could be pulled out of the call's arguments. Repeated-read detection
   * groups on this; when it's undefined the call is size-counted but never
   * flagged as a repeat (we'd rather miss a repeat than invent one).
   */
  target: string | undefined;
  /** Characters in the tool's result, used as a cheap proxy for its token cost. */
  outputChars: number;
  timestamp: string;
}

export interface TokenSample {
  timestamp: string;
  /** Cumulative tokens billed for the session as of this point, if the log exposes one. */
  cumulativeTotal: number | undefined;
}

export interface CompactionEvent {
  timestamp: string;
  /**
   * "auto" = the CLI forced this because context filled up (the timing
   * signal worth flagging — it means nothing cleared proactively).
   * "unknown" for tools whose logs don't label this (Codex's `compacted`
   * record carries no trigger field — never guessed, always honest).
   */
  trigger: "auto" | "manual" | "unknown";
  /** Context size right before compaction, when the log reports it directly (Claude Code) or it's derived from the nearest prior token sample (Codex). */
  preTokens: number | undefined;
  postTokens: number | undefined;
  durationMs: number | undefined;
}

export interface Session {
  id: string;
  tool: ToolKind;
  sourcePath: string;
  cwd: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  toolCalls: ToolCallEvent[];
  tokenSamples: TokenSample[];
  compactions: CompactionEvent[];
  /** Number of turns (user message -> agent response cycles). */
  turnCount: number;
  /** A forked/subagent conversation rather than a main thread — see each adapter for how this is detected. */
  isFork: boolean;
  /**
   * A human-recognizable name for this specific conversation — needed the
   * moment there's more than one active session at once, which "session
   * <uuid>" doesn't help anyone tell apart. Claude Code's own AI-generated
   * title (its ai-title record); Codex has no equivalent field, so its
   * adapter derives one from the first user message instead.
   */
  title: string | undefined;
  /** The most recent user message in this session, truncated — a second, complementary way to recognize "which conversation is this" (Claude Code's last-prompt record; Codex's most recent user message). */
  lastMessage: string | undefined;
}

export interface Finding {
  /** Stable id so a report/CLI flag can filter by category. */
  category: "repeated-target" | "large-output" | "bloated-rules-file" | "late-compaction" | "stale-context";
  severity: "info" | "warn";
  title: string;
  detail: string;
  /** Rough token estimate this finding accounts for, when computable. */
  estimatedTokens: number | undefined;
  sessionId: string;
  tool: ToolKind;
}
