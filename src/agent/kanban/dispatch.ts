import type { KanbanStore } from "./store.js";
import { listBoards } from "./boards.js";
import { openBoardStore } from "./store.js";
import { decomposeTriageTask, type Decomposer } from "./decompose.js";
import { claimReviewTask, claimTask } from "./claim.js";
import { reviewLens, reviewRound } from "./review.js";
import type { KanbanTask, TaskRun } from "./types.js";

export type SpawnRequest = {
  boardSlug: string;
  task: KanbanTask;
  run: TaskRun;
  mode: "implement" | "review";
  reviewRound?: number;
  reviewLens?: ReturnType<typeof reviewLens>;
};

export type DispatchSpawnFn = (req: SpawnRequest) => Promise<void>;

export type DispatchOptions = {
  root?: string;
  maxPerTick?: number;
  profiles?: Array<{ id: string; description?: string }>;
  decomposer?: Decomposer;
  spawn: DispatchSpawnFn;
  openStore?: (slug: string) => KanbanStore;
};

export type DispatchTickResult = {
  reclaimed: number;
  decomposed: number;
  promoted: number;
  spawned: number;
  boards: string[];
};

function resolveAssignee(
  task: KanbanTask,
  store: KanbanStore,
  fallbackProfile: string,
): string {
  return (
    task.assignee ||
    store.getSettings().defaultAssignee ||
    fallbackProfile ||
    "default"
  );
}

export async function dispatchBoardOnce(
  store: KanbanStore,
  options: {
    max?: number;
    profiles?: Array<{ id: string; description?: string }>;
    decomposer?: Decomposer;
    spawn: DispatchSpawnFn;
    fallbackProfile?: string;
  },
): Promise<{ reclaimed: number; decomposed: number; promoted: number; spawned: number }> {
  const settings = store.getSettings();
  const reclaimed = store.reclaimStaleClaims().length;

  let decomposed = 0;
  if (settings.autoDecompose && options.decomposer) {
    const triage = store.listTasks({ status: "triage" });
    const cap = settings.autoDecomposePerTick;
    for (const t of triage.slice(0, cap)) {
      const result = await decomposeTriageTask(store, t.id, {
        decomposer: options.decomposer,
        profiles: options.profiles ?? [],
        autoPromoteChildren: settings.autoPromoteChildren,
      });
      if (result.ok) decomposed += 1;
    }
  }

  const promoted = store.recomputeReady().length;

  let spawned = 0;
  const max = options.max ?? 8;
  const fallback = options.fallbackProfile ?? "default";

  // Prefer review claims, then ready
  const reviewQueue = store.listClaimableReview();
  for (const task of reviewQueue) {
    if (spawned >= max) break;
    if (
      settings.maxInProgress != null &&
      store.countRunning() >= settings.maxInProgress
    ) {
      break;
    }
    const profile = resolveAssignee(task, store, fallback);
    if (
      settings.maxInProgressPerProfile != null &&
      store.countRunning(profile) >= settings.maxInProgressPerProfile
    ) {
      continue;
    }
    const claimed = claimReviewTask(store, task.id, profile);
    if (!claimed) continue;
    const round = reviewRound(store, task.id);
    try {
      await options.spawn({
        boardSlug: store.boardSlug,
        task: claimed.task,
        run: claimed.run,
        mode: "review",
        reviewRound: round,
        reviewLens: reviewLens(round),
      });
      store.emitEvent(task.id, "spawned", { profile }, claimed.run.id);
      spawned += 1;
    } catch (err) {
      store.recordSpawnFailed(
        task.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const readyQueue = store.listClaimableReady();
  for (const task of readyQueue) {
    if (spawned >= max) break;
    if (
      settings.maxInProgress != null &&
      store.countRunning() >= settings.maxInProgress
    ) {
      break;
    }
    const profile = resolveAssignee(task, store, fallback);
    if (
      settings.maxInProgressPerProfile != null &&
      store.countRunning(profile) >= settings.maxInProgressPerProfile
    ) {
      continue;
    }
    const claimed = claimTask(store, task.id, profile);
    if (!claimed) continue;
    try {
      await options.spawn({
        boardSlug: store.boardSlug,
        task: claimed.task,
        run: claimed.run,
        mode: "implement",
      });
      store.emitEvent(task.id, "spawned", { profile }, claimed.run.id);
      spawned += 1;
    } catch (err) {
      store.recordSpawnFailed(
        task.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { reclaimed, decomposed, promoted, spawned };
}

export async function dispatchOnce(
  options: DispatchOptions,
): Promise<DispatchTickResult> {
  const boards = listBoards(options.root).map((b) => b.slug);
  const open =
    options.openStore ??
    ((slug: string) => openBoardStore(slug, options.root));

  let reclaimed = 0;
  let decomposed = 0;
  let promoted = 0;
  let spawned = 0;
  const maxPerTick = options.maxPerTick ?? 8;

  for (const slug of boards) {
    const store = open(slug);
    const result = await dispatchBoardOnce(store, {
      max: Math.max(0, maxPerTick - spawned),
      profiles: options.profiles,
      decomposer: options.decomposer,
      spawn: options.spawn,
    });
    reclaimed += result.reclaimed;
    decomposed += result.decomposed;
    promoted += result.promoted;
    spawned += result.spawned;
  }

  return { reclaimed, decomposed, promoted, spawned, boards };
}
