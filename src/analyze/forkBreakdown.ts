import type { Session, ToolKind } from "../types.js";
import { sessionTokenTotal } from "./estimate.js";

export interface ForkBreakdown {
  tool: ToolKind;
  mainThreadTokens: number;
  forkTokens: number;
  mainSessionCount: number;
  forkCount: number;
}

/**
 * Reports how tokens split between main-thread sessions and forked/
 * subagent ones, per tool. Deliberately not a "Finding" — a fork burning
 * a lot of tokens internally is frequently the system working as intended
 * (isolating heavy exploration out of the main thread), not waste. This is
 * data for a human to look at and judge for themselves, not a verdict.
 */
export function computeForkBreakdown(sessions: Session[]): ForkBreakdown[] {
  const byTool = new Map<ToolKind, ForkBreakdown>();

  for (const session of sessions) {
    const tokens = sessionTokenTotal(session) ?? 0;
    const entry = byTool.get(session.tool) ?? {
      tool: session.tool,
      mainThreadTokens: 0,
      forkTokens: 0,
      mainSessionCount: 0,
      forkCount: 0,
    };

    if (session.isFork) {
      entry.forkTokens += tokens;
      entry.forkCount += 1;
    } else {
      entry.mainThreadTokens += tokens;
      entry.mainSessionCount += 1;
    }

    byTool.set(session.tool, entry);
  }

  return Array.from(byTool.values());
}
