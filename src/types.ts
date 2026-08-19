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

export interface Session {
  id: string;
  tool: ToolKind;
  sourcePath: string;
  cwd: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  toolCalls: ToolCallEvent[];
  tokenSamples: TokenSample[];
  /** Number of turns (user message -> agent response cycles). */
  turnCount: number;
}

export interface Finding {
  /** Stable id so a report/CLI flag can filter by category. */
  category: "repeated-target" | "large-output" | "bloated-rules-file";
  severity: "info" | "warn";
  title: string;
  detail: string;
  /** Rough token estimate this finding accounts for, when computable. */
  estimatedTokens: number | undefined;
  sessionId: string;
  tool: ToolKind;
}
