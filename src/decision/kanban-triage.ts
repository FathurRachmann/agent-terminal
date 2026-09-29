/**
 * Kanban triage: decide specify vs fan-out, and pick a primary assignee.
 */
import type { DecomposeChild, Decomposer } from "../agent/kanban/decompose.js";
import type { KanbanTask } from "../agent/kanban/types.js";
import {
  choiceOf,
  confidenceOf,
  decisionMinConfidence,
  getDecisionEngine,
  isDecisionEngineEnabled,
  noulOf,
} from "./engine.js";

export type TriageDecision = {
  action: "specify" | "decompose";
  assignee: string | null;
  source: "laya" | "heuristic" | "bypass";
  reason: string;
};

export async function decideKanbanTriage(options: {
  task: KanbanTask;
  profiles: Array<{ id: string; description?: string }>;
  defaultAssignee: string;
}): Promise<TriageDecision> {
  if (!isDecisionEngineEnabled()) {
    return {
      action: "specify",
      assignee: options.defaultAssignee,
      source: "bypass",
      reason: "decision engine disabled",
    };
  }

  const profiles = options.profiles.slice(0, 20);
  const criteria: Record<string, string> = {};
  for (const p of profiles) {
    criteria[p.id] = (p.description || p.id).slice(0, 120);
  }
  if (!Object.keys(criteria).length) {
    criteria[options.defaultAssignee] = "default assignee";
  }

  const engine = getDecisionEngine();
  const state = {
    title: options.task.title,
    body: (options.task.body || "").slice(0, 1500),
  };
  const result = await engine.predict(state, {
    should_fanout: {
      type: "noul",
      instructions:
        "Should this triage card be split into multiple child tasks for different specialists?",
    },
    assignee: {
      type: "choice",
      instructions: "Which profile should own this work (or lead the fan-out)?",
      criteria,
    },
  });

  const fanout = noulOf(result, "should_fanout") ?? 0;
  const assignee =
    choiceOf(result, "assignee") ?? options.defaultAssignee;
  const conf = confidenceOf(result, "should_fanout");
  const min = decisionMinConfidence();

  const action: "specify" | "decompose" =
    conf >= min && fanout >= min ? "decompose" : "specify";

  return {
    action,
    assignee,
    source: result?.source === "laya" ? "laya" : "heuristic",
    reason: `fanout=${fanout.toFixed(2)} assignee=${assignee} conf=${conf.toFixed(2)}`,
  };
}

/**
 * Wrap a decomposer: Laya chooses specify vs decompose; on decompose either
 * delegates to `inner` or creates one child per top profile.
 */
export function layaAwareDecomposer(inner?: Decomposer): Decomposer {
  return async (input) => {
    const decision = await decideKanbanTriage(input);
    if (decision.action === "specify") {
      return null;
    }
    if (inner) {
      const plan = await inner(input);
      if (plan && plan.children.length > 0) return plan;
    }

    // Simple fan-out: one child for the chosen assignee only.
    // (Don't invent siblings by roster order — that mis-assigns work.)
    const lead = decision.assignee || input.defaultAssignee;
    const children: DecomposeChild[] = [
      {
        title: input.task.title,
        body: input.task.body || undefined,
        assignee: lead,
      },
    ];

    return {
      title: input.task.title,
      children,
    };
  };
}
