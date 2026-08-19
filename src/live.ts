import { loadClaudeCodeSessions } from "./adapters/claudeCode.js";
import { loadCodexSessions } from "./adapters/codex.js";
import { analyzeSessions } from "./analyze/index.js";
import { sessionTokenTotal } from "./analyze/estimate.js";
import type { Session, Finding } from "./types.js";

const DEFAULT_ACTIVE_WINDOW_MINUTES = 20;

// The categories that mean something *right now*, for a session that's
// still open — repeated-target/large-output/bloated-rules-file describe
// what already happened and are for the historical `analyze` report;
// stale-context ("this is still sitting in context, unused") and
// late-compaction ("you just blew past the wall") are the ones worth
// interrupting someone for.
const LIVE_RELEVANT_CATEGORIES = new Set<Finding["category"]>(["stale-context", "late-compaction"]);

export interface ActiveSession {
  id: string;
  tool: Session["tool"];
  title: string | undefined;
  lastMessage: string | undefined;
  cwd: string | undefined;
  startedAt: string | undefined;
  minutesActive: number | undefined;
  currentContextTokens: number | undefined;
  findings: Finding[];
}

function minutesSince(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : Math.round(ms / 60_000);
}

/**
 * Sessions whose log file changed within the last `withinMinutes` — the
 * proxy for "someone is looking at this right now". No hooks, no config on
 * your part: Claude Code and Codex both write their transcript file
 * continuously as a session runs, so a session's own endedAt (the
 * timestamp of its last record) already tells us how fresh it is.
 */
export function findActiveSessions(
  withinMinutes: number = DEFAULT_ACTIVE_WINDOW_MINUTES,
  /** Override the log roots — tests point these at a temp dir instead of the real ~/.claude / ~/.codex. */
  roots: { claudeRoot?: string; codexRoot?: string } = {},
): ActiveSession[] {
  const cutoff = Date.now() - withinMinutes * 60_000;
  const all = [
    ...(roots.claudeRoot ? loadClaudeCodeSessions(roots.claudeRoot) : loadClaudeCodeSessions()),
    ...(roots.codexRoot ? loadCodexSessions(roots.codexRoot) : loadCodexSessions()),
  ];

  const active = all.filter((s) => {
    if (!s.endedAt) return false;
    const ts = new Date(s.endedAt).getTime();
    return !Number.isNaN(ts) && ts >= cutoff;
  });

  const findings = analyzeSessions(active).filter((f) => LIVE_RELEVANT_CATEGORIES.has(f.category));

  return active
    .map((session) => ({
      id: session.id,
      tool: session.tool,
      title: session.title,
      lastMessage: session.lastMessage,
      cwd: session.cwd,
      startedAt: session.startedAt,
      minutesActive: minutesSince(session.startedAt),
      currentContextTokens: sessionTokenTotal(session),
      findings: findings.filter((f) => f.sessionId === session.id),
    }))
    .sort((a, b) => (a.minutesActive ?? 0) - (b.minutesActive ?? 0));
}
