import { renameSync, mkdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { findClaudeCodeSessionFiles, defaultClaudeCodeRoot } from "./adapters/claudeCode.js";
import { findCodexSessionFiles, defaultCodexRoot } from "./adapters/codex.js";
import type { ToolKind } from "./types.js";

export function defaultArchiveDir(): string {
  return join(homedir(), "token-coach-archive");
}

export interface ArchivedFile {
  tool: ToolKind;
  from: string;
  to: string;
  bytes: number;
}

export interface CleanResult {
  files: ArchivedFile[];
  totalBytes: number;
  archiveDir: string;
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

      const rel = relative(root, path);
      const dest = join(archiveDir, tool, rel);
      files.push({ tool, from: path, to: dest, bytes: stat.size });

      if (!options.dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        renameSync(path, dest);
      }
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

/** Permanently deletes a previously-archived tree. Separate, explicit, never called by `clean` itself. */
export function purgeArchive(archiveDir: string = defaultArchiveDir()): void {
  rmSync(archiveDir, { recursive: true, force: true });
}
