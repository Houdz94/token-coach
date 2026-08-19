import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findActiveSessions } from "./live.js";

function isoMinutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function claudeSessionLine(sessionId: string, timestamp: string, title?: string) {
  const lines = [
    JSON.stringify({
      type: "assistant",
      uuid: "turn-1",
      timestamp,
      sessionId,
      message: { role: "assistant", content: [] },
    }),
  ];
  if (title) lines.push(JSON.stringify({ type: "ai-title", aiTitle: title, sessionId }));
  return lines.join("\n");
}

describe("findActiveSessions", () => {
  let claudeRoot: string;
  let codexRoot: string;

  afterEach(() => {
    rmSync(claudeRoot, { recursive: true, force: true });
    rmSync(codexRoot, { recursive: true, force: true });
  });

  it("includes a session whose last record is within the active window", () => {
    claudeRoot = mkdtempSync(join(tmpdir(), "token-coach-live-"));
    codexRoot = join(claudeRoot, "no-codex");
    writeFileSync(join(claudeRoot, "recent.jsonl"), claudeSessionLine("recent-session", isoMinutesAgo(2), "Fix the login bug"));

    const active = findActiveSessions(20, { claudeRoot, codexRoot });

    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: "recent-session", title: "Fix the login bug" });
  });

  it("excludes a session whose last record is outside the active window", () => {
    claudeRoot = mkdtempSync(join(tmpdir(), "token-coach-live-"));
    codexRoot = join(claudeRoot, "no-codex");
    writeFileSync(join(claudeRoot, "old.jsonl"), claudeSessionLine("old-session", isoMinutesAgo(60)));

    expect(findActiveSessions(20, { claudeRoot, codexRoot })).toHaveLength(0);
  });

  it("computes minutesActive from startedAt", () => {
    claudeRoot = mkdtempSync(join(tmpdir(), "token-coach-live-"));
    codexRoot = join(claudeRoot, "no-codex");
    writeFileSync(join(claudeRoot, "recent.jsonl"), claudeSessionLine("recent-session", isoMinutesAgo(2)));

    const [active] = findActiveSessions(20, { claudeRoot, codexRoot });
    expect(active!.minutesActive).toBeGreaterThanOrEqual(1);
    expect(active!.minutesActive).toBeLessThanOrEqual(3);
  });

  it("only attaches live-relevant findings (stale-context, late-compaction), never historical-only categories", () => {
    claudeRoot = mkdtempSync(join(tmpdir(), "token-coach-live-"));
    codexRoot = join(claudeRoot, "no-codex");
    // 5 reads of the same target, well within the active window — would
    // trigger repeated-target/large-output under a full historical
    // analyze, but neither belongs on a live card.
    const timestamp = isoMinutesAgo(1);
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        uuid: `turn-${i}`,
        timestamp,
        sessionId: "chatty-session",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: `toolu_${i}`, name: "Read", input: { file_path: "a.ts" } }],
        },
      }),
    );
    for (let i = 0; i < 5; i++) {
      lines.push(
        JSON.stringify({
          type: "user",
          timestamp,
          sessionId: "chatty-session",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${i}`, content: "x" }] },
        }),
      );
    }
    writeFileSync(join(claudeRoot, "chatty.jsonl"), lines.join("\n"));

    const [active] = findActiveSessions(20, { claudeRoot, codexRoot });
    expect(active!.findings.every((f) => f.category === "stale-context" || f.category === "late-compaction")).toBe(true);
  });
});
