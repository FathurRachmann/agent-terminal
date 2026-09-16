import type { KanbanStore } from "./store.js";
import type { KanbanTask } from "./types.js";

export type GoalJudge = (input: {
  title: string;
  body: string;
  lastOutput: string;
  turn: number;
}) => Promise<{ done: boolean; feedback: string }>;

export type GoalTurnRunner = (input: {
  prompt: string;
  turn: number;
}) => Promise<string>;

export type GoalLoopResult =
  | { outcome: "completed"; turns: number; task: KanbanTask }
  | { outcome: "blocked"; turns: number; task: KanbanTask; reason: string }
  | { outcome: "worker_terminated"; turns: number; task: KanbanTask };

/**
 * Ralph-style goal loop: keep running turns until judge agrees, worker
 * terminates the task, or goal_max_turns is exhausted (sticky block).
 */
export async function runKanbanGoalLoop(options: {
  store: KanbanStore;
  taskId: string;
  runTurn: GoalTurnRunner;
  judge: GoalJudge;
  isTerminated: () => boolean;
  initialPrompt: string;
}): Promise<GoalLoopResult> {
  const { store, taskId, runTurn, judge, isTerminated, initialPrompt } =
    options;
  const task = store.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const maxTurns = Math.max(1, task.goalMaxTurns || 20);
  let prompt = initialPrompt;
  let lastOutput = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    lastOutput = await runTurn({ prompt, turn });
    if (isTerminated()) {
      return {
        outcome: "worker_terminated",
        turns: turn,
        task: store.getTask(taskId)!,
      };
    }

    const verdict = await judge({
      title: task.title,
      body: task.body,
      lastOutput,
      turn,
    });

    if (verdict.done) {
      const completed = store.completeTask(taskId, {
        summary: `Goal satisfied after ${turn} turn(s). ${verdict.feedback}`,
        result: lastOutput.slice(0, 2000),
      });
      return { outcome: "completed", turns: turn, task: completed };
    }

    if (turn >= maxTurns) {
      const blocked = store.blockTask(
        taskId,
        `goal_mode budget exhausted after ${maxTurns} turns: ${verdict.feedback}`,
      );
      return {
        outcome: "blocked",
        turns: turn,
        task: blocked,
        reason: verdict.feedback,
      };
    }

    prompt = `Goal not yet met. Judge feedback:\n${verdict.feedback}\n\nContinue working the same kanban task until acceptance criteria are satisfied, then call kanban_complete or kanban_block.`;
  }

  const blocked = store.blockTask(taskId, "goal_mode budget exhausted");
  return {
    outcome: "blocked",
    turns: maxTurns,
    task: blocked,
    reason: "budget exhausted",
  };
}

/** Cheap heuristic judge for tests / fallback when no LLM is wired. */
export function heuristicGoalJudge(): GoalJudge {
  return async ({ lastOutput, body, title }) => {
    const hay = `${lastOutput}`.toLowerCase();
    const needles = `${title}\n${body}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 4)
      .slice(0, 8);
    const hits = needles.filter((n) => hay.includes(n)).length;
    const done =
      hay.includes("done") ||
      hay.includes("complete") ||
      (needles.length > 0 && hits >= Math.ceil(needles.length * 0.5));
    return {
      done,
      feedback: done
        ? "Output appears to satisfy the goal."
        : `Still missing coverage of: ${needles.filter((n) => !hay.includes(n)).join(", ") || "acceptance criteria"}`,
    };
  };
}
