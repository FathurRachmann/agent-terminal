import type { KanbanStore } from "./store.js";
import type { CreateTaskInput, KanbanTask } from "./types.js";

export type CronKanbanAction =
  | {
      type: "kanban.create";
      board: string;
      task: CreateTaskInput & { idempotencyKey: string };
    }
  | {
      type: "kanban.schedule";
      board: string;
      taskId: string;
      scheduledAt: string | null;
    }
  | {
      type: "kanban.unblock";
      board: string;
      taskId: string;
    };

export type CronBridgeResult =
  | { ok: true; action: CronKanbanAction["type"]; task?: KanbanTask }
  | { ok: false; action: CronKanbanAction["type"]; error: string };

export function applyCronKanbanAction(
  store: KanbanStore,
  action: CronKanbanAction,
): CronBridgeResult {
  try {
    switch (action.type) {
      case "kanban.create": {
        const task = store.createTask({
          ...action.task,
          idempotencyKey: action.task.idempotencyKey,
        });
        store.recomputeReady();
        return { ok: true, action: action.type, task };
      }
      case "kanban.schedule": {
        const task = store.updateTask(action.taskId, {
          scheduledAt: action.scheduledAt,
        });
        return { ok: true, action: action.type, task };
      }
      case "kanban.unblock": {
        const task = store.unblockTask(action.taskId);
        return { ok: true, action: action.type, task };
      }
      default: {
        const _exhaustive: never = action;
        return {
          ok: false,
          action: "kanban.create",
          error: `unknown action ${JSON.stringify(_exhaustive)}`,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      action: action.type,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
