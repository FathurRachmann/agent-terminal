/**
 * Default filesystem roots for the agent sandbox.
 *
 * Privacy OFF (default): entire machine via unrestrictedFilesystemRoots().
 * Privacy ON: project/workspace only via privacyStrictAllowedRoots() —
 * exit requires HITL `request_folder_access`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Resolved user home directory, or null if unavailable. */
export function userHomeRoot(): string | null {
  try {
    const home = path.resolve(os.homedir());
    if (home && fs.existsSync(home) && fs.statSync(home).isDirectory()) {
      return home;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Broad Users scope: `/Users` (macOS/Linux) or `C:\\Users` (Windows).
 * Falls back to the current user's home when the parent is missing.
 */
export function usersScopeRoot(): string | null {
  const home = userHomeRoot();
  if (!home) return null;
  const parent = path.dirname(home);
  const parentBase = path.basename(parent);
  if (
    parent === "/Users" ||
    /^users$/i.test(parentBase) ||
    /^Benutzer$/i.test(parentBase)
  ) {
    try {
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        return path.resolve(parent);
      }
    } catch {
      /* fall through */
    }
  }
  return home;
}

/**
 * Whole-machine roots for Privacy OFF.
 * Unix: `/`. Windows: drive root of the user home (e.g. `C:\\`).
 */
export function unrestrictedFilesystemRoots(): string[] {
  if (process.platform === "win32") {
    try {
      const root = path.parse(os.homedir()).root;
      if (root) return [path.resolve(root)];
    } catch {
      /* fall through */
    }
    return [];
  }
  return ["/"];
}

/** True when `candidate` is a broad Privacy-OFF root (/Users, home, or /). */
export function isBroadFilesystemRoot(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const broad = new Set(
    mergeAllowedRoots(
      unrestrictedFilesystemRoots(),
      usersScopeRoot() ? [usersScopeRoot()!] : null,
      userHomeRoot() ? [userHomeRoot()!] : null,
    ).map((r) => path.resolve(r)),
  );
  return broad.has(resolved);
}

/** Merge unique absolute roots; drops empties / duplicates. */
export function mergeAllowedRoots(
  ...groups: Array<string[] | null | undefined>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const raw of group) {
      const trimmed = String(raw || "").trim();
      if (!trimmed) continue;
      let real = path.resolve(trimmed);
      try {
        if (fs.existsSync(real)) real = fs.realpathSync(real);
      } catch {
        /* keep resolved */
      }
      if (seen.has(real)) continue;
      seen.add(real);
      out.push(real);
    }
  }
  return out;
}

/**
 * Privacy OFF allowlist: entire PC + workspace/artifact + project + HITL grants.
 */
export function defaultSandboxAllowedRoots(options: {
  workspaceRoot: string;
  artifactHome?: string | null;
  projectFolders?: string[] | null;
  persistedFolders?: string[] | null;
}): string[] {
  return mergeAllowedRoots(
    unrestrictedFilesystemRoots(),
    [options.workspaceRoot],
    options.artifactHome ? [options.artifactHome] : null,
    options.projectFolders,
    options.persistedFolders,
  );
}

/**
 * Privacy ON allowlist: workspace/artifact + active project folders + prior HITL grants.
 * No /Users or filesystem-root auto-expand.
 */
export function privacyStrictAllowedRoots(options: {
  workspaceRoot: string;
  artifactHome?: string | null;
  projectFolders?: string[] | null;
  persistedFolders?: string[] | null;
}): string[] {
  return mergeAllowedRoots(
    [options.workspaceRoot],
    options.artifactHome ? [options.artifactHome] : null,
    options.projectFolders,
    options.persistedFolders,
  );
}
