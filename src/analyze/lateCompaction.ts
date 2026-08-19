import type { Session, Finding } from "../types.js";

// ~150k tokens. Below this, letting the CLI auto-compact isn't obviously
// wrong — plenty of legitimate sessions run that big. Above it, on a model
// with a ~200k context window, an *automatic* compaction means the session
// ran right up against the wall instead of anyone clearing proactively.
const LATE_PRE_TOKENS = 150_000;

/**
 * Flags an auto-triggered compaction whose context had grown large before
 * it fired — the direct "you cleared too late" signal, not inferred from
 * token totals. This is NOT framed as wasted tokens (compaction is a
 * legitimate, useful mechanism, and this project's own "fresh tokens"
 * total already excludes the resent-context tokens that balloon before a
 * compaction) — it's a timing/latency observation: the session ran slower
 * and lost more context than it needed to.
 *
 * Claude Code's compact_boundary record labels `trigger` directly ("auto"
 * vs a deliberate manual compact/clear) — only "auto" is ever flagged as
 * "warn". Codex's equivalent event carries no trigger label at all (see
 * codex.ts) so it's never guessed at; a Codex compaction with a large
 * preTokens is still surfaced, but only as "info".
 */
export function findLateCompactions(session: Session): Finding[] {
  const findings: Finding[] = [];

  for (const compaction of session.compactions) {
    if (compaction.preTokens === undefined || compaction.preTokens < LATE_PRE_TOKENS) continue;

    const isConfirmedAuto = compaction.trigger === "auto";
    const pre = compaction.preTokens.toLocaleString("en-US");
    const durationNote =
      compaction.durationMs !== undefined ? `, took ${(compaction.durationMs / 1000).toFixed(0)}s to run` : "";

    findings.push({
      category: "late-compaction",
      severity: isConfirmedAuto ? "warn" : "info",
      title: isConfirmedAuto
        ? `Context hit ${pre} tokens before auto-compacting`
        : `Large compaction: context was around ${pre} tokens`,
      detail: isConfirmedAuto
        ? `This session let context grow to ~${pre} tokens before the CLI forced a compaction${durationNote}. Compacting (or clearing) earlier keeps turns faster and drops less of the middle of the conversation.`
        : `A compaction happened with roughly ${pre} tokens of context beforehand${durationNote}. This tool's logs don't label whether that was automatic or requested, so treat this as informational.`,
      estimatedTokens: undefined,
      sessionId: session.id,
      tool: session.tool,
    });
  }

  return findings;
}
