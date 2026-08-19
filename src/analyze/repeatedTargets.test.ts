import { describe, it, expect } from "vitest";
import { findRepeatedTargets } from "./repeatedTargets.js";
import type { Session, ToolCallEvent } from "../types.js";

function session(toolCalls: ToolCallEvent[]): Session {
  return {
    id: "s1",
    tool: "claude-code",
    sourcePath: "/tmp/s1.jsonl",
    cwd: "/tmp/project",
    startedAt: undefined,
    endedAt: undefined,
    toolCalls,
    tokenSamples: [],
    compactions: [],
    turnCount: toolCalls.length,
    isFork: false,
  };
}

function call(name: string, target: string | undefined, outputChars = 1000): ToolCallEvent {
  return { turnId: "t1", name, target, outputChars, timestamp: "2026-01-01T00:00:00Z" };
}

describe("findRepeatedTargets", () => {
  it("flags 3+ consecutive reads of the same file", () => {
    const findings = findRepeatedTargets(session([call("Read", "a.ts"), call("Read", "a.ts"), call("Read", "a.ts")]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toContain("3x in a row");
  });

  it("does not flag 2 reads (below the threshold)", () => {
    const findings = findRepeatedTargets(session([call("Read", "a.ts"), call("Read", "a.ts")]));
    expect(findings).toHaveLength(0);
  });

  it("never flags Write/Edit calls, however many times they repeat", () => {
    const calls = Array.from({ length: 10 }, () => call("Write", "a.ts"));
    expect(findRepeatedTargets(session(calls))).toHaveLength(0);
  });

  it("resets the streak when an edit lands between two reads — a normal read/edit loop is not flagged", () => {
    const findings = findRepeatedTargets(
      session([call("Read", "a.ts"), call("Edit", "a.ts"), call("Read", "a.ts"), call("Edit", "a.ts"), call("Read", "a.ts")]),
    );
    expect(findings).toHaveLength(0);
  });

  it("still flags a target read repeatedly even with other targets interleaved", () => {
    const findings = findRepeatedTargets(
      session([call("Read", "a.ts"), call("Read", "b.ts"), call("Read", "a.ts"), call("Read", "a.ts")]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain("a.ts");
  });

  it("ignores targets shorter than 3 characters (filter fragments, not real identifiers)", () => {
    const findings = findRepeatedTargets(session([call("search", "."), call("search", "."), call("search", ".")]));
    expect(findings).toHaveLength(0);
  });

  it("estimates tokens only from calls 2..N, not the necessary first read", () => {
    const findings = findRepeatedTargets(
      session([call("Read", "a.ts", 4000), call("Read", "a.ts", 4000), call("Read", "a.ts", 4000)]),
    );
    // 2 wasted reads * 4000 chars / 4 chars-per-token = 2000
    expect(findings[0]!.estimatedTokens).toBe(2000);
  });
});
