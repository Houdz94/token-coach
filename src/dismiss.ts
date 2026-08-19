import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function defaultDismissedStorePath(): string {
  return join(homedir(), ".token-coach", "dismissed.json");
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readStore(storePath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(storePath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Marks a file "fixed" as of its current content — not "hidden forever".
 * findBloatedRulesFile stops flagging it as long as the file matches
 * exactly what was dismissed; if the file changes again (more bloat added
 * later), the stored hash no longer matches and the finding comes back on
 * its own, no re-dismissal needed to "expire" a stale silence. This is
 * what "the alert never goes away even after I tightened it" needed: a
 * real fixed-it signal, not a heuristic tuned to guess what "tightened
 * enough" means for every possible file.
 */
export function dismissFile(path: string, storePath: string = defaultDismissedStorePath()): { path: string; hash: string } {
  const text = readFileSync(path, "utf8");
  const hash = contentHash(text);

  const store = readStore(storePath);
  store[path] = hash;

  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));

  return { path, hash };
}

/** True only if `path` was dismissed AND its content hasn't changed since. */
export function isDismissed(path: string, currentText: string, storePath: string = defaultDismissedStorePath()): boolean {
  if (!existsSync(storePath)) return false;
  const store = readStore(storePath);
  return store[path] === contentHash(currentText);
}
