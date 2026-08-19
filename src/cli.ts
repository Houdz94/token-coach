import { loadClaudeCodeSessions } from "./adapters/claudeCode.js";
import { loadCodexSessions } from "./adapters/codex.js";
import { analyzeSessions } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminalReport.js";
import { cleanOldSessions, defaultArchiveDir } from "./clean.js";
import { toJsonReport } from "./report/jsonReport.js";
import type { Session, ToolKind } from "./types.js";

interface AnalyzeArgs {
  tool: ToolKind | "all";
  limit: number;
  sinceDays: number | undefined;
  json: boolean;
}

interface CleanArgs {
  tool: ToolKind | "all";
  olderThanDays: number;
  dryRun: boolean;
  json: boolean;
}

function parseAnalyzeArgs(argv: string[]): AnalyzeArgs {
  let tool: ToolKind | "all" = "all";
  let limit = 20;
  let sinceDays: number | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") tool = parseTool(argv[++i]);
    else if (arg === "--limit") limit = Number(argv[++i]) || limit;
    else if (arg === "--since-days") sinceDays = Number(argv[++i]);
    else if (arg === "--json") json = true;
  }

  return { tool, limit, sinceDays, json };
}

function parseCleanArgs(argv: string[]): CleanArgs {
  let tool: ToolKind | "all" = "all";
  let olderThanDays = 30;
  let dryRun = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") tool = parseTool(argv[++i]);
    else if (arg === "--older-than-days") olderThanDays = Number(argv[++i]) || olderThanDays;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
  }

  return { tool, olderThanDays, dryRun, json };
}

function parseTool(value: string | undefined): ToolKind | "all" {
  if (value === "claude" || value === "claude-code") return "claude-code";
  if (value === "codex") return "codex";
  if (value === "all" || value === undefined) return "all";
  console.error(`Unknown --tool value: ${value} (expected claude|codex|all)`);
  process.exit(1);
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
  token-coach analyze [--tool claude|codex|all] [--limit N] [--since-days N] [--json]
  token-coach clean [--tool claude|codex|all] [--older-than-days 30] [--dry-run] [--json]
  token-coach --help

Reads session logs from:
  ~/.claude/projects/**/*.jsonl
  ~/.codex/sessions/**/rollout-*.jsonl

"clean" MOVES old session logs to ${defaultArchiveDir()} — nothing is deleted.

Nothing leaves your machine. No network calls.
`);
}

function runAnalyze(argv: string[]): void {
  const args = parseAnalyzeArgs(argv);
  const sessions = loadSessions(args.tool).filter((s) => withinWindow(s, args.sinceDays));
  const findings = analyzeSessions(sessions);

  if (args.json) {
    console.log(JSON.stringify(toJsonReport(sessions, findings)));
    return;
  }
  printTerminalReport(sessions, findings, args.limit);
}

function runClean(argv: string[]): void {
  const args = parseCleanArgs(argv);
  const result = cleanOldSessions({ tool: args.tool, olderThanDays: args.olderThanDays, dryRun: args.dryRun });

  if (args.json) {
    console.log(JSON.stringify(result));
    return;
  }

  if (result.files.length === 0) {
    console.log(`Nothing older than ${args.olderThanDays} days found. Nothing to do.`);
    return;
  }
  const verb = args.dryRun ? "Would archive" : "Archived";
  const mb = (result.totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`${verb} ${result.files.length} session file(s), ${mb} MB, to ${result.archiveDir}`);
  if (args.dryRun) console.log("(dry run — nothing was moved. Re-run without --dry-run to apply.)");
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    printHelp();
    return;
  }

  const [command, ...rest] = argv;
  if (command === "analyze") return runAnalyze(rest);
  if (command === "clean") return runClean(rest);

  printHelp();
  process.exit(1);
}

main();
