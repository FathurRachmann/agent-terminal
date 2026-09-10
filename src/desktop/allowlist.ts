import fs from "node:fs";
import path from "node:path";
import { assertSafeAppName } from "./macos.js";

export const DEFAULT_DESKTOP_APPS = ["Google Chrome"] as const;

export type DesktopAllowlistFile = {
  apps: string[];
};

function allowlistPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "desktop-allowlist.json");
}

function normalizeAppName(name: string): string {
  return assertSafeAppName(name);
}

/**
 * Load persisted allowlist. Defaults to Google Chrome only.
 */
export function loadDesktopAllowlist(workspaceRoot: string): string[] {
  const file = allowlistPath(workspaceRoot);
  if (!fs.existsSync(file)) {
    return [...DEFAULT_DESKTOP_APPS];
  }
  try {
    const raw = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as DesktopAllowlistFile;
    const apps = Array.isArray(raw.apps)
      ? raw.apps
          .map((a) => {
            try {
              return normalizeAppName(String(a));
            } catch {
              return null;
            }
          })
          .filter((a): a is string => Boolean(a))
      : [];
    return apps.length > 0 ? unique(apps) : [...DEFAULT_DESKTOP_APPS];
  } catch {
    return [...DEFAULT_DESKTOP_APPS];
  }
}

export function saveDesktopAllowlist(
  workspaceRoot: string,
  apps: string[],
): string[] {
  const normalized = unique(
    apps
      .map((a) => {
        try {
          return normalizeAppName(a);
        } catch {
          return null;
        }
      })
      .filter((a): a is string => Boolean(a)),
  );
  const file = allowlistPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: DesktopAllowlistFile = { apps: normalized };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return normalized;
}

export function isAppAllowed(
  workspaceRoot: string,
  appName: string,
): boolean {
  try {
    const target = normalizeAppName(appName).toLowerCase();
    return loadDesktopAllowlist(workspaceRoot).some(
      (a) => a.toLowerCase() === target,
    );
  } catch {
    return false;
  }
}

/** Resolve input to the canonical allowlisted app name, or null. */
export function resolveAllowedAppName(
  workspaceRoot: string,
  appName: string,
): string | null {
  try {
    const target = normalizeAppName(appName).toLowerCase();
    return (
      loadDesktopAllowlist(workspaceRoot).find(
        (a) => a.toLowerCase() === target,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function grantDesktopApp(
  workspaceRoot: string,
  appName: string,
): string[] {
  const name = normalizeAppName(appName);
  const current = loadDesktopAllowlist(workspaceRoot);
  if (current.some((a) => a.toLowerCase() === name.toLowerCase())) {
    return current;
  }
  return saveDesktopAllowlist(workspaceRoot, [...current, name]);
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
