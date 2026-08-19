import { describe, it, expect } from "vitest";
import { findLargeOutputs } from "./largeOutputs.js";
import type { Session, ToolCallEvent } from "../types.js";

function session(toolCalls: ToolCallEvent[]): Session {
  return {
    id: "s1",
    tool: "codex",
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

function call(name: string, target: string | undefined, outputChars: number): ToolCallEvent {
  return { turnId: "t1", name, target, outputChars, timestamp: "2026-01-01T00:00:00Z" };
}

describe("findLargeOutputs", () => {
  it("flags a call above the size threshold", () => {
    const findings = findLargeOutputs(session([call("exec", undefined, 50_000)]), new Set());
    expect(findings).toHaveLength(1);
  });

  it("does not flag small outputs", () => {
    const findings = findLargeOutputs(session([call("exec", undefined, 100)]), new Set());
    expect(findings).toHaveLength(0);
  });

  it("skips a target already reported by the repeated-target check, to avoid double counting", () => {
    const findings = findLargeOutputs(session([call("Read", "big.json", 50_000)]), new Set(["big.json"]));
    expect(findings).toHaveLength(0);
  });

  it("still flags large outputs with no target even when the exclusion set is non-empty", () => {
    const findings = findLargeOutputs(session([call("exec", undefined, 50_000)]), new Set(["something-else.ts"]));
    expect(findings).toHaveLength(1);
  });
});
