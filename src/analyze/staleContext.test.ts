import { describe, it, expect } from "vitest";
import { findStaleContext } from "./staleContext.js";
import type { Session, ToolCallEvent, CompactionEvent } from "../types.js";

function session(toolCalls: ToolCallEvent[], compactions: CompactionEvent[] = []): Session {
  return {
    id: "s1",
    tool: "claude-code",
    sourcePath: "/tmp/s1.jsonl",
    cwd: "/tmp/project",
    startedAt: undefined,
    endedAt: undefined,
    toolCalls,
    tokenSamples: [],
    compactions,
    turnCount: toolCalls.length,
    isFork: false,
    title: undefined,
    lastMessage: undefined,
  };
}

function call(turnId: string, name: string, target: string | undefined, outputChars = 10_000, timestamp = "t"): ToolCallEvent {
  return { turnId, name, target, outputChars, timestamp };
}

function turns(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `turn-${i}`);
}

describe("findStaleContext", () => {
  it("flags a large read whose target hasn't been touched again in several turns", () => {
    const [t0, t1, t2, t3, t4] = turns(5);
    const calls = [call(t0!, "Read", "big.json"), call(t1!, "Read", "a.ts"), call(t2!, "Read", "b.ts"), call(t3!, "Read", "c.ts"), call(t4!, "Read", "d.ts")];
    const findings = findStaleContext(session(calls));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.detail).toContain("big.json");
    expect(findings[0]!.recommendation).toMatch(/clear|fork/i);
  });

  it("does not flag a target referenced again later, however large", () => {
    const [t0, t1, t2, t3, t4] = turns(5);
    const calls = [call(t0!, "Read", "big.json"), call(t1!, "Read", "a.ts"), call(t2!, "Read", "b.ts"), call(t3!, "Read", "c.ts"), call(t4!, "Read", "big.json")];
    expect(findStaleContext(session(calls))).toHaveLength(0);
  });

  it("does not flag something introduced too recently (below the turn threshold)", () => {
    const [t0, t1] = turns(2);
    const calls = [call(t0!, "Read", "a.ts"), call(t1!, "Read", "big.json")];
    expect(findStaleContext(session(calls))).toHaveLength(0);
  });

  it("does not flag small outputs regardless of staleness", () => {
    const calls = turns(5).map((t, i) => call(t, "Read", i === 0 ? "small.ts" : `f${i}.ts`, 500));
    expect(findStaleContext(session(calls))).toHaveLength(0);
  });

  it("never flags a write/edit call — those are intentional actions, not stray reads", () => {
    const calls = turns(5).map((t, i) => call(t, "Write", i === 0 ? "big.json" : `f${i}.ts`));
    expect(findStaleContext(session(calls))).toHaveLength(0);
  });

  it("does not flag something already dropped by a compaction that happened after it", () => {
    const [t0, t1, t2, t3, t4] = turns(5);
    const calls = [
      call(t0!, "Read", "big.json", 10_000, "2026-01-01T00:00:00Z"),
      call(t1!, "Read", "a.ts", 10_000, "2026-01-01T00:01:00Z"),
      call(t2!, "Read", "b.ts", 10_000, "2026-01-01T00:02:00Z"),
      call(t3!, "Read", "c.ts", 10_000, "2026-01-01T00:03:00Z"),
      call(t4!, "Read", "d.ts", 10_000, "2026-01-01T00:04:00Z"),
    ];
    const compactions: CompactionEvent[] = [
      { timestamp: "2026-01-01T00:02:30Z", trigger: "auto", preTokens: 900_000, postTokens: 5000, durationMs: 1000 },
    ];
    expect(findStaleContext(session(calls, compactions))).toHaveLength(0);
  });
});
