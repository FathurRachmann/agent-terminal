/**
 * Per-turn scope for EVERY chat entry (main session, bots, workspace, WhatsApp):
 * - which tools to expose (lean allowlist)
 * - which specialist agents / skills to prefer
 */
import { SPECIALIST_SUBAGENT_NAMES } from "../agent/subagents.js";
import { isTrivialGreeting } from "../agent/greeting-fast-path.js";
import {
  choiceOf,
  confidenceOf,
  decisionMinConfidence,
  getDecisionEngine,
  isDecisionEngineEnabled,
  noulOf,
} from "./engine.js";
import { TOOL_CATEGORY_MAP } from "./tool-filter.js";

/** Always available — coding/planning core. */
export const TURN_CORE_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "execute",
  "glob",
  "grep",
  "task",
  "task_plan",
  "task_todos",
  "task_todo_update",
  "task_status",
  "task_verify",
  "delegate_task",
  "memory_store",
  "memory_recall",
  "remember_rule",
  "graphify_status",
  "graphify_query",
  "graphify_path",
  "graphify_explain",
  "graphify_update",
  "request_folder_access",
  "show_allowed_folders",
] as const;

const AGENT_CRITERIA: Record<string, string> = {
  explorer: "map codebase find files symbols locations read-only",
  coder: "implement code changes multi-file build fix",
  reviewer: "review diff bugs quality missing tests",
  tester: "run tests edge cases regressions verify",
  security: "auth injection secrets unsafe shell security audit",
  debugger: "root cause logs stack traces failures",
  docs: "documentation readme guides writing",
  architect: "architecture design system tradeoffs roadmap",
  general: "general chat planning or mixed work no clear specialty",
};

export type TurnScope = {
  /** Tools the model may see this turn (null = do not force allowlist). */
  allowlist: string[] | null;
  preferredAgents: string[];
  nudge: string;
  source: "laya" | "heuristic" | "bypass";
  reason: string;
};

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Resolve tools + preferred specialists for this user prompt.
 * When decision engine is off → bypass (full tools, no nudge).
 * Tiny greets skip Laya entirely (instant heuristic/bypass feel).
 */
export async function resolveTurnScope(options: {
  prompt: string;
  /** If set, intersect with this allowlist (e.g. workspace bot tools). */
  baseAllowlist?: string[] | null;
}): Promise<TurnScope> {
  if (!isDecisionEngineEnabled()) {
    return {
      allowlist: options.baseAllowlist ?? null,
      preferredAgents: [],
      nudge: "",
      source: "bypass",
      reason: "decision engine disabled",
    };
  }

  const trimmed = String(options.prompt || "").trim();
  if (isTrivialGreeting(trimmed)) {
    return {
      allowlist: options.baseAllowlist
        ? unique([...TURN_CORE_TOOLS, ...options.baseAllowlist])
        : [...TURN_CORE_TOOLS],
      preferredAgents: [],
      nudge: "",
      source: "heuristic",
      reason: "short greeting — skip Laya",
    };
  }

  const engine = getDecisionEngine();
  const prompt = options.prompt.slice(0, 2000);
  const result = await engine.predict(
    { prompt },
    {
      needs_web: {
        type: "noul",
        instructions:
          "Does the user need live web search or fetching pages from the internet?",
      },
      needs_desktop: {
        type: "noul",
        instructions:
          "Does the user need macOS desktop automation (Chrome, apps, keystrokes)?",
      },
      needs_browser: {
        type: "noul",
        instructions:
          "Does the user need a headless browser for scraping or JS-heavy pages?",
      },
      needs_office: {
        type: "noul",
        instructions:
          "Does the user need to read or produce Word/Excel/PDF/Office documents?",
      },
      needs_vision: {
        type: "noul",
        instructions:
          "Does the user need image or screenshot visual analysis?",
      },
      needs_vault: {
        type: "noul",
        instructions:
          "Does the user need to store or retrieve secrets from the vault?",
      },
      primary_agent: {
        type: "choice",
        instructions:
          "Which specialist should lead this turn (or general if mixed/simple)?",
        criteria: AGENT_CRITERIA,
      },
      needs_multi_agent: {
        type: "noul",
        instructions:
          "Should multiple specialists collaborate (e.g. explorer then coder, or coder + tester)?",
      },
    },
  );

  const min = decisionMinConfidence();
  const source = result?.source === "laya" ? "laya" : "heuristic";
  const allow = new Set<string>(TURN_CORE_TOOLS);

  const categoryFlags: Array<[keyof typeof TOOL_CATEGORY_MAP, string]> = [
    ["web", "needs_web"],
    ["desktop", "needs_desktop"],
    ["browser", "needs_browser"],
    ["office", "needs_office"],
    ["vision", "needs_vision"],
    ["vault", "needs_vault"],
  ];
  const keptCats: string[] = [];
  for (const [cat, qid] of categoryFlags) {
    const p = noulOf(result, qid);
    if (p != null && p >= min) {
      for (const t of TOOL_CATEGORY_MAP[cat] ?? []) allow.add(t);
      keptCats.push(`${cat}:${p.toFixed(2)}`);
    }
  }

  // Office generation often needs execute + read_document already covered;
  // ensure document tool when office is needed.
  if (keptCats.some((c) => c.startsWith("office:"))) {
    allow.add("read_document");
  }

  let preferredAgents: string[] = [];
  const primary = choiceOf(result, "primary_agent");
  const primaryConf = confidenceOf(result, "primary_agent");
  if (
    primary &&
    primary !== "general" &&
    (SPECIALIST_SUBAGENT_NAMES as readonly string[]).includes(primary) &&
    primaryConf >= min * 0.85
  ) {
    preferredAgents.push(primary);
  }
  const multi = noulOf(result, "needs_multi_agent") ?? 0;
  if (multi >= min && result?.answers.primary_agent?.type === "choice") {
    const probs = result.answers.primary_agent.probabilities;
    const ranked = Object.entries(probs)
      .filter(
        ([id]) =>
          id !== "general" &&
          id !== primary &&
          (SPECIALIST_SUBAGENT_NAMES as readonly string[]).includes(id),
      )
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 2);
    preferredAgents.push(...ranked);
  }
  preferredAgents = unique(preferredAgents);

  let allowlist = [...allow];
  let baseAuthoritative = false;
  if (options.baseAllowlist?.length) {
    // Workspace / specialized bots already declare their tool set.
    // Never strip those tools — turn-scope only suggests agents/habits.
    allowlist = [...options.baseAllowlist];
    baseAuthoritative = true;
  }

  const nudgeParts: string[] = [
    "[TURN SCOPE — follow for speed and accuracy]",
  ];
  if (baseAuthoritative) {
    nudgeParts.push(
      "Your tool allowlist is already set for this role — use those tools freely; do not ask for disabled ones.",
      keptCats.length
        ? `Prompt signals that may help: ${keptCats.join(", ")}.`
        : "Stay inside your role tools; prefer evidence from files/shell over guessing.",
    );
  } else {
    nudgeParts.push(
      `Use only tools you need. Heavy tools enabled this turn: ${keptCats.length ? keptCats.join(", ") : "none (core only)"}.`,
    );
  }
  if (preferredAgents.length) {
    nudgeParts.push(
      `Prefer specialist subagents via \`task\` in this order: ${preferredAgents.join(" → ")}.`,
      "Call `task` early when the work matches those specialties; do not reinvent their job in the main loop.",
    );
  } else if (!baseAuthoritative) {
    nudgeParts.push(
      "No single specialist stands out — stay in the main loop unless a clear `task` handoff helps.",
    );
  }

  return {
    allowlist,
    preferredAgents,
    nudge: nudgeParts.join("\n"),
    source,
    reason: baseAuthoritative
      ? `base-tools agents=[${preferredAgents.join(",")}] cats=[${keptCats.join(",")}]`
      : `agents=[${preferredAgents.join(",")}] cats=[${keptCats.join(",")}]`,
  };
}
