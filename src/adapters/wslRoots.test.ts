import { describe, it, expect } from "vitest";
import { findWslRoots } from "./wslRoots.js";

// This entire module is win32-only by design (see wslRoots.ts's own
// header — untested against a real Windows+WSL machine). What's testable
// cross-platform is the guard itself: on every OS this repo's CI/dev
// actually runs on (macOS, Linux), it must be a strict no-op, never throw,
// and never shell out to a `wsl.exe` that doesn't exist here.
describe("findWslRoots", () => {
  it("returns an empty array on non-Windows platforms without attempting anything", () => {
    if (process.platform === "win32") return;
    expect(findWslRoots([".claude", "projects"])).toEqual([]);
  });

  it("never throws regardless of platform", () => {
    expect(() => findWslRoots([".codex", "sessions"])).not.toThrow();
  });
});
