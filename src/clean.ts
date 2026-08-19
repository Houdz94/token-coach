import { renameSync, mkdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { findClaudeCodeSessionFiles, defaultClaudeCodeRoot, loadClaudeCodeSessions } from "./adapters/claudeCode.js";
import { findCodexSessionFiles, defaultCodexRoot, loadCodexSessions } from "./adapters/codex.js";
import type { ToolKind } from "./types.js";

export function defaultArchiveDir(): string {
  return join(homedir(), "token-coach-archive");
}

export interface ArchivedFile {
  tool: ToolKind;
  from: string;
  to: string;
  bytes: number;
  /** The session's own title/cwd, when known — a raw UUID filename ("a929ae39-....jsonl") means nothing to a human; this is what a confirmation dialog should actually show. */
  title: string | undefined;
  cwd: string | undefined;
}

export interface CleanResult {
  files: ArchivedFile[];
  totalBytes: number;
  archiveDir: string;
}

function moveFile(
  tool: ToolKind,
  root: string,
  path: string,
  archiveDir: string,
  dryRun: boolean | undefined,
  identity: { title?: string; cwd?: string } = {},
): ArchivedFile | undefined {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return undefined;
  }

  const rel = relative(root, path);
  const dest = join(archiveDir, tool, rel);

  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(path, dest);
  }

  return { tool, from: path, to: dest, bytes: stat.size, title: identity.title, cwd: identity.cwd };
}

/**
 * Moves session log files older than `olderThanDays` into `archiveDir`,
 * preserving their path relative to the tool's log root — this is a MOVE,
 * not a delete or a zip: nothing is lost, it's just out of the directory
 * token-coach (and the CLI itself) actively scans. `dryRun` reports what
 * WOULD move without touching anything.
 */
export function cleanOldSessions(options: {
  tool: ToolKind | "all";
  olderThanDays: number;
  archiveDir?: string;
  dryRun?: boolean;
  /** Override the log roots — tests point these at a temp dir instead of the real ~/.claude / ~/.codex. */
  claudeRoot?: string;
  codexRoot?: string;
}): CleanResult {
  const archiveDir = options.archiveDir ?? defaultArchiveDir();
  const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000;
  const files: ArchivedFile[] = [];

  function collect(tool: ToolKind, root: string, paths: string[]) {
    for (const path of paths) {
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.mtimeMs >= cutoff) continue;
      const moved = moveFile(tool, root, path, archiveDir, options.dryRun);
      if (moved) files.push(moved);
    }
  }

  if (options.tool === "all" || options.tool === "claude-code") {
    const root = options.claudeRoot ?? defaultClaudeCodeRoot();
    collect("claude-code", root, findClaudeCodeSessionFiles(root));
  }
  if (options.tool === "all" || options.tool === "codex") {
    const root = options.codexRoot ?? defaultCodexRoot();
    collect("codex", root, findCodexSessionFiles(root));
  }

  return { files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), archiveDir };
}

/**
 * Moves exactly the session files named by `sessionIds` into `archiveDir` —
 * the targeted counterpart to `cleanOldSessions`'s age-based sweep. This is
 * what the desktop app's "archive the sessions flagged above" button calls:
 * the ids come straight from a Finding's `sessionId`, so what gets moved is
 * exactly what was shown as a problem, not an unrelated date cutoff.
 */
export function archiveSessionsByIds(options: {
  sessionIds: string[];
  archiveDir?: string;
  dryRun?: boolean;
  claudeRoot?: string;
  codexRoot?: string;
}): CleanResult {
  const archiveDir = options.archiveDir ?? defaultArchiveDir();
  const wanted = new Set(options.sessionIds);
  const files: ArchivedFile[] = [];

  const claudeRoot = options.claudeRoot ?? defaultClaudeCodeRoot();
  for (const session of loadClaudeCodeSessions(claudeRoot)) {
    if (!wanted.has(session.id)) continue;
    const moved = moveFile("claude-code", claudeRoot, session.sourcePath, archiveDir, options.dryRun, {
      title: session.title,
      cwd: session.cwd,
    });
    if (moved) files.push(moved);
  }

  const codexRoot = options.codexRoot ?? defaultCodexRoot();
  for (const session of loadCodexSessions(codexRoot)) {
    if (!wanted.has(session.id)) continue;
    const moved = moveFile("codex", codexRoot, session.sourcePath, archiveDir, options.dryRun, {
      title: session.title,
      cwd: session.cwd,
    });
    if (moved) files.push(moved);
  }

  return { files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), archiveDir };
}

/** Permanently deletes a previously-archived tree. Separate, explicit, never called by `clean` itself. */
export function purgeArchive(archiveDir: string = defaultArchiveDir()): void {
  rmSync(archiveDir, { recursive: true, force: true });
}
