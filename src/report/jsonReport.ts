import type { Session, Finding } from "../types.js";

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

  if (hasBigWarn || totalEstimated >= RED_TOTAL_TOKENS) return "red";
  return "orange";
}

export interface JsonReport {
  generatedAt: string;
  severity: Severity;
  sessionCount: number;
  totalEstimatedTokens: number;
  findings: Finding[];
}

export function toJsonReport(sessions: Session[], findings: Finding[]): JsonReport {
  return {
    generatedAt: new Date().toISOString(),
    severity: computeSeverity(findings),
    sessionCount: sessions.length,
    totalEstimatedTokens: findings.reduce((sum, f) => sum + (f.estimatedTokens ?? 0), 0),
    findings,
  };
}
