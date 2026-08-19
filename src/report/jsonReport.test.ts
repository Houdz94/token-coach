import { describe, it, expect } from "vitest";
import { computeSeverity } from "./jsonReport.js";
import type { Finding } from "../types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    category: "large-output",
    severity: "info",
    title: "t",
    detail: "d",
    estimatedTokens: 100,
    sessionId: "s1",
    tool: "claude-code",
    ...overrides,
  };
}

describe("computeSeverity", () => {
  it("is green with no findings", () => {
    expect(computeSeverity([])).toBe("green");
  });

  it("is orange with small findings", () => {
    expect(computeSeverity([finding({ estimatedTokens: 100 })])).toBe("orange");
  });

  it("is red when a single warn finding crosses the big-single-finding threshold", () => {
    expect(computeSeverity([finding({ severity: "warn", estimatedTokens: 25_000 })])).toBe("red");
  });

  it("is red when the total across many small findings crosses the total threshold, even without a single big one", () => {
    const many = Array.from({ length: 20 }, () => finding({ severity: "info", estimatedTokens: 6_000 }));
    expect(computeSeverity(many)).toBe("red");
  });

  it("stays orange for a warn finding below the single-finding threshold", () => {
    expect(computeSeverity([finding({ severity: "warn", estimatedTokens: 5_000 })])).toBe("orange");
  });
});
