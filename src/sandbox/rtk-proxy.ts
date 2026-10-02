/**
 * Rewrite shell commands through `rtk` (token-optimized proxy) by default.
 * Prefers `rtk rewrite` (upstream single source of truth); falls back to a
 * local allowlist if rewrite is unavailable.
 */
import { execFileSync, spawnSync } from "node:child_process";

let cachedRtkPath: string | null | undefined;

/** Resolve rtk binary once; null if missing. Override with RTK_BIN. */
export function resolveRtkBin(): string | null {
  if (process.env.RTK_PROXY === "0" || process.env.RTK_DISABLED === "1") {
    return null;
  }
  if (cachedRtkPath !== undefined) return cachedRtkPath;
  const fromEnv = process.env.RTK_BIN?.trim();
  if (fromEnv) {
    cachedRtkPath = fromEnv;
    return cachedRtkPath;
  }
  try {
    const out = execFileSync("which", ["rtk"], {
      encoding: "utf8",
      timeout: 2_000,
    }).trim();
    cachedRtkPath = out || null;
  } catch {
    cachedRtkPath = null;
  }
  return cachedRtkPath;
}

/** Reset cache (tests). */
export function resetRtkBinCache(): void {
  cachedRtkPath = undefined;
}

/** Normalize and insert `--ultra-compact` for rtk invocations, fixing invalid `-u` flags. */
export function injectUltraCompact(command: string): string {
  let res = command;
  // Normalize `rtk -u <cmd>` to `rtk --ultra-compact <cmd>`
  res = res.replace(/\brtk\s+-u\b/g, "rtk --ultra-compact");
  // Insert `--ultra-compact` after bare `rtk` (e.g. `rtk git status` -> `rtk --ultra-compact git status`)
  res = res.replace(/\brtk\b(?!\s+--ultra-compact\b)/g, "rtk --ultra-compact");
  // Strip accidental trailing `-u` (e.g., `rtk --ultra-compact tsc -u` -> `rtk --ultra-compact tsc`)
  res = res.replace(/(rtk\s+--ultra-compact\s+[^&|;\n]+?)\s+-u(?=\s*(?:&&|\|\||;|\n|$))/g, "$1");
  return res;
}

/** First-token commands that map 1:1 onto `rtk <cmd> …` (fallback). */
const DIRECT_PROXY = new Set([
  "ls",
  "tree",
  "git",
  "gh",
  "glab",
  "gt",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "cargo",
  "go",
  "docker",
  "kubectl",
  "aws",
  "psql",
  "prisma",
  "tsc",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "pytest",
  "playwright",
  "rspec",
  "rake",
  "rubocop",
  "ruff",
  "mypy",
  "next",
  "curl",
  "wget",
  "find",
  "wc",
  "env",
  "grep",
  "rg",
  "diff",
  "dotnet",
  "pip",
  "gradlew",
  "golangci-lint",
]);

/**
 * Ensure a single shell statement uses rtk when applicable (local fallback).
 * Already-rtk commands get `--ultra-compact` if missing.
 */
export function ensureRtkProxySegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return segment;

  const leadWs = segment.match(/^\s*/)?.[0] ?? "";
  const trailWs = segment.match(/\s*$/)?.[0] ?? "";
  const body = segment.slice(leadWs.length, segment.length - trailWs.length);

  // cat foo.json / *.log → rtk json / log (prefer specialized filters)
  const catJson = /^cat\s+(\S+\.json)\s*$/i.exec(body);
  if (catJson) {
    return `${leadWs}rtk --ultra-compact json ${catJson[1]}${trailWs}`;
  }
  const catLog = /^cat\s+(\S+\.(?:log|txt|out))\s*$/i.exec(body);
  if (catLog) {
    return `${leadWs}rtk --ultra-compact log ${catLog[1]}${trailWs}`;
  }
  // other cat → rtk read
  const catAny = /^cat\s+(\S+)\s*$/i.exec(body);
  if (catAny) {
    return `${leadWs}rtk --ultra-compact read ${catAny[1]}${trailWs}`;
  }

  // eslint → rtk lint
  if (/^eslint(\s|$)/.test(body)) {
    const rest = body.replace(/^eslint\b/, "").trimStart();
    return `${leadWs}rtk --ultra-compact lint${rest ? ` ${rest}` : ""}${trailWs}`;
  }
  // rg → rtk grep
  if (/^rg(\s|$)/.test(body)) {
    const rest = body.replace(/^rg\b/, "").trimStart();
    return `${leadWs}rtk --ultra-compact grep${rest ? ` ${rest}` : ""}${trailWs}`;
  }

  if (/^rtk(\s|$)/.test(body)) {
    return `${leadWs}${injectUltraCompact(body)}${trailWs}`;
  }

  const m = /^([A-Za-z0-9._+-]+)(\s|$)/.exec(body);
  if (!m) return segment;
  const cmd = m[1]!;
  if (!DIRECT_PROXY.has(cmd)) return segment;

  // Avoid wrapping when clearly an assignment (except env)
  if (body.includes("=") && !body.startsWith("env")) return segment;

  return `${leadWs}${injectUltraCompact(`rtk ${body}`)}${trailWs}`;
}

/**
 * Ask `rtk rewrite` for the canonical RTK form. Returns null if unsupported
 * or rewrite failed.
 */
export function rewriteViaRtk(bin: string, command: string): string | null {
  const result = spawnSync(bin, ["rewrite", command], {
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 256 * 1024,
  });
  const out = (result.stdout ?? "").trim();
  if (!out) return null;
  return injectUltraCompact(out);
}

/**
 * Rewrite a full shell line (may contain && / || / ; / newlines).
 * No-op when rtk is unavailable or RTK_PROXY=0.
 */
export function ensureRtkProxy(command: string): string {
  if (!command?.trim()) return command;
  const bin = resolveRtkBin();
  if (!bin) return command;

  // Prefer upstream rewrite (handles chains, eslint→lint, cat→read, …)
  try {
    const rewritten = rewriteViaRtk(bin, command);
    if (rewritten) return rewritten;
  } catch {
    // fall through to local mapping
  }

  // Local fallback when rewrite exits empty (unsupported) — still map known cmds
  // so chains like `python x && git status` get the git side proxied.
  const parts = command.split(/(\s*(?:&&|\|\||;|\n)\s*)/);
  return parts
    .map((part) => {
      if (/^\s*(?:&&|\|\||;|\n)\s*$/.test(part)) return part;
      return ensureRtkProxySegment(part);
    })
    .join("");
}
