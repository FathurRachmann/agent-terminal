import { createHash } from "node:crypto";
import type { DelegateTaskItem } from "./orchestration.js";
import type { TaskBoard } from "./task-tools.js";
import type { SkillAgentSpec } from "./skill-registry.js";

const DEFAULT_ROLES = ["explorer", "coder", "reviewer"] as const;

/**
 * Stable fingerprint so middleware does not re-run workers on every
 * task_todos tweak of the same plan+todo set.
 */
export function boardFingerprint(board: TaskBoard): string {
  const payload = JSON.stringify({
    goal: board.goal.trim(),
    plan: board.plan.trim(),
    todos: board.todos.map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status,
    })),
    skillsUsed: [...board.skillsUsed].map((s) => s.trim()).filter(Boolean).sort(),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function boardContext(board: TaskBoard): string {
  const todos = board.todos
    .map((t) => `- [${t.status}] ${t.id}: ${t.content}`)
    .join("\n");
  return [
    `Goal: ${board.goal}`,
    "",
    "## Plan",
    board.plan,
    "",
    "## Todos",
    todos || "(none)",
    "",
    `Skills used: ${board.skillsUsed.join(", ") || "(none)"}`,
  ].join("\n");
}

/**
 * Fixed worker set: explorer + coder + reviewer, plus any skill-registered
 * agents matched by board.skillsUsed (capped to keep cost bounded).
 */
export function buildFixedWorkerTasks(
  board: TaskBoard,
  skillAgents: SkillAgentSpec[] = [],
  options?: { maxWorkers?: number },
): DelegateTaskItem[] {
  const maxWorkers = Math.max(3, Math.min(options?.maxWorkers ?? 6, 8));
  const context = boardContext(board);
  const tasks: DelegateTaskItem[] = DEFAULT_ROLES.map((role) => ({
    role,
    goal:
      role === "explorer"
        ? "Map relevant paths/symbols and risks from the plan. Read-only analysis; list files to touch."
        : role === "coder"
          ? "Propose a minimal implementation outline (files + steps) that fulfills the plan and todos."
          : "Review the plan for bugs, missing tests, and security risks. Ordered findings only.",
    context,
  }));

  for (const agent of skillAgents) {
    if (tasks.length >= maxWorkers) break;
    if (tasks.some((t) => t.role === agent.name || t.systemPrompt === agent.systemPrompt)) {
      continue;
    }
    tasks.push({
      role: undefined,
      systemPrompt: agent.systemPrompt,
      goal: `Apply specialist skill "${agent.name}" (${agent.skillFolder}) to this plan. Return concise actionable findings.`,
      context,
    });
  }

  return tasks.slice(0, maxWorkers);
}

export function mergeOrchestrationResult(
  baseToolOutput: string,
  workerOutput: string,
): string {
  const base = baseToolOutput.trimEnd();
  const workers = workerOutput.trim();
  if (!workers) return base;
  return [
    base,
    "",
    "---",
    "",
    "## Parallel worker synthesis (runtime — fixed orchestration)",
    "",
    "The runtime ran explorer / coder / reviewer (and matched skill agents) in parallel after plan approval. Use this synthesis to execute todos; do not re-call delegate_task for the same plan unless the plan changed.",
    "",
    workers,
  ].join("\n");
}

export function shouldRunFixedOrchestration(board: TaskBoard | null): boolean {
  if (!board) return false;
  if (!board.plan.trim()) return false;
  if (!board.todos.length) return false;
  return true;
}
