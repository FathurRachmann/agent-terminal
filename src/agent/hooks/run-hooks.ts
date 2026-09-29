/**
 * Cursor-style agent hooks (.agent/hooks.json + ~/.agent/hooks.json).
 *
 * Supported hook names (subset of Cursor):
 *   sessionStart, sessionEnd, beforeSubmitPrompt,
 *   preToolUse, beforeShellExecution, beforeMCPExecution,
 *   postToolUse, stop, afterAgentResponse
 *
 * Command hooks receive JSON on stdin and may return JSON:
 *   { permission?: "allow"|"deny"|"ask", user_message?, agent_message?,
 *     continue?: boolean, additional_context? }
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

export type HookPermission = "allow" | "deny" | "ask";

export type HookCommandSpec = {
  command: string;
  type?: "command";
  timeout?: number;
  matcher?: string;
  failClosed?: boolean;
};

export type HooksConfig = {
  version?: number;
  hooks?: Record<string, HookCommandSpec[]>;
};

export type HookResult = {
  permission?: HookPermission;
  user_message?: string;
  agent_message?: string;
  continue?: boolean;
  additional_context?: string;
  /** Aggregated from all matching hooks. */
  denied?: boolean;
  ask?: boolean;
};

const HOOK_NAMES = new Set([
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "beforeShellExecution",
  "beforeMCPExecution",
  "postToolUse",
  "stop",
  "afterAgentResponse",
  "preCompact",
]);

function readJsonc(file: string): HooksConfig | null {
  try {
    if (!fs.existsSync(file)) return null;
    let raw = fs.readFileSync(file, "utf8");
    // strip // and /* */ comments (JSONC-lite)
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(raw) as HooksConfig;
  } catch {
    return null;
  }
}

export function hooksPaths(options: {
  workspaceRoot: string;
  profileHome?: string;
}): { project: string; user: string; profile: string } {
  const home = os.homedir();
  return {
    project: path.join(options.workspaceRoot, ".agent", "hooks.json"),
    profile: path.join(
      options.profileHome || options.workspaceRoot,
      ".agent",
      "hooks.json",
    ),
    user: path.join(home, ".agent", "hooks.json"),
  };
}

/** Merge hook arrays: project + profile + user (all run; deny wins later). */
export function loadHooksConfig(options: {
  workspaceRoot: string;
  profileHome?: string;
}): HooksConfig {
  const paths = hooksPaths(options);
  const merged: Record<string, HookCommandSpec[]> = {};
  const seenFiles = new Set<string>();
  for (const file of [paths.user, paths.profile, paths.project]) {
    const abs = path.resolve(file);
    if (seenFiles.has(abs)) continue;
    seenFiles.add(abs);
    const cfg = readJsonc(file);
    if (!cfg?.hooks) continue;
    for (const [name, specs] of Object.entries(cfg.hooks)) {
      if (!HOOK_NAMES.has(name) || !Array.isArray(specs)) continue;
      merged[name] = [...(merged[name] ?? []), ...specs];
    }
  }
  return { version: 1, hooks: merged };
}

function matcherHits(matcher: string | undefined, haystack: string): boolean {
  if (!matcher || !matcher.trim()) return true;
  try {
    return new RegExp(matcher, "i").test(haystack);
  } catch {
    return haystack.toLowerCase().includes(matcher.toLowerCase());
  }
}

function runHookCommand(
  spec: HookCommandSpec,
  payload: Record<string, unknown>,
  cwd: string,
): HookResult {
  const timeoutMs = Math.max(1_000, Math.min(60_000, (spec.timeout ?? 30) * 1000));
  const cmd = spec.command.trim();
  if (!cmd) return {};

  const isShell = cmd.includes(" ") || cmd.endsWith(".sh") || cmd.endsWith(".py");
  const result = spawnSync(isShell ? "/bin/zsh" : cmd, isShell ? ["-lc", cmd] : [], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, AGENT_HOOK: "1" },
    maxBuffer: 1_000_000,
  });

  if (result.error || result.status === null) {
    if (spec.failClosed) {
      return {
        permission: "deny",
        agent_message: `Hook failed (failClosed): ${result.error?.message ?? "timeout"}`,
        denied: true,
      };
    }
    return {};
  }

  if (result.status === 2) {
    return {
      permission: "deny",
      denied: true,
      agent_message: (result.stderr || result.stdout || "denied by hook").trim(),
    };
  }

  if (result.status !== 0) {
    if (spec.failClosed) {
      return {
        permission: "deny",
        denied: true,
        agent_message: `Hook exit ${result.status} (failClosed)`,
      };
    }
    return {};
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) return {};
  try {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    const json = JSON.parse(stdout.slice(start, end + 1)) as HookResult;
    const perm = String(json.permission || "").toLowerCase();
    if (perm === "deny") json.denied = true;
    if (perm === "ask") json.ask = true;
    if (perm === "allow" || perm === "deny" || perm === "ask") {
      json.permission = perm;
    }
    return json;
  } catch {
    return {};
  }
}

function mergeHookResults(results: HookResult[]): HookResult {
  const out: HookResult = { continue: true };
  for (const r of results) {
    if (r.denied || r.permission === "deny") {
      out.denied = true;
      out.permission = "deny";
      out.continue = false;
    } else if (
      !out.denied &&
      (r.ask || r.permission === "ask")
    ) {
      out.ask = true;
      out.permission = "ask";
    } else if (!out.denied && !out.ask && r.permission === "allow") {
      out.permission = "allow";
    }
    if (typeof r.continue === "boolean" && r.continue === false) {
      out.continue = false;
    }
    if (r.user_message) {
      out.user_message = [out.user_message, r.user_message]
        .filter(Boolean)
        .join("\n");
    }
    if (r.agent_message) {
      out.agent_message = [out.agent_message, r.agent_message]
        .filter(Boolean)
        .join("\n");
    }
    if (r.additional_context) {
      out.additional_context = [out.additional_context, r.additional_context]
        .filter(Boolean)
        .join("\n\n");
    }
  }
  return out;
}

export async function runHooks(options: {
  name: string;
  workspaceRoot: string;
  profileHome?: string;
  payload: Record<string, unknown>;
  /** Tool name / command for matcher. */
  matcherHaystack?: string;
}): Promise<HookResult> {
  const cfg = loadHooksConfig({
    workspaceRoot: options.workspaceRoot,
    profileHome: options.profileHome,
  });
  const specs = cfg.hooks?.[options.name] ?? [];
  if (!specs.length) return {};

  const hay = options.matcherHaystack ?? "";
  const results: HookResult[] = [];
  for (const spec of specs) {
    if (!matcherHits(spec.matcher, hay)) continue;
    results.push(
      runHookCommand(spec, { ...options.payload, hook_event_name: options.name }, options.workspaceRoot),
    );
  }
  return mergeHookResults(results);
}
