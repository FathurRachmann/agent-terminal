import type { KanbanStore } from "./store.js";
import type { KanbanTask } from "./types.js";

export type RequestReviewInput = {
  taskId: string;
  implementer: string;
  reviewer?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
  allowSelfReview?: boolean;
};

/**
 * Move implementer work into the review lane.
 * Refuses self-review unless allowSelfReview is set.
 */
export function requestReview(
  store: KanbanStore,
  input: RequestReviewInput,
): KanbanTask {
  const task = store.getTask(input.taskId);
  if (!task) throw new Error(`Task ${input.taskId} not found`);
  if (!["running", "ready", "blocked"].includes(task.status)) {
    throw new Error(
      `Cannot request review from status ${task.status} (need running|ready|blocked)`,
    );
  }

  const settings = store.getSettings();
  const allowSelf = input.allowSelfReview ?? settings.allowSelfReview;

  let reviewer = input.reviewer?.trim() || null;
  if (!reviewer) {
    // Recover from prior changes_requested provenance on re-review
    const prior = store.getLastEventOfKind(input.taskId, "changes_requested");
    if (prior) {
      try {
        const payload = JSON.parse(prior.payloadJson) as {
          reviewer?: string;
        };
        if (payload.reviewer) reviewer = payload.reviewer;
      } catch {
        /* ignore */
      }
    }
  }

  if (!reviewer) {
    throw new Error(
      "reviewer is required on first request_review (pass reviewer= explicitly)",
    );
  }

  if (!allowSelf && reviewer === input.implementer) {
    throw new Error(
      `review would be assigned to the implementer (${input.implementer}); pass reviewer= explicitly or set allowSelfReview`,
    );
  }

  const rid = store.finalizeRun(input.taskId, "submitted_for_review", {
    summary: input.summary ?? null,
    metadata: input.metadata ?? null,
  });
  store.emitEvent(
    input.taskId,
    "review_requested",
    {
      implementer: input.implementer,
      reviewer,
      summary: input.summary ?? null,
      metadata: input.metadata ?? null,
    },
    rid,
  );

  store.setStatusRaw(input.taskId, "review");
  store.updateTask(input.taskId, {
    assignee: reviewer,
    result: input.summary ?? task.result,
  });

  return store.getTask(input.taskId)!;
}

export type RequestChangesInput = {
  taskId: string;
  reviewer: string;
  reason: string;
};

/**
 * Return task to implementer after review findings.
 * Does not use blocker recurrence accounting.
 */
export function requestChanges(
  store: KanbanStore,
  input: RequestChangesInput,
): KanbanTask {
  const task = store.getTask(input.taskId);
  if (!task) throw new Error(`Task ${input.taskId} not found`);

  let implementer: string | null = null;
  const reviewEvt = store.getLastEventOfKind(input.taskId, "review_requested");
  if (reviewEvt) {
    try {
      const payload = JSON.parse(reviewEvt.payloadJson) as {
        implementer?: string;
      };
      implementer = payload.implementer ?? null;
    } catch {
      /* ignore */
    }
  }
  if (!implementer) {
    throw new Error(
      "No implementer provenance on this task; cannot request changes",
    );
  }

  const rid = store.finalizeRun(input.taskId, "changes_requested", {
    summary: input.reason,
  });
  store.emitEvent(
    input.taskId,
    "changes_requested",
    {
      reviewer: input.reviewer,
      implementer,
      reason: input.reason,
    },
    rid,
  );

  store.setStatusRaw(input.taskId, "ready");
  store.updateTask(input.taskId, { assignee: implementer });

  return store.getTask(input.taskId)!;
}

export function reviewRound(store: KanbanStore, taskId: string): number {
  return store.countChangesRequested(taskId) + 1;
}

export function reviewLens(round: number): "artifact" | "execution" | "contract" {
  if (round <= 1) return "artifact";
  if (round === 2) return "execution";
  return "contract";
}
