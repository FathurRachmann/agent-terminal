/**
 * Cursor-style Run Modes for shell / MCP / desktop HITL.
 * Folder grants HITL only when Privacy is ON (see tryAutoResolve + run-agent).
 */

export type RunMode = "auto-review" | "allowlist" | "run-everything";

export const RUN_MODES: readonly RunMode[] = [
  "auto-review",
  "allowlist",
  "run-everything",
] as const;

export function isRunMode(value: unknown): value is RunMode {
  return (
    value === "auto-review" ||
    value === "allowlist" ||
    value === "run-everything"
  );
}

/**
 * Migrate legacy `autoApproveDestructive` into RunMode.
 * Prefer explicit `runMode` when present.
 */
export function resolveRunMode(options: {
  runMode?: unknown;
  autoApproveDestructive?: boolean;
}): RunMode {
  if (isRunMode(options.runMode)) return options.runMode;
  if (options.autoApproveDestructive === true) return "run-everything";
  if (options.autoApproveDestructive === false) return "auto-review";
  return "auto-review";
}

/** Tools that are auto in Cursor Agent mode (no Run Mode gate). */
export const SAFE_READ_TOOLS = new Set([
  "ls",
  "read_file",
  "read",
  "glob",
  "grep",
  "web_search",
  "web_extract",
  "memory_recall",
  "memory_store",
  "remember_rule",
  "show_allowed_folders",
  "show_desktop_apps",
  "graphify_status",
  "graphify_query",
  "graphify_path",
  "graphify_explain",
  "graphify_update",
  "find_symbol",
  "find_references",
  "git_status",
  "git_diff",
  "git_log",
  "read_document",
  "vision_analyze",
  "task_status",
  "task_verify",
  "task_todo_update",
]);

const DESKTOP_RISKY = new Set([
  "desktop_automate",
  "request_desktop_app_access",
  "computer_screenshot",
  "computer_click",
  "computer_type",
  "computer_key",
]);

const GIT_MUTATE = new Set(["git_add", "git_commit"]);

/** Shell / MCP / desktop / git-mutate — gated by Run Modes. */
export function isRunModeGatedTool(name: string): boolean {
  const n = String(name || "").trim();
  if (!n) return false;
  if (n === "execute") return true;
  if (GIT_MUTATE.has(n)) return true;
  if (DESKTOP_RISKY.has(n)) return true;
  if (n.startsWith("mcp_")) return true;
  if (n.startsWith("browser_")) return true;
  return false;
}

/**
 * Allowlist entry matches tool name exactly, or shell command prefix
 * (e.g. "git status", "npm test").
 */
export function matchesToolAllowlist(
  toolName: string,
  args: unknown,
  allowlist: readonly string[],
): boolean {
  if (!allowlist.length) return false;
  const name = String(toolName || "").trim();
  const normalized = allowlist
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (normalized.some((e) => e === name || e === `tool:${name}`)) {
    return true;
  }
  if (name === "execute") {
    const cmd = extractExecuteCommand(args);
    if (!cmd) return false;
    return normalized.some((entry) => {
      if (entry.startsWith("tool:")) return false;
      const prefix = entry.toLowerCase();
      return cmd.toLowerCase().startsWith(prefix);
    });
  }
  return false;
}

export function extractExecuteCommand(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  return String(obj.command ?? obj.cmd ?? "").trim();
}

export type BuildInterruptOnOptions = {
  runMode: RunMode;
  requirePlanApproval?: boolean;
  desktopEnabled?: boolean;
  /** MCP / custom risky tool names to gate when not run-everything. */
  extraGatedTools?: string[];
};

/**
 * Deep Agents interruptOn map.
 * Edits are NOT listed — auto-apply except config-edit middleware.
 * Folder access stays registered so Privacy ON mid-session still interrupts;
 * Privacy OFF auto-approves at runtime (no Approve/Deny UI).
 */
export function buildInterruptOn(
  options: BuildInterruptOnOptions,
): Record<string, boolean> {
  const interruptOn: Record<string, boolean> = {
    request_folder_access: true,
  };
  if (options.requirePlanApproval !== false) {
    interruptOn.task_todos = true;
  }
  if (options.runMode === "run-everything") {
    return interruptOn;
  }
  interruptOn.execute = true;
  interruptOn.git_add = true;
  interruptOn.git_commit = true;
  if (options.desktopEnabled) {
    for (const name of DESKTOP_RISKY) {
      interruptOn[name] = true;
    }
  }
  for (const name of options.extraGatedTools ?? []) {
    if (isRunModeGatedTool(name) || name.startsWith("mcp_")) {
      interruptOn[name] = true;
    }
  }
  return interruptOn;
}

export type RunModeController = {
  getRunMode: () => RunMode;
  setRunMode: (mode: RunMode) => void;
  getAllowlist: () => string[];
  setAllowlist: (entries: string[]) => void;
};

export function createRunModeController(initial?: {
  runMode?: RunMode;
  toolAllowlist?: string[];
}): RunModeController {
  let runMode: RunMode = initial?.runMode ?? "auto-review";
  let allowlist = [...(initial?.toolAllowlist ?? [])];
  return {
    getRunMode: () => runMode,
    setRunMode: (mode) => {
      runMode = mode;
    },
    getAllowlist: () => [...allowlist],
    setAllowlist: (entries) => {
      allowlist = entries.map(String).map((s) => s.trim()).filter(Boolean);
    },
  };
}
