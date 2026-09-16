import type { KanbanStore } from "./store.js";
import type { KanbanTask, TaskRun } from "./types.js";

export function claimTask(
  store: KanbanStore,
  taskId: string,
  profile: string,
  ttlSeconds = 3600,
): { task: KanbanTask; run: TaskRun } | null {
  return store.claimTask(taskId, profile, ttlSeconds);
}

export function claimReviewTask(
  store: KanbanStore,
  taskId: string,
  reviewerProfile: string,
  ttlSeconds = 3600,
): { task: KanbanTask; run: TaskRun } | null {
  return store.claimReviewTask(taskId, reviewerProfile, ttlSeconds);
}
