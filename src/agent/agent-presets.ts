/**
 * Top-level agent presets (3) — same tool runtime, different operating posture.
 * Selectable via CreateAgentOptions.agentKind / settings.agent.agentKind.
 */
import { SYSTEM_PROMPT } from "../prompts/system.js";

export type AgentKind = "general" | "research" | "ops";

export type AgentPreset = {
  id: AgentKind;
  name: string;
  description: string;
  /** DeepAgent / LangGraph name. */
  runtimeName: string;
  /** Extra system instructions appended after the base SYSTEM_PROMPT + SOUL. */
  overlay: string;
};

export const AGENT_PRESETS: readonly AgentPreset[] = [
  {
    id: "general",
    name: "General / Coding",
    description:
      "Default systems engineer — coding, repo navigation, plans, verify.",
    runtimeName: "terminal-agent",
    overlay: "",
  },
  {
    id: "research",
    name: "Research",
    description:
      "Deep research, docs, papers, web evidence — prefer read/search before edits.",
    runtimeName: "research-agent",
    overlay: `
## Agent posture: Research

You are the Research agent (one of three top-level agents).
Priorities:
- Prefer web_search, web_extract, MCP market tools (mcp_tradingview_*), read_document, memory_recall, graphify_query before changing code.
- For prices, news, people, or anything outside the repo: always web_search (and MCP when relevant) — never claim tools are unavailable without a failed tool result.
- Cite sources (URL/path) for claims. Distinguish fact vs inference.
- Produce structured briefs: findings, evidence, open questions, recommended next steps.
- Only edit code when the user explicitly asks to implement; otherwise deliver analysis.
- Delegate with \`task\` to explorer/docs/architect when mapping a large codebase.
`.trim(),
  },
  {
    id: "ops",
    name: "Ops / Desktop",
    description:
      "Runtime ops — PTY, processes, desktop automation, deploy/debug loops.",
    runtimeName: "ops-agent",
    overlay: `
## Agent posture: Ops

You are the Ops agent (one of three top-level agents).
Priorities:
- Prefer process_manage, execute, desktop_automate, git_status, run_tests for live systems.
- Diagnose with logs and exit codes; fix the smallest reliable change.
- Be careful with destructive shell/desktop actions — wait for approval when required.
- Keep status updates short: symptom → evidence → action → result.
- Delegate to debugger/tester/security subagents via \`task\` when parallel diagnosis helps.
`.trim(),
  },
] as const;

export function isAgentKind(value: unknown): value is AgentKind {
  return value === "general" || value === "research" || value === "ops";
}

export function resolveAgentPreset(kind?: string | null): AgentPreset {
  if (isAgentKind(kind)) {
    return AGENT_PRESETS.find((p) => p.id === kind) ?? AGENT_PRESETS[0]!;
  }
  return AGENT_PRESETS[0]!;
}

export function buildAgentSystemPrompt(
  basePrompt: string,
  kind?: string | null,
): string {
  const preset = resolveAgentPreset(kind);
  if (!preset.overlay) return basePrompt;
  return `${basePrompt}\n\n${preset.overlay}`;
}

/** Base coding prompt used by the general agent (exported for tests). */
export function generalBasePrompt(): string {
  return SYSTEM_PROMPT;
}

export const AGENT_KIND_COUNT = AGENT_PRESETS.length;
