import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dismissFile, isDismissed } from "./dismiss.js";

describe("dismissFile / isDismissed", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is not dismissed before dismissFile has ever been called", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-dismiss-"));
    const file = join(dir, "CLAUDE.md");
    writeFileSync(file, "some content");
    const store = join(dir, "dismissed.json");

    expect(isDismissed(file, "some content", store)).toBe(false);
  });

  it("is dismissed for the exact content that was dismissed", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-dismiss-"));
    const file = join(dir, "CLAUDE.md");
    const store = join(dir, "dismissed.json");
    writeFileSync(file, "tightened content");

    dismissFile(file, store);

    expect(isDismissed(file, "tightened content", store)).toBe(true);
  });

  it("stops being dismissed the moment the content changes again — this is the actual fix for 'the alert never goes away'", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-dismiss-"));
    const file = join(dir, "CLAUDE.md");
    const store = join(dir, "dismissed.json");
    writeFileSync(file, "tightened content");

    dismissFile(file, store);
    // Someone edits the file again later — bloat creeps back in.
    writeFileSync(file, "tightened content, now with more stuff appended again");

    expect(isDismissed(file, "tightened content, now with more stuff appended again", store)).toBe(false);
  });

  it("dismissing one file never affects another", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-dismiss-"));
    const fileA = join(dir, "a", "CLAUDE.md");
    const fileB = join(dir, "b", "CLAUDE.md");
    const store = join(dir, "dismissed.json");
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(fileA, "content A");
    writeFileSync(fileB, "content B");

    dismissFile(fileA, store);

    expect(isDismissed(fileA, "content A", store)).toBe(true);
    expect(isDismissed(fileB, "content B", store)).toBe(false);
  });
});
