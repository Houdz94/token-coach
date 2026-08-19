import { describe, it, expect } from "vitest";
import { computeForkBreakdown } from "./forkBreakdown.js";
import type { Session, ToolKind } from "../types.js";

function session(overrides: Partial<Session> & { tool: ToolKind }): Session {
  return {
    id: "s1",
    sourcePath: "/tmp/s1.jsonl",
    cwd: "/tmp/project",
    startedAt: undefined,
    endedAt: undefined,
    toolCalls: [],
    tokenSamples: [],
    compactions: [],
    turnCount: 0,
    isFork: false,
    ...overrides,
  };
}

describe("computeForkBreakdown", () => {
  it("splits tokens between main-thread and fork sessions, per tool", () => {
    const sessions = [
      session({ tool: "claude-code", isFork: false, tokenSamples: [{ timestamp: "t", cumulativeTotal: 1000 }] }),
      session({ tool: "claude-code", isFork: true, tokenSamples: [{ timestamp: "t", cumulativeTotal: 300 }] }),
      session({ tool: "claude-code", isFork: true, tokenSamples: [{ timestamp: "t", cumulativeTotal: 200 }] }),
    ];

    const [breakdown] = computeForkBreakdown(sessions);
    expect(breakdown).toMatchObject({
      tool: "claude-code",
      mainThreadTokens: 1000,
      forkTokens: 500,
      mainSessionCount: 1,
      forkCount: 2,
    });
  });

  it("keeps tools separate", () => {
    const sessions = [
      session({ tool: "claude-code", tokenSamples: [{ timestamp: "t", cumulativeTotal: 100 }] }),
      session({ tool: "codex", tokenSamples: [{ timestamp: "t", cumulativeTotal: 200 }] }),
    ];

    const breakdown = computeForkBreakdown(sessions);
    expect(breakdown).toHaveLength(2);
  });

  it("treats a session with no token sample as 0, not a crash", () => {
    const [breakdown] = computeForkBreakdown([session({ tool: "claude-code", tokenSamples: [] })]);
    expect(breakdown!.mainThreadTokens).toBe(0);
  });
});
