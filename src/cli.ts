import { loadClaudeCodeSessions } from "./adapters/claudeCode.js";
import { loadCodexSessions } from "./adapters/codex.js";
import { analyzeSessions } from "./analyze/index.js";
import { printTerminalReport } from "./report/terminalReport.js";
import { cleanOldSessions, archiveSessionsByIds, defaultArchiveDir } from "./clean.js";
import { toJsonReport } from "./report/jsonReport.js";
import { findActiveSessions } from "./live.js";
import { dismissFile } from "./dismiss.js";
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
  sessionIds: string[] | undefined;
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
  let sessionIds: string[] | undefined;
  let dryRun = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tool") tool = parseTool(argv[++i]);
    else if (arg === "--older-than-days") olderThanDays = Number(argv[++i]) || olderThanDays;
    else if (arg === "--session-ids") {
      sessionIds = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
  }

  return { tool, olderThanDays, sessionIds, dryRun, json };
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
  token-coach clean --session-ids id1,id2,... [--dry-run] [--json]
  token-coach live [--minutes 20] [--json]
  token-coach dismiss --path <file> [--json]
  token-coach --help

Reads session logs from:
  ~/.claude/projects/**/*.jsonl
  ~/.codex/sessions/**/rollout-*.jsonl

"clean" MOVES session logs to ${defaultArchiveDir()} — nothing is deleted.
Without --session-ids it sweeps by age; with it, it archives exactly the
sessions named (e.g. the sessionId of a specific finding from --json).

"dismiss" marks a bloated-rules-file finding fixed as of the file's
CURRENT content — it stays quiet only until that file changes again, not
forever.

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
  const result = args.sessionIds
    ? archiveSessionsByIds({ sessionIds: args.sessionIds, dryRun: args.dryRun })
    : cleanOldSessions({ tool: args.tool, olderThanDays: args.olderThanDays, dryRun: args.dryRun });

  if (args.json) {
    console.log(JSON.stringify(result));
    return;
  }

  if (result.files.length === 0) {
    console.log(args.sessionIds ? "None of those session ids were found. Nothing to do." : `Nothing older than ${args.olderThanDays} days found. Nothing to do.`);
    return;
  }
  const verb = args.dryRun ? "Would archive" : "Archived";
  const mb = (result.totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`${verb} ${result.files.length} session file(s), ${mb} MB, to ${result.archiveDir}`);
  if (args.dryRun) console.log("(dry run — nothing was moved. Re-run without --dry-run to apply.)");
}

function runLive(argv: string[]): void {
  let minutes = 20;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--minutes") minutes = Number(argv[++i]) || minutes;
    else if (argv[i] === "--json") json = true;
  }

  const active = findActiveSessions(minutes);

  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), windowMinutes: minutes, activeSessions: active }));
    return;
  }

  if (active.length === 0) {
    console.log(`No session active in the last ${minutes} minutes.`);
    return;
  }

  for (const s of active) {
    console.log(`\n[${s.tool}] ${s.title ?? "(untitled)"} — ${s.cwd ?? "?"}`);
    if (s.lastMessage) console.log(`  last: "${s.lastMessage}"`);
    if (s.currentContextTokens !== undefined) console.log(`  context: ~${s.currentContextTokens.toLocaleString("en-US")} tokens`);
    for (const f of s.findings) {
      console.log(`  ${f.severity === "warn" ? "⚠" : "·"} ${f.title}`);
      console.log(`    ${f.detail}`);
      if (f.recommendation) console.log(`    → ${f.recommendation}`);
    }
  }
}

function runDismiss(argv: string[]): void {
  let path: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--path") path = argv[++i];
    else if (argv[i] === "--json") json = true;
  }

  if (!path) {
    console.error("dismiss requires --path <file>");
    process.exit(1);
  }

  const result = dismissFile(path);
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`Dismissed ${result.path} — it stays quiet until this file's content changes again.`);
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
  if (command === "live") return runLive(rest);
  if (command === "dismiss") return runDismiss(rest);

  printHelp();
  process.exit(1);
}

main();
