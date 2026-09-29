/**
 * Cursor-style chat modes — orthogonal to agentKind (general/research/ops).
 */

export type AgentChatMode = "agent" | "ask" | "plan" | "debug";

export const AGENT_CHAT_MODES: readonly AgentChatMode[] = [
  "agent",
  "ask",
  "plan",
  "debug",
] as const;

export function isAgentChatMode(value: unknown): value is AgentChatMode {
  return (
    value === "agent" ||
    value === "ask" ||
    value === "plan" ||
    value === "debug"
  );
}

export function parseAgentChatMode(
  value: unknown,
  fallback: AgentChatMode = "agent",
): AgentChatMode {
  return isAgentChatMode(value) ? value : fallback;
}

/** Read/search tools for Ask (+ Plan before Build). */
export const ASK_MODE_TOOLS: readonly string[] = [
  "ls",
  "read_file",
  "glob",
  "grep",
  "web_search",
  "web_extract",
  "memory_recall",
  "memory_store",
  "remember_rule",
  "show_allowed_folders",
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
  "task",
  "request_folder_access",
];

export const PLAN_MODE_TOOLS: readonly string[] = [
  ...ASK_MODE_TOOLS,
  "task_plan",
  "task_todos",
  "task_todo_update",
  "task_status",
  "task_verify",
];

/**
 * null = all tools (Agent / Debug / Plan-after-Build).
 * Non-null = allowlist for Ask / Plan-before-Build.
 */
export function chatModeToolAllowlist(
  mode: AgentChatMode,
  options?: { planUnlocked?: boolean },
): string[] | null {
  if (mode === "ask") return [...ASK_MODE_TOOLS];
  if (mode === "plan") {
    if (options?.planUnlocked) return null;
    return [...PLAN_MODE_TOOLS];
  }
  return null;
}

export function chatModeSystemOverlay(mode: AgentChatMode): string {
  switch (mode) {
    case "ask":
      return [
        "## Chat mode: Ask (read-only)",
        "Answer questions by reading and searching only.",
        "Do NOT edit files, run shell/execute, commit, or use desktop automation.",
        "If the user wants changes, tell them to switch to Agent or Plan mode.",
      ].join("\n");
    case "plan":
      return [
        "## Chat mode: Plan",
        "Research the codebase, ask clarifying questions if needed, then produce an implementation plan via `task_todos`.",
        "Do NOT edit files or run mutating shell until the user Approves the plan (Build).",
        "After approval, you may implement under normal Run Mode rules.",
      ].join("\n");
    case "debug":
      return [
        "## Chat mode: Debug",
        "Prioritize runtime evidence: reproduce → collect logs/exit codes → isolate root cause → minimal fix.",
        "Prefer execute/PTY, git_status, tests, and read_file over speculative edits.",
        "State the hypothesis and the evidence that confirmed or rejected it.",
      ].join("\n");
    default:
      return "";
  }
}

/** Intersect two allowlists. null means unrestricted. */
export function intersectAllowlists(
  a: string[] | null,
  b: string[] | null,
): string[] | null {
  if (a == null) return b ? [...b] : null;
  if (b == null) return [...a];
  const setB = new Set(b);
  return a.filter((t) => setB.has(t));
}

export type PlanGateController = {
  isUnlocked: () => boolean;
  unlock: () => void;
  lock: () => void;
};

export function createPlanGateController(
  initiallyUnlocked = false,
): PlanGateController {
  let unlocked = initiallyUnlocked;
  return {
    isUnlocked: () => unlocked,
    unlock: () => {
      unlocked = true;
    },
    lock: () => {
      unlocked = false;
    },
  };
}
