import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type GuardrailDecision =
  | { ok: true; requiresApproval: boolean; reason?: string }
  | { ok: false; reason: string };

const BLOCKED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)?\/(\s|$)/,
    reason: "blocked: rm targeting filesystem root",
  },
  { re: /\brm\s+-rf\s+\/\b/, reason: "blocked: rm -rf /" },
  { re: /\bmkfs(\.\w+)?\b/, reason: "blocked: mkfs" },
  { re: /\bdd\s+.*\bof=\/dev\//, reason: "blocked: dd to device" },
  { re: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, reason: "blocked: chmod 777 /" },
  { re: /\b:(){ :\|:& };:/, reason: "blocked: fork bomb" },
  { re: /\bcurl\s+[^\n]*\|\s*(ba)?sh\b/, reason: "blocked: curl|sh pipe" },
  { re: /\bwget\s+[^\n]*\|\s*(ba)?sh\b/, reason: "blocked: wget|sh pipe" },
  {
    re: /\bosascript\b/i,
    reason:
      "blocked: raw osascript — use desktop_automate / request_desktop_app_access",
  },
  {
    re: /\bosacompile\b/i,
    reason: "blocked: osacompile — use desktop_automate instead",
  },
];

const DESTRUCTIVE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-rf?\b/, reason: "destructive: recursive/forced delete" },
  { re: /\bgit\s+push\s+[^\n]*--force\b/, reason: "destructive: force push" },
  { re: /\bgit\s+reset\s+--hard\b/, reason: "destructive: hard reset" },
  { re: /\bdrop\s+(database|table)\b/i, reason: "destructive: SQL drop" },
  { re: /\btruncate\s+table\b/i, reason: "destructive: SQL truncate" },
  { re: /\bchmod\s+-R\b/, reason: "destructive: recursive chmod" },
  { re: /\bchown\s+-R\b/, reason: "destructive: recursive chown" },
];

/**
 * Reject obviously catastrophic commands; flag destructive ones for HITL approval.
 */
export function checkCommand(command: string): GuardrailDecision {
  const normalized = command.trim();
  if (!normalized) {
    return { ok: false, reason: "empty command" };
  }

  for (const { re, reason } of BLOCKED_PATTERNS) {
    if (re.test(normalized)) {
      return { ok: false, reason };
    }
  }

  for (const { re, reason } of DESTRUCTIVE_PATTERNS) {
    if (re.test(normalized)) {
      return { ok: true, requiresApproval: true, reason };
    }
  }

  return { ok: true, requiresApproval: false };
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  candidate: string,
): string {
  const expanded = expandUserPath(candidate);
  const root = resolveRealPath(path.resolve(workspaceRoot));
  const lexical = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(root, expanded);
  return resolveRealPath(lexical);
}

export function isPathInsideWorkspace(
  workspaceRoot: string,
  candidate: string,
): boolean {
  const resolvedRoot = resolveRealPath(path.resolve(workspaceRoot));
  const resolved = resolveWorkspacePath(workspaceRoot, candidate);
  const rel = path.relative(resolvedRoot, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True if candidate resolves inside any of the allowlisted roots. */
export function isPathInsideAnyRoot(
  allowedRoots: string[],
  candidate: string,
  cwd?: string,
): boolean {
  const base = cwd ?? allowedRoots[0] ?? process.cwd();
  const resolved = resolveWorkspacePath(base, candidate);
  return allowedRoots.some((root) => {
    const realRoot = resolveRealPath(path.resolve(root));
    const rel = path.relative(realRoot, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/**
 * Extract path-like tokens from a shell command for confinement checks.
 */
export function extractPathCandidates(command: string): string[] {
  const out: string[] = [];
  const re =
    /(?<![A-Za-z0-9_])(\/(?:[^\s'";|&<>]+)|~(?:\/[^\s'";|&<>]*)?|(?:\.\.?(?:\/[^\s'";|&<>]+)+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const token = match[1]?.replace(/[",']+$/g, "");
    if (!token || token === "." || token === "..") continue;
    if (token.startsWith("//") || token.includes("://")) continue;
    out.push(token);
  }
  return out;
}

/**
 * Block shell commands that reference paths outside the allowlisted folders.
 */
export function checkCommandWorkspaceAccess(
  command: string,
  allowedRoots: string[],
  cwd: string,
): GuardrailDecision {
  if (allowedRoots.length === 0) {
    return { ok: false, reason: "no allowed workspace roots configured" };
  }

  const cdMatch = command.match(
    /\b(?:cd|pushd)\s+((?:'[^']+'|"[^"]+"|[^\s;|&]+))/i,
  );
  if (cdMatch?.[1]) {
    const target = cdMatch[1].replace(/^['"]|['"]$/g, "");
    if (!isPathInsideAnyRoot(allowedRoots, target, cwd)) {
      return {
        ok: false,
        reason: `blocked: cd/pushd outside allowed folders (${target})`,
      };
    }
  }

  for (const token of extractPathCandidates(command)) {
    if (!isPathInsideAnyRoot(allowedRoots, token, cwd)) {
      return {
        ok: false,
        reason: `blocked: path outside allowed folders (${token})`,
      };
    }
  }

  return { ok: true, requiresApproval: false };
}

export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function resolveRealPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    // Walk up to an existing ancestor, realpath it, then rejoin the tail.
    const parts = abs.split(path.sep);
    for (let i = parts.length - 1; i > 0; i -= 1) {
      const prefix = parts.slice(0, i).join(path.sep) || path.sep;
      try {
        const realPrefix = fs.realpathSync(prefix);
        const tail = parts.slice(i).join(path.sep);
        return tail ? path.join(realPrefix, tail) : realPrefix;
      } catch {
        /* keep walking */
      }
    }
    return abs;
  }
}
