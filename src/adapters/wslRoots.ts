import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// UNVERIFIED ON REAL WINDOWS/WSL — built from documented WSL path
// conventions and `wsl.exe` CLI behavior, not tested against an actual
// Windows+WSL machine (this project was built on macOS). If you hit
// issues here on a real WSL setup, please open an issue with your
// `wsl --version` output and exact error.
//
// Why this exists: a "Windows machine" running Claude Code / Codex inside
// WSL Ubuntu does NOT have `.claude`/`.codex` under the Windows user
// profile — they're on WSL's own Linux filesystem, reachable from Windows
// only via the `\\wsl.localhost\<Distro>\...` (or the older `\\wsl$\...`)
// UNC path, under WSL's own (often different-from-Windows) username. A
// Windows-native build that only checked `%USERPROFILE%` would silently
// find nothing for exactly this setup.

const UNC_PREFIXES = ["wsl.localhost", "wsl$"];

/** Distro names from `wsl.exe -l -q` — quiet-list, one name per line. Empty on any failure (not on WSL, wsl.exe missing, no distros, ...). */
function listWslDistros(): string[] {
  if (process.platform !== "win32") return [];
  try {
    const raw = execFileSync("wsl.exe", ["-l", "-q"], { encoding: "utf16le", timeout: 5000 });
    return raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The Linux username WSL actually runs as inside a given distro — frequently different from the Windows account name. */
function wslUsername(distro: string): string | undefined {
  try {
    const raw = execFileSync("wsl.exe", ["-d", distro, "--", "whoami"], { encoding: "utf8", timeout: 5000 });
    const name = raw.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Additional roots to scan beyond the native Windows homedir-based one,
 * for a given relative path under a user's home (e.g. [".claude",
 * "projects"] or [".codex", "sessions"]). No-op on any non-Windows
 * platform — macOS/Linux already resolve correctly via os.homedir().
 */
export function findWslRoots(relativeParts: string[]): string[] {
  if (process.platform !== "win32") return [];
  const roots: string[] = [];

  for (const distro of listWslDistros()) {
    const user = wslUsername(distro);
    if (!user) continue;

    // Only the first working prefix per distro — wsl.localhost and wsl$
    // are two UNC namespaces for the SAME underlying filesystem, so
    // adding both would scan every session file (and every fork, which
    // shares its parent's sessionId — see the adapters' loader comments)
    // twice under two different paths.
    for (const prefix of UNC_PREFIXES) {
      const root = join(`\\\\${prefix}\\${distro}`, "home", user, ...relativeParts);
      if (existsSync(root)) {
        roots.push(root);
        break;
      }
    }
  }

  return roots;
}
