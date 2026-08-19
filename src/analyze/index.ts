import type { Session, Finding } from "../types.js";
import { findRepeatedTargets } from "./repeatedTargets.js";
import { findLargeOutputs } from "./largeOutputs.js";
import { findBloatedRulesFile } from "./rulesFile.js";
import { findLateCompactions } from "./lateCompaction.js";

export function analyzeSessions(sessions: Session[]): Finding[] {
  const findings: Finding[] = [];
  const seenRulesFileDirs = new Set<string>();

  for (const session of sessions) {
    const repeated = findRepeatedTargets(session);
    findings.push(...repeated);

    const flaggedTargets = new Set(
      repeated.map((f) => f.detail.match(/^"([^"]+)"/)?.[1]).filter((t): t is string => !!t),
    );
    findings.push(...findLargeOutputs(session, flaggedTargets));
    findings.push(...findLateCompactions(session));

    if (session.cwd && !seenRulesFileDirs.has(session.cwd)) {
      seenRulesFileDirs.add(session.cwd);
      const finding = findBloatedRulesFile(session.cwd, session.tool);
      if (finding) findings.push(finding);
    }
  }

  // "warn" always outranks "info". Within "warn", a late-compaction finding
  // has no token estimate at all (see lateCompaction.ts) — a plain
  // `estimatedTokens ?? 0` sort would treat that as 0 and sink a "context
  // hit 935k tokens" finding below a 19k large-output one, which gets the
  // relative severity backwards. late-compaction warns rank first within
  // the warn tier; everything else there still sorts by token estimate.
  return findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "warn" ? -1 : 1;
    const aIsLateCompaction = a.severity === "warn" && a.category === "late-compaction";
    const bIsLateCompaction = b.severity === "warn" && b.category === "late-compaction";
    if (aIsLateCompaction !== bIsLateCompaction) return aIsLateCompaction ? -1 : 1;
    return (b.estimatedTokens ?? 0) - (a.estimatedTokens ?? 0);
  });
}

export * from "./estimate.js";
export * from "./forkBreakdown.js";
