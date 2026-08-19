import { loadClaudeCodeSessions } from "./adapters/claudeCode.js";
import { loadCodexSessions } from "./adapters/codex.js";
import { analyzeSessions } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminalReport.js";
import type { Session, ToolKind } from "./types.js";

interface Args {
  command: string;
  tool: ToolKind | "all";
  limit: number;
  sinceDays: number | undefined;
}

function parseArgs(argv: string[]): Args {
  const command = argv[0] ?? "analyze";
  let tool: ToolKind | "all" = "all";
  let limit = 20;
  let sinceDays: number | undefined;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") {
      const value = argv[++i];
      if (value === "claude" || value === "claude-code") tool = "claude-code";
      else if (value === "codex") tool = "codex";
      else if (value === "all") tool = "all";
      else {
        console.error(`Unknown --tool value: ${value} (expected claude|codex|all)`);
        process.exit(1);
      }
    } else if (arg === "--limit") {
      limit = Number(argv[++i]) || limit;
    } else if (arg === "--since-days") {
      sinceDays = Number(argv[++i]);
    }
  }

  return { command, tool, limit, sinceDays };
}

function withinWindow(session: Session, sinceDays: number | undefined): boolean {
  if (sinceDays === undefined) return true;
  if (!session.startedAt) return true;
  const started = new Date(session.startedAt).getTime();
  if (Number.isNaN(started)) return true;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return started >= cutoff;
}

function loadSessions(tool: ToolKind | "all"): Session[] {
  const sessions: Session[] = [];
  if (tool === "all" || tool === "claude-code") sessions.push(...loadClaudeCodeSessions());
  if (tool === "all" || tool === "codex") sessions.push(...loadCodexSessions());
  return sessions;
}

function printHelp(): void {
  console.log(`token-coach — finds where your Claude Code / Codex tokens actually went

Usage:
  token-coach analyze [--tool claude|codex|all] [--limit N] [--since-days N]
  token-coach --help

Reads session logs from:
  ~/.claude/projects/**/*.jsonl
  ~/.codex/sessions/**/rollout-*.jsonl

Nothing leaves your machine. No network calls.
`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  if (args.command !== "analyze") {
    printHelp();
    process.exit(1);
  }

  const sessions = loadSessions(args.tool).filter((s) => withinWindow(s, args.sinceDays));
  const findings = analyzeSessions(sessions);
  printTerminalReport(sessions, findings, args.limit);
}

main();
