import type { KanbanStore } from "./store.js";
import type { KanbanTask, SwarmSpec } from "./types.js";

export type SwarmResult = {
  rootId: string;
  workerIds: string[];
  verifierId: string;
  synthesizerId: string;
  tasks: KanbanTask[];
};

/**
 * Hermes Swarm v1: completed root/blackboard + N parallel workers +
 * verifier gated on all workers + synthesizer gated on verifier.
 * Shared context lives as a structured JSON comment on the root.
 */
export function createSwarm(
  store: KanbanStore,
  spec: SwarmSpec,
): SwarmResult {
  const workers = [...new Set(spec.workers.map((w) => w.trim()).filter(Boolean))];
  if (workers.length === 0) {
    throw new Error("swarm requires at least one worker profile");
  }
  if (!spec.verifier?.trim()) throw new Error("swarm requires a verifier");
  if (!spec.synthesizer?.trim()) {
    throw new Error("swarm requires a synthesizer");
  }

  const root = store.createTask({
    title: `[swarm] ${spec.title}`,
    body: spec.body ?? spec.title,
    assignee: null,
    tenant: spec.tenant ?? null,
    status: "done",
  });
  store.addComment(
    root.id,
    JSON.stringify({
      type: "swarm_blackboard",
      title: spec.title,
      body: spec.body ?? "",
      workers,
      verifier: spec.verifier,
      synthesizer: spec.synthesizer,
    }),
    "swarm",
  );

  const workerTasks = workers.map((assignee) =>
    store.createTask({
      title: `${spec.title} — worker:${assignee}`,
      body: `Contribute to swarm "${spec.title}". Read blackboard comments on parent ${root.id}.\n\n${spec.body ?? ""}`,
      assignee,
      tenant: spec.tenant ?? null,
      parents: [root.id],
      status: "todo",
    }),
  );

  const verifier = store.createTask({
    title: `${spec.title} — verify`,
    body: `Verify all worker deliverables for "${spec.title}". Use independent review lenses. Parents: ${workerTasks.map((t) => t.id).join(", ")}.`,
    assignee: spec.verifier.trim(),
    tenant: spec.tenant ?? null,
    parents: workerTasks.map((t) => t.id),
    status: "todo",
  });

  const synthesizer = store.createTask({
    title: `${spec.title} — synthesize`,
    body: `Synthesize the verified swarm result for "${spec.title}". Parent verifier: ${verifier.id}.`,
    assignee: spec.synthesizer.trim(),
    tenant: spec.tenant ?? null,
    parents: [verifier.id],
    status: "todo",
  });

  store.recomputeReady();

  return {
    rootId: root.id,
    workerIds: workerTasks.map((t) => t.id),
    verifierId: verifier.id,
    synthesizerId: synthesizer.id,
    tasks: [root, ...workerTasks, verifier, synthesizer],
  };
}
