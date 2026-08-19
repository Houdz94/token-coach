import type { Session, Finding } from "../types.js";
import { charsToTokens } from "./estimate.js";

// ~2,500 tokens. Arbitrary but conservative — big enough that a single call
// crossing it is worth a human glancing at, small enough to catch a
// dumped-full-file or a verbose test-run log before it happens five more times.
const LARGE_OUTPUT_CHARS = 10_000;

/**
 * Flags individual tool calls whose result was unusually large. This is a
 * SIZE proxy, not a "this was wasted" claim — a legitimately large file the
 * agent needed to read in full is not waste. It's a pointer for a human to
 * check, not an automated verdict, and it deliberately skips any target
 * already reported by findRepeatedTargets to avoid double-counting the same
 * bytes under two findings.
 */
export function findLargeOutputs(session: Session, alreadyFlaggedTargets: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const call of session.toolCalls) {
    if (call.outputChars < LARGE_OUTPUT_CHARS) continue;
    if (call.target && alreadyFlaggedTargets.has(call.target)) continue;

    findings.push({
      category: "large-output",
      severity: call.outputChars >= LARGE_OUTPUT_CHARS * 3 ? "warn" : "info",
      title: `${call.name} returned a ${charsToTokens(call.outputChars).toLocaleString()}-token result`,
      detail: call.target
        ? `"${call.target}" — one call, ~${charsToTokens(call.outputChars).toLocaleString()} tokens. Worth checking whether the agent needed all of it.`
        : `One call, ~${charsToTokens(call.outputChars).toLocaleString()} tokens, no extractable target (likely a shell command or search). Worth a look if this repeats.`,
      estimatedTokens: charsToTokens(call.outputChars),
      sessionId: session.id,
      tool: session.tool,
    });
  }
  return findings;
}
