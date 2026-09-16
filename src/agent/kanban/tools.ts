import { tool } from "langchain";
import { z } from "zod";
import type { KanbanStore } from "./store.js";
import { requestChanges, requestReview } from "./review.js";
import { createSwarm } from "./swarm.js";

export type KanbanToolContext = {
  store: KanbanStore;
  taskId: string;
  boardSlug: string;
  profileId: string;
  mode: "implement" | "review" | "orchestrator";
  onTerminal?: () => void;
};

export function createKanbanWorkerTools(ctx: KanbanToolContext): unknown[] {
  const kanbanShow = tool(
    async () => {
      const detail = ctx.store.getDetail(ctx.taskId);
      if (!detail) return JSON.stringify({ error: "task not found" });
      return JSON.stringify(detail, null, 2);
    },
    {
      name: "kanban_show",
      description:
        "Show the current kanban task with comments, events, runs, links, and attachments.",
      schema: z.object({}),
    },
  );

  const kanbanComplete = tool(
    async ({ summary, result, metadata }) => {
      const task = ctx.store.completeTask(ctx.taskId, {
        summary,
        result,
        metadata: metadata
          ? (JSON.parse(metadata) as Record<string, unknown>)
          : undefined,
      });
      ctx.onTerminal?.();
      return JSON.stringify({ ok: true, status: task.status, id: task.id });
    },
    {
      name: "kanban_complete",
      description:
        "Mark the current kanban task done with a summary and optional metadata JSON.",
      schema: z.object({
        summary: z.string().describe("Human-readable closeout summary"),
        result: z.string().optional(),
        metadata: z
          .string()
          .optional()
          .describe("JSON object string for structured handoff"),
      }),
    },
  );

  const kanbanBlock = tool(
    async ({ reason, kind }) => {
      const task = ctx.store.blockTask(ctx.taskId, reason, kind ?? null);
      ctx.onTerminal?.();
      return JSON.stringify({ ok: true, status: task.status, id: task.id });
    },
    {
      name: "kanban_block",
      description:
        "Block the current task (or escalate). Use kind=dependency to wait on parents.",
      schema: z.object({
        reason: z.string(),
        kind: z
          .enum(["needs_input", "capability", "transient", "dependency"])
          .optional(),
      }),
    },
  );

  const kanbanHeartbeat = tool(
    async ({ note }) => {
      ctx.store.heartbeat(ctx.taskId, note);
      return JSON.stringify({ ok: true });
    },
    {
      name: "kanban_heartbeat",
      description:
        "Signal liveness during long operations (call at least once per hour).",
      schema: z.object({ note: z.string().optional() }),
    },
  );

  const kanbanComment = tool(
    async ({ task_id, body }) => {
      const id = task_id?.trim() || ctx.taskId;
      const comment = ctx.store.addComment(id, body, ctx.profileId);
      return JSON.stringify(comment);
    },
    {
      name: "kanban_comment",
      description: "Append a comment to a task (defaults to current task).",
      schema: z.object({
        body: z.string(),
        task_id: z.string().optional(),
      }),
    },
  );

  const kanbanCreate = tool(
    async ({ title, body, assignee, parents, triage, goal_mode, tenant }) => {
      const task = ctx.store.createTask({
        title,
        body,
        assignee: assignee ?? null,
        parents: parents ?? [],
        triage: Boolean(triage),
        goalMode: Boolean(goal_mode),
        tenant: tenant ?? null,
      });
      ctx.store.recomputeReady();
      return JSON.stringify(task);
    },
    {
      name: "kanban_create",
      description: "Create a new task on the current board.",
      schema: z.object({
        title: z.string(),
        body: z.string().optional(),
        assignee: z.string().optional(),
        parents: z.array(z.string()).optional(),
        triage: z.boolean().optional(),
        goal_mode: z.boolean().optional(),
        tenant: z.string().optional(),
      }),
    },
  );

  const kanbanLink = tool(
    async ({ parent_id, child_id }) => {
      ctx.store.linkTasks(parent_id, child_id);
      ctx.store.recomputeReady();
      return JSON.stringify({ ok: true, parent_id, child_id });
    },
    {
      name: "kanban_link",
      description: "Link a parent → child dependency on the current board.",
      schema: z.object({
        parent_id: z.string(),
        child_id: z.string(),
      }),
    },
  );

  const kanbanRequestReview = tool(
    async ({ reviewer, summary, metadata }) => {
      const task = requestReview(ctx.store, {
        taskId: ctx.taskId,
        implementer: ctx.profileId,
        reviewer: reviewer ?? null,
        summary,
        metadata: metadata
          ? (JSON.parse(metadata) as Record<string, unknown>)
          : undefined,
      });
      ctx.onTerminal?.();
      return JSON.stringify({ ok: true, status: task.status, assignee: task.assignee });
    },
    {
      name: "kanban_request_review",
      description:
        "Submit current work for independent review. Prefer an explicit reviewer profile.",
      schema: z.object({
        reviewer: z.string().optional(),
        summary: z.string().optional(),
        metadata: z.string().optional(),
      }),
    },
  );

  const kanbanRequestChanges = tool(
    async ({ reason }) => {
      const task = requestChanges(ctx.store, {
        taskId: ctx.taskId,
        reviewer: ctx.profileId,
        reason,
      });
      ctx.onTerminal?.();
      return JSON.stringify({ ok: true, status: task.status, assignee: task.assignee });
    },
    {
      name: "kanban_request_changes",
      description:
        "Reviewer-only: return the task to the implementer with required corrections.",
      schema: z.object({ reason: z.string() }),
    },
  );

  const base: unknown[] = [
    kanbanShow,
    kanbanComplete,
    kanbanBlock,
    kanbanHeartbeat,
    kanbanComment,
    kanbanCreate,
    kanbanLink,
  ];

  if (ctx.mode === "implement" || ctx.mode === "orchestrator") {
    base.push(kanbanRequestReview);
  }
  if (ctx.mode === "review" || ctx.mode === "orchestrator") {
    base.push(kanbanRequestChanges);
  }

  if (ctx.mode === "orchestrator") {
    const kanbanList = tool(
      async ({ status, assignee, tenant, limit }) => {
        const tasks = ctx.store.listTasks({
          status: status as never,
          assignee,
          tenant,
          limit: limit ?? 50,
        });
        return JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            assignee: t.assignee,
            tenant: t.tenant,
            priority: t.priority,
          })),
        );
      },
      {
        name: "kanban_list",
        description: "List tasks on the current board with optional filters.",
        schema: z.object({
          status: z.string().optional(),
          assignee: z.string().optional(),
          tenant: z.string().optional(),
          limit: z.number().optional(),
        }),
      },
    );
    const kanbanUnblock = tool(
      async ({ task_id }) => {
        const task = ctx.store.unblockTask(task_id);
        return JSON.stringify(task);
      },
      {
        name: "kanban_unblock",
        description: "Unblock a task (→ ready or todo based on parents).",
        schema: z.object({ task_id: z.string() }),
      },
    );
    const kanbanSwarm = tool(
      async ({ title, body, workers, verifier, synthesizer, tenant }) => {
        const result = createSwarm(ctx.store, {
          title,
          body,
          workers,
          verifier,
          synthesizer,
          tenant,
        });
        return JSON.stringify(result);
      },
      {
        name: "kanban_swarm",
        description:
          "Create a durable swarm graph: root blackboard + workers + verifier + synthesizer.",
        schema: z.object({
          title: z.string(),
          body: z.string().optional(),
          workers: z.array(z.string()).min(1),
          verifier: z.string(),
          synthesizer: z.string(),
          tenant: z.string().optional(),
        }),
      },
    );
    base.push(kanbanList, kanbanUnblock, kanbanSwarm);
  }

  return base;
}

export function buildWorkerPrompt(options: {
  taskId: string;
  boardSlug: string;
  mode: "implement" | "review";
  reviewRound?: number;
  reviewLens?: string;
}): string {
  if (options.mode === "review") {
    return [
      `You are a Kanban review worker for task ${options.taskId} on board ${options.boardSlug}.`,
      `Review round: ${options.reviewRound ?? 1}. Lead with the ${options.reviewLens ?? "artifact"} lens.`,
      "Call kanban_show first. Do not edit implementation files.",
      "Choose exactly one terminal action: kanban_complete (approve), kanban_request_changes, or kanban_block (escalate).",
      "Load and follow the sdlc-review skill procedure.",
    ].join("\n");
  }
  return [
    `Work kanban task ${options.taskId} on board ${options.boardSlug}.`,
    "Call kanban_show first, then do the work.",
    "When finished call kanban_complete(summary=...) or kanban_block(reason=...).",
    "For engineering work that needs independent verification, call kanban_request_review(reviewer=...).",
    "Call kanban_heartbeat during long operations.",
  ].join("\n");
}
