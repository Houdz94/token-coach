import type { Session, Finding } from "../types.js";
import { computeForkBreakdown, type ForkBreakdown } from "../analyze/forkBreakdown.js";

export type Severity = "green" | "orange" | "red";

// The desktop app's tray dot reads directly off this field — computed once,
// here, so the Rust/frontend side never has to reimplement "what counts as
// bad" and can't drift from what `analyze`'s terminal report considers
// worth flagging in the first place.
const RED_SINGLE_FINDING_TOKENS = 20_000;
const RED_TOTAL_TOKENS = 100_000;

export function computeSeverity(findings: Finding[]): Severity {
  if (findings.length === 0) return "green";

  const totalEstimated = findings.reduce((sum, f) => sum + (f.estimatedTokens ?? 0), 0);
  const hasBigWarn = findings.some((f) => f.severity === "warn" && (f.estimatedTokens ?? 0) >= RED_SINGLE_FINDING_TOKENS);
  // late-compaction findings carry no token estimate (see lateCompaction.ts)
  // so they'd never trip hasBigWarn/totalEstimated on their own — but a
  // confirmed-auto late compaction is unambiguously a real problem, not a
  // maybe, so it escalates straight to red regardless of token math.
  const hasLateCompactionWarn = findings.some((f) => f.category === "late-compaction" && f.severity === "warn");

  if (hasBigWarn || hasLateCompactionWarn || totalEstimated >= RED_TOTAL_TOKENS) return "red";
  return "orange";
}

export interface JsonReport {
  generatedAt: string;
  severity: Severity;
  sessionCount: number;
  totalEstimatedTokens: number;
  findings: Finding[];
  forkBreakdown: ForkBreakdown[];
}

export function toJsonReport(sessions: Session[], findings: Finding[]): JsonReport {
  return {
    generatedAt: new Date().toISOString(),
    severity: computeSeverity(findings),
    sessionCount: sessions.length,
    totalEstimatedTokens: findings.reduce((sum, f) => sum + (f.estimatedTokens ?? 0), 0),
    findings,
    forkBreakdown: computeForkBreakdown(sessions),
  };
}
