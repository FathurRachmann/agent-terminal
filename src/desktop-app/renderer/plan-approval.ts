/** Build markdown shown for plan approval (chat + canvas). */
export function formatPlanApprovalMarkdown(input: {
  goal?: string;
  plan?: string;
  skillsUsed?: string[];
  todos?: Array<{ id?: string; content?: string; status?: string }>;
}): string {
  const goal = String(input.goal ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  const skills = (input.skillsUsed ?? []).map(String).filter(Boolean);
  const todos = (input.todos ?? [])
    .map((t) => ({
      id: String(t.id ?? "").trim(),
      content: String(t.content ?? "").trim(),
      status: String(t.status ?? "pending").trim(),
    }))
    .filter((t) => t.id || t.content);

  const todoLines = todos.length
    ? [
        "",
        "## Proposed todos",
        ...todos.map((t) => {
          const done =
            t.status === "completed" ||
            t.status === "done" ||
            t.status === "finished";
          const label = `${t.id ? `${t.id}: ` : ""}${t.content || "(empty)"}`;
          return `- [${done ? "x" : " "}] ${label}`;
        }),
      ]
    : [];

  return [
    "# Implementation plan",
    "",
    goal ? `**Goal:** ${goal}` : "",
    skills.length ? `**Skills:** ${skills.join(", ")}` : "",
    "",
    plan || "_(empty plan)_",
    ...todoLines,
    "",
    "---",
    "",
    "_Waiting for **Approve plan** before creating todos / coding._",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseTaskPlanArgs(input: unknown): {
  goal: string;
  plan: string;
  skillsUsed: string[];
} {
  const args =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const skills = Array.isArray(args.skillsUsed)
    ? args.skillsUsed.map(String).filter(Boolean)
    : [];
  return {
    goal: String(args.goal ?? "").trim(),
    plan: String(args.plan ?? "").trim(),
    skillsUsed: skills,
  };
}

export function parseTaskBoardJson(raw: string): {
  goal: string;
  plan: string;
  skillsUsed: string[];
  todos: Array<{ id: string; content: string; status: string }>;
} | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const todos = Array.isArray(data.todos)
      ? data.todos
          .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
          .map((t) => ({
            id: String(t.id ?? "").trim(),
            content: String(t.content ?? "").trim(),
            status: String(t.status ?? "pending").trim(),
          }))
          .filter((t) => t.id || t.content)
      : [];
    const skills = Array.isArray(data.skillsUsed)
      ? data.skillsUsed.map(String).filter(Boolean)
      : [];
    const goal = String(data.goal ?? "").trim();
    const plan = String(data.plan ?? "").trim();
    if (!goal && !plan && !todos.length) return null;
    return { goal, plan, skillsUsed: skills, todos };
  } catch {
    return null;
  }
}

/** Pull proposed todos from a task_todos HITL interrupt payload. */
export function extractTodosFromPlanInterrupt(payload: unknown): Array<{
  id: string;
  content: string;
  status: string;
}> {
  const todos: Array<{ id: string; content: string; status: string }> = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.name === "task_todos") {
      const args =
        rec.args && typeof rec.args === "object"
          ? (rec.args as Record<string, unknown>)
          : rec.arguments && typeof rec.arguments === "object"
            ? (rec.arguments as Record<string, unknown>)
            : null;
      if (args && Array.isArray(args.todos)) {
        for (const t of args.todos) {
          if (!t || typeof t !== "object") continue;
          const row = t as Record<string, unknown>;
          todos.push({
            id: String(row.id ?? "").trim(),
            content: String(row.content ?? "").trim(),
            status: String(row.status ?? "pending").trim(),
          });
        }
      }
    }
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return todos.filter((t) => t.id || t.content);
}
