import type { KanbanStore } from "./store.js";

/** Promote eligible todo tasks to ready. Returns promoted task ids. */
export function recomputeReady(store: KanbanStore): string[] {
  return store.recomputeReady();
}
