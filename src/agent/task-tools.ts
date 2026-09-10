import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TaskTodo = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TaskBoard = {
  goal: string;
  plan: string;
  todos: TaskTodo[];
  skillsUsed: string[];
  updatedAt: string;
};

function taskDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "task");
}

function boardPath(workspaceRoot: string): string {
  return path.join(taskDir(workspaceRoot), "board.json");
}

export function loadTaskBoard(workspaceRoot: string): TaskBoard | null {
  const file = boardPath(workspaceRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as TaskBoard;
  } catch {
    return null;
  }
}

function saveTaskBoard(workspaceRoot: string, board: TaskBoard): void {
  fs.mkdirSync(taskDir(workspaceRoot), { recursive: true });
  fs.writeFileSync(boardPath(workspaceRoot), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  // Human-readable mirror
  const md = [
    `# Task board`,
    "",
    `Updated: ${board.updatedAt}`,
    "",
    `## Goal`,
    board.goal || "(none)",
    "",
    `## Skills used`,
    ...(board.skillsUsed.length
      ? board.skillsUsed.map((s) => `- ${s}`)
      : ["- (none)"]),
    "",
    `## Plan`,
    "",
    board.plan || "(none)",
    "",
    `## Todos`,
    "",
    ...board.todos.map(
      (t) => `- [${t.status === "completed" ? "x" : " "}] ${t.id}: ${t.content} (${t.status})`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(taskDir(workspaceRoot), "board.md"), md, "utf8");
}

function emptyBoard(): TaskBoard {
  return {
    goal: "",
    plan: "",
    todos: [],
    skillsUsed: [],
    updatedAt: new Date().toISOString(),
  };
}

function formatBoard(board: TaskBoard): string {
  const open = board.todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const done = board.todos.filter((t) => t.status === "completed");
  return [
    `Goal: ${board.goal || "(none)"}`,
    `Skills used: ${board.skillsUsed.join(", ") || "(none)"}`,
    `Todos: ${done.length}/${board.todos.length} completed (${open.length} open)`,
    "",
    "## Plan",
    board.plan || "(none)",
    "",
    "## Todos",
    ...board.todos.map((t) => `- [${t.status}] ${t.id}: ${t.content}`),
  ].join("\n");
}

/**
 * Plan + todo board for plan→todo→execute→verify workflow.
 * Persists under .agent/task/
 */
export function createTaskTools(workspaceRoot: string) {
  const taskPlan = tool(
    async ({
      goal,
      plan,
      skillsUsed,
    }: {
      goal: string;
      plan: string;
      skillsUsed?: string[];
    }) => {
      const prev = loadTaskBoard(workspaceRoot) ?? emptyBoard();
      const board: TaskBoard = {
        ...prev,
        goal: goal.trim(),
        plan: plan.trim(),
        skillsUsed: skillsUsed?.map((s) => s.trim()).filter(Boolean) ?? prev.skillsUsed,
        updatedAt: new Date().toISOString(),
      };
      saveTaskBoard(workspaceRoot, board);
      return `Plan saved.\n\n${formatBoard(board)}`;
    },
    {
      name: "task_plan",
      description:
        "Save the current task plan (after ls/read of only needed skills). " +
        "Call BEFORE creating todos or editing application code.",
      schema: z.object({
        goal: z.string().describe("One-sentence goal"),
        plan: z
          .string()
          .describe("Markdown plan: scope, steps, files, risks, test plan"),
        skillsUsed: z
          .array(z.string())
          .optional()
          .describe("Skill folder names you actually read, e.g. [\"plan-first\",\"tdd-workflow\"]"),
      }),
    },
  );

  const taskTodos = tool(
    async ({
      todos,
      replace,
    }: {
      todos: Array<{ id: string; content: string; status?: TodoStatus }>;
      replace?: boolean;
    }) => {
      const prev = loadTaskBoard(workspaceRoot) ?? emptyBoard();
      if (!prev.plan.trim()) {
        return "Error: call task_plan first before task_todos.";
      }
      const incoming: TaskTodo[] = todos.map((t) => ({
        id: t.id.trim(),
        content: t.content.trim(),
        status: t.status ?? "pending",
      }));
      const board: TaskBoard = {
        ...prev,
        todos: replace === false
          ? mergeTodos(prev.todos, incoming)
          : incoming,
        updatedAt: new Date().toISOString(),
      };
      saveTaskBoard(workspaceRoot, board);
      return `Todos saved.\n\n${formatBoard(board)}`;
    },
    {
      name: "task_todos",
      description:
        "Create/replace the todo list derived from the plan. " +
        "Default replaces the whole list. Set replace=false to merge by id.",
      schema: z.object({
        todos: z.array(
          z.object({
            id: z.string(),
            content: z.string(),
            status: z
              .enum(["pending", "in_progress", "completed", "cancelled"])
              .optional(),
          }),
        ),
        replace: z.boolean().optional(),
      }),
    },
  );

  const taskTodoUpdate = tool(
    async ({ id, status, content }: { id: string; status: TodoStatus; content?: string }) => {
      const prev = loadTaskBoard(workspaceRoot);
      if (!prev) return "Error: no task board. Call task_plan + task_todos first.";
      const idx = prev.todos.findIndex((t) => t.id === id);
      if (idx < 0) return `Error: todo id not found: ${id}`;
      const next = [...prev.todos];
      const cur = next[idx]!;
      next[idx] = {
        ...cur,
        status,
        content: content?.trim() || cur.content,
      };
      // Only one in_progress at a time
      if (status === "in_progress") {
        for (let i = 0; i < next.length; i += 1) {
          if (i !== idx && next[i]!.status === "in_progress") {
            next[i] = { ...next[i]!, status: "pending" };
          }
        }
      }
      const board: TaskBoard = {
        ...prev,
        todos: next,
        updatedAt: new Date().toISOString(),
      };
      saveTaskBoard(workspaceRoot, board);
      return formatBoard(board);
    },
    {
      name: "task_todo_update",
      description:
        "Update a todo status while executing (pending|in_progress|completed|cancelled). " +
        "Mark in_progress before work; completed after that step finishes.",
      schema: z.object({
        id: z.string(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
        content: z.string().optional(),
      }),
    },
  );

  const taskStatus = tool(
    async () => {
      const board = loadTaskBoard(workspaceRoot);
      if (!board) return "No active task board.";
      return formatBoard(board);
    },
    {
      name: "task_status",
      description: "Show current plan, skills used, and todo progress.",
      schema: z.object({}),
    },
  );

  const taskVerify = tool(
    async ({
      executionSummary,
      matchedPlan,
      unmatchedItems,
    }: {
      executionSummary: string;
      matchedPlan: boolean;
      unmatchedItems?: string[];
    }) => {
      const board = loadTaskBoard(workspaceRoot);
      if (!board) return "Error: no task board to verify against.";

      const pending = board.todos.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      );
      const cancelled = board.todos.filter((t) => t.status === "cancelled");
      const completed = board.todos.filter((t) => t.status === "completed");

      const gaps: string[] = [];
      if (pending.length) {
        gaps.push(
          `Open todos: ${pending.map((t) => `${t.id}(${t.status})`).join(", ")}`,
        );
      }
      if (!matchedPlan) {
        gaps.push("Agent reported execution did NOT fully match the plan.");
      }
      if (unmatchedItems?.length) {
        gaps.push(`Unmatched: ${unmatchedItems.join("; ")}`);
      }

      const ok = gaps.length === 0;
      const report = [
        ok ? "VERIFY PASS" : "VERIFY FAIL — continue work",
        `Completed todos: ${completed.length}/${board.todos.length}`,
        cancelled.length ? `Cancelled: ${cancelled.map((t) => t.id).join(", ")}` : "",
        `matchedPlan: ${matchedPlan}`,
        "",
        "## Execution summary",
        executionSummary.trim(),
        gaps.length ? `\n## Gaps\n${gaps.map((g) => `- ${g}`).join("\n")}` : "",
        "",
        "## Plan (reference)",
        board.plan,
      ]
        .filter(Boolean)
        .join("\n");

      fs.mkdirSync(taskDir(workspaceRoot), { recursive: true });
      fs.writeFileSync(
        path.join(taskDir(workspaceRoot), "last-verify.md"),
        `${report}\n`,
        "utf8",
      );
      return report;
    },
    {
      name: "task_verify",
      description:
        "After execution, check results against the saved plan and todos. " +
        "Set matchedPlan=false and list unmatchedItems if anything from the plan/todos was skipped or diverged. " +
        "If VERIFY FAIL, fix remaining todos then call task_verify again before finishing.",
      schema: z.object({
        executionSummary: z
          .string()
          .describe("What was actually done (files, commands, outcomes)"),
        matchedPlan: z
          .boolean()
          .describe("True only if execution fulfilled the plan and todos"),
        unmatchedItems: z
          .array(z.string())
          .optional()
          .describe("Plan steps or todos that were not done or diverged"),
      }),
    },
  );

  return [taskPlan, taskTodos, taskTodoUpdate, taskStatus, taskVerify];
}

function mergeTodos(existing: TaskTodo[], incoming: TaskTodo[]): TaskTodo[] {
  const map = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) {
    map.set(t.id, { ...map.get(t.id), ...t });
  }
  return [...map.values()];
}
