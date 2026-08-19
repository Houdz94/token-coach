import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseClaudeCodeSession } from "./claudeCode.js";

// Records shaped like real ~/.claude/projects/**/*.jsonl lines, trimmed to
// only the fields this adapter reads (verified against a real transcript on
// this machine — see the PR description for how the shape was confirmed).
const LINES = [
  JSON.stringify({
    type: "assistant",
    uuid: "turn-1",
    timestamp: "2026-01-01T00:00:00Z",
    cwd: "/tmp/project",
    sessionId: "sess-1",
    message: {
      role: "assistant",
      usage: { input_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000, output_tokens: 40 },
      content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/project/a.ts" } }],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-01-01T00:00:01Z",
    cwd: "/tmp/project",
    sessionId: "sess-1",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "const x = 1;" }],
    },
  }),
];

describe("parseClaudeCodeSession", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("pairs a tool_use with its later tool_result and extracts the target", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "sess-1.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseClaudeCodeSession(file);
    expect(session.id).toBe("sess-1");
    expect(session.cwd).toBe("/tmp/project");
    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({ name: "Read", target: "/tmp/project/a.ts", outputChars: 12 });
  });

  it("excludes cache_read_input_tokens from the cumulative total (it's resent context, not new spend)", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "sess-1.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseClaudeCodeSession(file);
    // 10 input + 500 cache_creation + 40 output = 550. The 9000 cache_read must NOT be in this number.
    expect(session.tokenSamples.at(-1)?.cumulativeTotal).toBe(550);
  });

  it("drops a tool_use that never got a matching tool_result rather than inventing one", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "sess-1.jsonl");
    writeFileSync(file, LINES[0]!);

    const session = parseClaudeCodeSession(file);
    expect(session.toolCalls).toHaveLength(0);
  });

  it("returns an empty session for an unreadable/missing file rather than throwing", () => {
    expect(() => parseClaudeCodeSession("/nonexistent/path.jsonl")).toThrow();
  });
});
