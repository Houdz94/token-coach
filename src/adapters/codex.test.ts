import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseCodexSession } from "./codex.js";

// Records shaped like real ~/.codex/sessions/**/rollout-*.jsonl lines,
// trimmed to only the fields this adapter reads (verified against real
// rollout files on this machine, both the plain `function_call` shape and
// the `custom_tool_call` shape with a raw-JS `input` string).
const LINES = [
  JSON.stringify({
    type: "session_meta",
    timestamp: "2026-01-01T00:00:00Z",
    payload: { session_id: "codex-sess-1", cwd: "/tmp/project" },
  }),
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-01-01T00:00:01Z",
    payload: { type: "task_started", turn_id: "turn-1" },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-01-01T00:00:02Z",
    payload: {
      type: "function_call",
      name: "read_file",
      call_id: "call-1",
      arguments: JSON.stringify({ path: "/tmp/project/a.ts" }),
      internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
    },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-01-01T00:00:03Z",
    payload: { type: "function_call_output", call_id: "call-1", output: [{ type: "input_text", text: "const x = 1;" }] },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-01-01T00:00:04Z",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      call_id: "call-2",
      input: 'const r = await tools.exec_command({"cmd":"pwd","workdir":"/tmp"});\ntext(r.output);\n',
    },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-01-01T00:00:05Z",
    payload: { type: "custom_tool_call_output", call_id: "call-2", output: [{ type: "input_text", text: "/tmp\n" }] },
  }),
  JSON.stringify({
    type: "event_msg",
    timestamp: "2026-01-01T00:00:06Z",
    payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1234 } } },
  }),
];

describe("parseCodexSession", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads session_id and cwd from session_meta", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseCodexSession(file);
    expect(session.id).toBe("codex-sess-1");
    expect(session.cwd).toBe("/tmp/project");
    expect(session.tool).toBe("codex");
  });

  it("pairs function_call with function_call_output and extracts the JSON-argument target", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseCodexSession(file);
    const readCall = session.toolCalls.find((c) => c.name === "read_file");
    expect(readCall).toMatchObject({ target: "/tmp/project/a.ts", outputChars: 12 });
  });

  it("pairs custom_tool_call (raw-JS input) with its output and extracts a target via regex fallback", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseCodexSession(file);
    const execCall = session.toolCalls.find((c) => c.name === "exec");
    expect(execCall).toMatchObject({ target: "pwd", outputChars: 5 });
  });

  it("takes the cumulative total straight from the log's own token_count event", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    writeFileSync(file, LINES.join("\n"));

    const session = parseCodexSession(file);
    expect(session.tokenSamples).toEqual([{ timestamp: "2026-01-01T00:00:06Z", cumulativeTotal: 1234 }]);
  });

  it("marks a session as a fork when session_meta.source carries a subagent key", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    const forkLines = LINES.map((l) => {
      const parsed = JSON.parse(l);
      if (parsed.type === "session_meta") parsed.payload.source = { subagent: { other: "guardian" } };
      return JSON.stringify(parsed);
    });
    writeFileSync(file, forkLines.join("\n"));

    expect(parseCodexSession(file).isFork).toBe(true);
  });

  it("defaults isFork to false for a normal vscode-sourced session", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    writeFileSync(file, LINES.join("\n"));

    expect(parseCodexSession(file).isFork).toBe(false);
  });

  it("derives compaction preTokens/postTokens from the surrounding token_count samples, with an honest 'unknown' trigger", () => {
    dir = mkdtempSync(join(tmpdir(), "token-coach-test-"));
    const file = join(dir, "rollout-test.jsonl");
    const withCompaction = [
      ...LINES,
      JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:06.5Z", payload: { type: "context_compacted" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-01-01T00:00:07Z",
        payload: { type: "token_count", info: { total_token_usage: { total_tokens: 50 } } },
      }),
    ];
    writeFileSync(file, withCompaction.join("\n"));

    const session = parseCodexSession(file);
    expect(session.compactions).toEqual([
      { timestamp: "2026-01-01T00:00:06.5Z", trigger: "unknown", preTokens: 1234, postTokens: 50, durationMs: undefined },
    ]);
  });
});
