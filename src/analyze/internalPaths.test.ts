import { describe, it, expect } from "vitest";
import { isInternalPath } from "./internalPaths.js";

describe("isInternalPath", () => {
  it("recognizes Claude Code's own per-session temp root, both /tmp and /private/tmp forms", () => {
    expect(isInternalPath("/private/tmp/claude-501/bundled-skills/2.1.220/abc/dataviz/references/palette.md")).toBe(true);
    expect(isInternalPath("/tmp/claude-501/scratchpad/notes.md")).toBe(true);
  });

  it("recognizes a bundled-skills path even without the claude-<pid> segment matching", () => {
    expect(isInternalPath("/some/other/root/bundled-skills/dataviz/references/palette.md")).toBe(true);
  });

  it("never flags a real project file", () => {
    expect(isInternalPath("/Users/mikaeldangain/Documents/my-project/src/index.ts")).toBe(false);
    expect(isInternalPath("/Users/mikaeldangain/Documents/token-coach/README.md")).toBe(false);
  });

  it("does not false-positive on an unrelated /tmp path with no claude-<pid> segment", () => {
    expect(isInternalPath("/tmp/some-other-tool/output.json")).toBe(false);
  });
});
