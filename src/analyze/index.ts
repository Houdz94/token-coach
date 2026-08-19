import type { Session, Finding } from "../types.js";
import { findRepeatedTargets } from "./repeatedTargets.js";
import { findLargeOutputs } from "./largeOutputs.js";
import { findBloatedRulesFile } from "./rulesFile.js";

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

    if (session.cwd && !seenRulesFileDirs.has(session.cwd)) {
      seenRulesFileDirs.add(session.cwd);
      const finding = findBloatedRulesFile(session.cwd, session.tool);
      if (finding) findings.push(finding);
    }
  }

  return findings.sort((a, b) => (b.estimatedTokens ?? 0) - (a.estimatedTokens ?? 0));
}

export * from "./estimate.js";
