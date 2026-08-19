import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanOldSessions } from "./clean.js";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe("cleanOldSessions", () => {
  let root: string;
  let archiveDir: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(archiveDir, { recursive: true, force: true });
  });

  it("moves only files older than the cutoff, leaving recent ones in place", () => {
    root = mkdtempSync(join(tmpdir(), "token-coach-clean-"));
    archiveDir = mkdtempSync(join(tmpdir(), "token-coach-archive-"));

    const oldFile = join(root, "old.jsonl");
    const newFile = join(root, "new.jsonl");
    writeFileSync(oldFile, "old content");
    writeFileSync(newFile, "new content");
    utimesSync(oldFile, daysAgo(60), daysAgo(60));
    utimesSync(newFile, daysAgo(1), daysAgo(1));

    const result = cleanOldSessions({ tool: "claude-code", olderThanDays: 30, archiveDir, claudeRoot: root });

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.from).toBe(oldFile);
    expect(existsSync(result.files[0]!.to)).toBe(true);
  });

  it("dry-run reports what would move without touching any file", () => {
    root = mkdtempSync(join(tmpdir(), "token-coach-clean-"));
    archiveDir = mkdtempSync(join(tmpdir(), "token-coach-archive-"));

    const oldFile = join(root, "old.jsonl");
    writeFileSync(oldFile, "old content");
    utimesSync(oldFile, daysAgo(60), daysAgo(60));

    const result = cleanOldSessions({ tool: "claude-code", olderThanDays: 30, archiveDir, dryRun: true, claudeRoot: root });

    expect(result.files).toHaveLength(1);
    expect(existsSync(oldFile)).toBe(true);
    expect(existsSync(result.files[0]!.to)).toBe(false);
  });

  it("never touches a file newer than the cutoff", () => {
    root = mkdtempSync(join(tmpdir(), "token-coach-clean-"));
    archiveDir = mkdtempSync(join(tmpdir(), "token-coach-archive-"));

    const newFile = join(root, "new.jsonl");
    writeFileSync(newFile, "new content");
    utimesSync(newFile, daysAgo(1), daysAgo(1));

    const result = cleanOldSessions({ tool: "claude-code", olderThanDays: 30, archiveDir, claudeRoot: root });

    expect(result.files).toHaveLength(0);
    expect(existsSync(newFile)).toBe(true);
  });
});
