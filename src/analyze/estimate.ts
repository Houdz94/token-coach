// Rough, well-known approximation (~4 characters per token for English/code
// mixed text). Every "estimatedTokens" in this repo is explicitly an
// estimate derived from character counts, not a real tokenizer count — good
// enough to rank offenders, not good enough to bill anyone.
const CHARS_PER_TOKEN = 4;

export function charsToTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}
