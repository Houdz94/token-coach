import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Finding, ToolKind } from "../types.js";
import { charsToTokens } from "./estimate.js";

const RULES_FILENAMES = ["CLAUDE.md", "AGENTS.md"];
const LONG_FILE_LINES = 250;
const DUPLICATE_LINE_RATIO = 0.15;

/**
 * A rules file gets loaded into every single session in that project — so
 * unlike a re-read file (waste in one session), bloat here is a recurring
 * tax on every future session. Two independent signals, either one enough
 * to flag: raw length, and a naive duplicate-line ratio (the same
 * instruction restated under two headings is common and easy to catch this
 * way without any real prose analysis).
 */
export function findBloatedRulesFile(cwd: string, tool: ToolKind): Finding | undefined {
  for (const filename of RULES_FILENAMES) {
    const path = join(cwd, filename);
    if (!existsSync(path)) continue;

    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const nonTrivial = lines.filter((l) => l.trim().length > 20);
    const duplicateCount = nonTrivial.length - new Set(nonTrivial.map((l) => l.trim())).size;
    const duplicateRatio = nonTrivial.length > 0 ? duplicateCount / nonTrivial.length : 0;

    const tooLong = lines.length > LONG_FILE_LINES;
    const tooRepetitive = duplicateRatio > DUPLICATE_LINE_RATIO;
    if (!tooLong && !tooRepetitive) continue;

    const reasons = [
      tooLong ? `${lines.length} non-blank lines (>${LONG_FILE_LINES})` : undefined,
      tooRepetitive ? `${Math.round(duplicateRatio * 100)}% near-duplicate lines` : undefined,
    ].filter(Boolean);

    return {
      category: "bloated-rules-file",
      severity: tooLong && tooRepetitive ? "warn" : "info",
      title: `${filename} is loaded into every session here and looks bloated`,
      detail: `${path} — ${reasons.join(", ")}. Every session in this project pays this cost on top of whatever it actually needed.`,
      estimatedTokens: charsToTokens(text.length),
      sessionId: cwd,
      tool,
    };
  }
  return undefined;
}
