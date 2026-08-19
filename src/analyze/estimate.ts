import type { Session } from "../types.js";

// Rough, well-known approximation (~4 characters per token for English/code
// mixed text). Every "estimatedTokens" in this repo is explicitly an
// estimate derived from character counts, not a real tokenizer count — good
// enough to rank offenders, not good enough to bill anyone.
const CHARS_PER_TOKEN = 4;

export function charsToTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** The session's own reported/computed token total — the highest cumulativeTotal any sample reached. */
export function sessionTokenTotal(session: Session): number | undefined {
  let max: number | undefined;
  for (const sample of session.tokenSamples) {
    if (sample.cumulativeTotal === undefined) continue;
    if (max === undefined || sample.cumulativeTotal > max) max = sample.cumulativeTotal;
  }
  return max;
}
