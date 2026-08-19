import type { Session, Finding } from "../types.js";
import { charsToTokens } from "./estimate.js";
import { isInternalPath } from "./internalPaths.js";

// Same bar as largeOutputs.ts's "worth a look" threshold — a block has to
// be sizeable before "it's still sitting there unused" is worth surfacing.
const STALE_MIN_CHARS = 8_000;
const STALE_TURN_THRESHOLD = 4;
const WRITE_LIKE_NAME = /write|edit|apply_?patch|create|delete|move|rename/i;

/**
 * Flags a large tool result whose target hasn't been touched again (read,
 * written, or otherwise referenced) in several turns — unlike
 * largeOutputs.ts (which flags a single big call regardless of what
 * happens after), this is specifically about *dead weight still sitting in
 * context*: every following turn keeps paying for tokens nothing has used
 * since. It's the direct "this is exactly what /clear or a fork would drop"
 * signal — the live desktop app surfaces this as its actionable
 * recommendation, not the historical repeated-read/large-output categories.
 *
 * Never flagged once a compaction happens after the call — the context is
 * already gone by then, so there's nothing left to act on.
 */
export function findStaleContext(session: Session): Finding[] {
  const findings: Finding[] = [];

  // Turn order, first-appearance based — ToolCallEvent has no numeric turn
  // index, only a turnId, so this reconstructs the sequence from arrival order.
  const turnOrder: string[] = [];
  const turnIndex = new Map<string, number>();
  for (const call of session.toolCalls) {
    if (!turnIndex.has(call.turnId)) {
      turnIndex.set(call.turnId, turnOrder.length);
      turnOrder.push(call.turnId);
    }
  }
  const lastTurnIndex = turnOrder.length - 1;
  const lastCompactionTime = session.compactions.at(-1)?.timestamp;

  session.toolCalls.forEach((call, callPos) => {
    if (!call.target || call.outputChars < STALE_MIN_CHARS) return;
    if (WRITE_LIKE_NAME.test(call.name)) return;
    // Claude Code's own internal skill/scratchpad reads — not the user's
    // file, never consciously read, nothing for them to act on. Real
    // report from using this tool: a dataviz skill's reference file got
    // flagged as "stale context" on a live session, which was pure noise.
    if (isInternalPath(call.target)) return;

    const introducedAt = turnIndex.get(call.turnId) ?? 0;
    const turnsSince = lastTurnIndex - introducedAt;
    if (turnsSince < STALE_TURN_THRESHOLD) return;

    // Referenced again later (any tool call after this one touching the
    // same target) — not dead weight, it's still in active use.
    const referencedAgain = session.toolCalls.slice(callPos + 1).some((later) => later.target === call.target);
    if (referencedAgain) return;

    // Already gone by compaction — nothing left to recommend clearing.
    if (lastCompactionTime && lastCompactionTime > call.timestamp) return;

    findings.push({
      category: "stale-context",
      severity: "warn",
      title: `${call.name} loaded ${charsToTokens(call.outputChars).toLocaleString("en-US")} tokens, unused for ${turnsSince} turns`,
      detail: `"${call.target}" — loaded ${turnsSince} turns ago and never referenced since. It's still fully resent as context on every turn since then.`,
      estimatedTokens: charsToTokens(call.outputChars),
      recommendation: "Clear or fork this conversation now — that's exactly what drops it from context.",
      sessionId: session.id,
      tool: session.tool,
    });
  });

  return findings;
}
