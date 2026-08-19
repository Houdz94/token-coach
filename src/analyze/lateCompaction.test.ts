import { describe, it, expect } from "vitest";
import { findLateCompactions } from "./lateCompaction.js";
import type { Session, CompactionEvent } from "../types.js";

function session(compactions: CompactionEvent[]): Session {
  return {
    id: "s1",
    tool: "claude-code",
    sourcePath: "/tmp/s1.jsonl",
    cwd: "/tmp/project",
    startedAt: undefined,
    endedAt: undefined,
    toolCalls: [],
    tokenSamples: [],
    compactions,
    turnCount: 0,
    isFork: false,
  };
}

function compaction(overrides: Partial<CompactionEvent> = {}): CompactionEvent {
  return { timestamp: "2026-01-01T00:00:00Z", trigger: "auto", preTokens: 200_000, postTokens: 10_000, durationMs: 5000, ...overrides };
}

describe("findLateCompactions", () => {
  it("flags a confirmed-auto compaction above the threshold as warn", () => {
    const findings = findLateCompactions(session([compaction({ trigger: "auto", preTokens: 200_000 })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.title).toContain("200,000");
  });

  it("does not flag a small compaction, even auto-triggered", () => {
    const findings = findLateCompactions(session([compaction({ trigger: "auto", preTokens: 50_000 })]));
    expect(findings).toHaveLength(0);
  });

  it("reports an unlabeled (Codex-style) large compaction only as info, never guessed as warn", () => {
    const findings = findLateCompactions(session([compaction({ trigger: "unknown", preTokens: 300_000 })]));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("info");
  });

  it("never flags a compaction with no known preTokens — no data means no claim", () => {
    const findings = findLateCompactions(session([compaction({ preTokens: undefined })]));
    expect(findings).toHaveLength(0);
  });

  it("carries no token estimate — this is a timing signal, not a waste number", () => {
    const findings = findLateCompactions(session([compaction()]));
    expect(findings[0]!.estimatedTokens).toBeUndefined();
  });
});
