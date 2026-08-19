import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findBloatedRulesFile } from "./rulesFile.js";
import { dismissFile } from "../dismiss.js";

function longFile(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `- rule number ${i} says something reasonably long here`).join("\n");
}

describe("findBloatedRulesFile", () => {
  let dir: string;
  let store: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("flags a CLAUDE.md over the line threshold", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-rules-"));
    store = join(dir, "dismissed.json");
    writeFileSync(join(dir, "CLAUDE.md"), longFile(300));

    const finding = findBloatedRulesFile(dir, "claude-code", store);
    expect(finding).toBeDefined();
    expect(finding!.recommendation).toBeTruthy();
  });

  it("does not flag a short file", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-rules-"));
    store = join(dir, "dismissed.json");
    writeFileSync(join(dir, "CLAUDE.md"), longFile(20));

    expect(findBloatedRulesFile(dir, "claude-code", store)).toBeUndefined();
  });

  it("stops flagging once dismissed for the current content — the actual fix for 'the alert never goes away'", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-rules-"));
    store = join(dir, "dismissed.json");
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, longFile(300));

    expect(findBloatedRulesFile(dir, "claude-code", store)).toBeDefined();
    dismissFile(path, store);
    expect(findBloatedRulesFile(dir, "claude-code", store)).toBeUndefined();
  });

  it("resumes flagging if the file changes again after being dismissed", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-rules-"));
    store = join(dir, "dismissed.json");
    const path = join(dir, "CLAUDE.md");
    writeFileSync(path, longFile(300));
    dismissFile(path, store);
    expect(findBloatedRulesFile(dir, "claude-code", store)).toBeUndefined();

    // Someone edits it again later, still too long.
    writeFileSync(path, longFile(320));
    expect(findBloatedRulesFile(dir, "claude-code", store)).toBeDefined();
  });
});
