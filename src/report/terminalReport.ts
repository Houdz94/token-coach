import type { Session, Finding } from "../types.js";
import { sessionTokenTotal } from "../analyze/estimate.js";
import { computeForkBreakdown } from "../analyze/forkBreakdown.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function printTerminalReport(sessions: Session[], findings: Finding[], limit: number): void {
  const byTool = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = byTool.get(s.tool) ?? [];
    arr.push(s);
    byTool.set(s.tool, arr);
  }

  console.log(`\n${BOLD}token-coach${RESET} — ${fmt(sessions.length)} session${sessions.length === 1 ? "" : "s"} analyzed\n`);

  for (const [tool, toolSessions] of byTool) {
    const known = toolSessions.map(sessionTokenTotal).filter((n): n is number => n !== undefined);
    const totalStr =
      known.length > 0
        ? `~${fmt(known.reduce((a, b) => a + b, 0))} fresh tokens (excludes cached/reused context — not a dollar figure)`
        : "no token counter found in these logs";
    console.log(`  ${CYAN}${tool}${RESET} — ${toolSessions.length} sessions, ${totalStr}`);
  }
  if (byTool.size > 1) {
    console.log(`  ${DIM}(different tools compute this differently — treat each line as internally consistent, not a precise comparison)${RESET}`);
  }

  const forkBreakdown = computeForkBreakdown(sessions);
  for (const b of forkBreakdown) {
    if (b.forkCount === 0) continue;
    const total = b.mainThreadTokens + b.forkTokens;
    const forkPct = total > 0 ? Math.round((b.forkTokens / total) * 100) : 0;
    console.log(
      `  ${DIM}${b.tool}: ${fmt(b.forkCount)} fork(s) across ${b.mainSessionCount} main session(s) — ${forkPct}% of tokens spent in forks (not necessarily bad — see README)${RESET}`,
    );
  }

  if (findings.length === 0) {
    console.log(`\n${DIM}No findings above threshold. Either these sessions are clean, or there just isn't enough tool-call data in them yet.${RESET}\n`);
    return;
  }

  const shown = findings.slice(0, limit);
  console.log(`\n${BOLD}Top offenders${RESET} (${shown.length} of ${findings.length}):\n`);

  for (const f of shown) {
    const marker = f.severity === "warn" ? `${YELLOW}⚠${RESET}` : `${DIM}·${RESET}`;
    const est = f.estimatedTokens !== undefined ? ` ${DIM}(~${fmt(f.estimatedTokens)} tok)${RESET}` : "";
    console.log(`${marker} ${f.title}${est}`);
    console.log(`  ${DIM}${f.detail}${RESET}`);
    if (f.recommendation) console.log(`  ${YELLOW}→ ${f.recommendation}${RESET}`);
  }

  const totalEstimated = findings.reduce((sum, f) => sum + (f.estimatedTokens ?? 0), 0);
  console.log(`\n${DIM}~${fmt(totalEstimated)} tokens estimated across all findings (character-count based, not an exact tokenizer count).${RESET}`);
  console.log(`${DIM}"large-output" and "repeated-target" findings are proxies, not verdicts — check before you act on them.${RESET}\n`);
}
