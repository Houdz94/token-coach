import type { Session, Finding } from "../types.js";
import { charsToTokens } from "./estimate.js";

const MIN_CONSECUTIVE_READS = 3;

// Repeated calls only mean "re-reading something already in context" for
// tools that READ. A file edited 90 times in one session is 90 legitimate,
// distinct actions — and a read that comes right after an edit to the same
// file is legitimate too (the agent is checking its own change). Matched
// case-insensitively so both Claude Code's PascalCase names (Write, Edit,
// NotebookEdit) and Codex's lowercase ones (apply_patch, custom exec
// wrappers) are recognized as the "this target just changed" signal.
const WRITE_LIKE_NAME = /write|edit|apply_?patch|create|delete|move|rename/i;

interface Run {
  name: string;
  chars: number[];
}

/**
 * Flags a target (file, search pattern, URL...) read back-to-back, with no
 * edit to it in between, 3+ times in a row within a single session. The
 * published research this project leans on found repeated reads of
 * unchanged files account for a large share of avoidable agent token spend.
 *
 * This walks calls in chronological order per target and only accumulates
 * a "redundant read" streak while consecutive calls are reads of that same
 * target — a write to the target resets the streak, since the next read
 * after an edit is the agent legitimately checking its own change, not
 * re-reading something unchanged. Only fully-consecutive runs are flagged,
 * so a read/edit/read/edit loop (completely normal iterative work) never
 * triggers this, even if the same file is touched 50 times.
 */
export function findRepeatedTargets(session: Session): Finding[] {
  const lastRun = new Map<string, Run>();
  const findings: Finding[] = [];

  function flush(target: string) {
    const run = lastRun.get(target);
    if (!run) return;
    if (run.chars.length >= MIN_CONSECUTIVE_READS) {
      const wastedChars = run.chars.slice(1).reduce((a, b) => a + b, 0);
      findings.push({
        category: "repeated-target",
        severity: run.chars.length >= 5 ? "warn" : "info",
        title: `${run.name} re-read the same target ${run.chars.length}x in a row`,
        detail: `"${target}" — ${run.chars.length} consecutive reads with no edit to it in between. The first was necessary; the other ${
          run.chars.length - 1
        } returned content already in context.`,
        estimatedTokens: wastedChars > 0 ? charsToTokens(wastedChars) : undefined,
        sessionId: session.id,
        tool: session.tool,
      });
    }
    lastRun.delete(target);
  }

  for (const call of session.toolCalls) {
    // A target under 3 chars is almost always a filter/regex fragment
    // (a bare ".", a single flag) picked up by the generic "pattern" key,
    // not a real, stable identifier worth tracking repeats on — e.g. a
    // live console-log poller called with pattern:"." repeatedly isn't
    // "re-reading the same file", it's watching something that changes.
    if (!call.target || call.target.length < 3) continue;
    const isWrite = WRITE_LIKE_NAME.test(call.name);

    if (isWrite) {
      flush(call.target);
      continue;
    }

    const run = lastRun.get(call.target);
    if (run) {
      run.chars.push(call.outputChars);
    } else {
      lastRun.set(call.target, { name: call.name, chars: [call.outputChars] });
    }
  }

  for (const target of lastRun.keys()) flush(target);

  return findings;
}
