import type { KanbanStore } from "./store.js";
import type { KanbanTask } from "./types.js";

export type DecomposeChild = {
  title: string;
  body?: string;
  assignee: string;
  parents?: string[]; // indices into children array, or root
};

export type DecomposeResult = {
  ok: boolean;
  taskId: string;
  reason: string;
  fanout: number;
  childIds: string[];
  newTitle?: string;
};

export type Decomposer = (input: {
  task: KanbanTask;
  profiles: Array<{ id: string; description?: string }>;
  defaultAssignee: string;
}) => Promise<{
  title?: string;
  children: DecomposeChild[];
} | null>;

/**
 * Fan triage task into child graph. Falls back to specify-style promotion
 * when decomposer returns null/empty.
 */
export async function decomposeTriageTask(
  store: KanbanStore,
  taskId: string,
  options: {
    decomposer: Decomposer;
    profiles: Array<{ id: string; description?: string }>;
    autoPromoteChildren?: boolean;
  },
): Promise<DecomposeResult> {
  const task = store.getTask(taskId);
  if (!task) {
    return { ok: false, taskId, reason: "not found", fanout: 0, childIds: [] };
  }
  if (task.status !== "triage") {
    return {
      ok: false,
      taskId,
      reason: "not in triage",
      fanout: 0,
      childIds: [],
    };
  }

  const settings = store.getSettings();
  const defaultAssignee =
    settings.defaultAssignee ||
    options.profiles[0]?.id ||
    "default";

  let plan: { title?: string; children: DecomposeChild[] } | null = null;
  try {
    plan = await options.decomposer({
      task,
      profiles: options.profiles,
      defaultAssignee,
    });
  } catch (err) {
    return {
      ok: false,
      taskId,
      reason: err instanceof Error ? err.message : String(err),
      fanout: 0,
      childIds: [],
    };
  }

  if (!plan || plan.children.length === 0) {
    return specifyTriageTask(store, taskId, plan?.title);
  }

  if (plan.title) {
    store.updateTask(taskId, { title: plan.title });
  }

  // Move root to todo (parent stays alive until children done)
  store.updateTask(taskId, {
    status: "todo",
    assignee: settings.orchestratorProfile || task.assignee || defaultAssignee,
  });

  const childIds: string[] = [];
  const created: KanbanTask[] = [];
  for (const child of plan.children) {
    const assignee =
      options.profiles.some((p) => p.id === child.assignee)
        ? child.assignee
        : defaultAssignee;
    const parentIds = [taskId];
    if (child.parents?.length) {
      for (const idx of child.parents) {
        const sibling = created[Number(idx)];
        if (sibling) parentIds.push(sibling.id);
      }
    }
    const t = store.createTask({
      title: child.title,
      body: child.body ?? "",
      assignee,
      tenant: task.tenant,
      parents: parentIds,
      status: "todo",
    });
    created.push(t);
    childIds.push(t.id);
  }

  const autoPromote = options.autoPromoteChildren ?? settings.autoPromoteChildren;
  if (autoPromote) {
    store.recomputeReady();
  }

  store.emitEvent(taskId, "decomposed", {
    fanout: childIds.length,
    child_ids: childIds,
  });

  return {
    ok: true,
    taskId,
    reason: "decomposed",
    fanout: childIds.length,
    childIds,
    newTitle: plan.title,
  };
}

/** Flesh out triage → todo without fan-out. */
export function specifyTriageTask(
  store: KanbanStore,
  taskId: string,
  newTitle?: string,
): DecomposeResult {
  const task = store.getTask(taskId);
  if (!task) {
    return { ok: false, taskId, reason: "not found", fanout: 0, childIds: [] };
  }
  if (task.status !== "triage") {
    return {
      ok: false,
      taskId,
      reason: "not in triage",
      fanout: 0,
      childIds: [],
    };
  }
  const settings = store.getSettings();
  store.updateTask(taskId, {
    title: newTitle ?? task.title,
    status: "todo",
    assignee: task.assignee || settings.defaultAssignee || null,
    body:
      task.body.trim() ||
      `Specified from triage: ${newTitle ?? task.title}`,
  });
  store.emitEvent(taskId, "specified", {});
  store.recomputeReady();
  return {
    ok: true,
    taskId,
    reason: "specified",
    fanout: 0,
    childIds: [],
    newTitle: newTitle ?? task.title,
  };
}

/**
 * Fallback when no LLM decomposer is wired: do not fan-out a duplicate child.
 * Returning null makes decomposeTriageTask promote via specify (same card).
 */
export function fallbackDecomposer(): Decomposer {
  return async () => null;
}
