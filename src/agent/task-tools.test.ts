import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTaskTools, loadTaskBoard } from "./task-tools.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-task-"));
}

async function invoke(
  tools: ReturnType<typeof createTaskTools>,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const t = tools.find((x) => x.name === name);
  assert.ok(t, `missing tool ${name}`);
  const result = await t.invoke(input);
  return typeof result === "string" ? result : String(result);
}

describe("task tools", () => {
  it("requires plan before todos", async () => {
    const root = tmpWorkspace();
    const tools = createTaskTools(root);
    const out = await invoke(tools, "task_todos", {
      todos: [{ id: "1", content: "do thing" }],
    });
    assert.match(out, /task_plan first/i);
  });

  it("plan → todos → update → verify pass", async () => {
    const root = tmpWorkspace();
    const tools = createTaskTools(root);

    await invoke(tools, "task_plan", {
      goal: "Ship feature",
      plan: "## Goal\nShip feature\n\n## Approach\n1. Implement\n",
      skillsUsed: ["plan-first", "tdd-workflow"],
    });

    const board = loadTaskBoard(root);
    assert.ok(board);
    assert.equal(board.goal, "Ship feature");
    assert.deepEqual(board.skillsUsed, ["plan-first", "tdd-workflow"]);

    await invoke(tools, "task_todos", {
      todos: [
        { id: "1", content: "Implement" },
        { id: "2", content: "Test" },
      ],
    });

    await invoke(tools, "task_todo_update", { id: "1", status: "in_progress" });
    await invoke(tools, "task_todo_update", { id: "1", status: "completed" });
    await invoke(tools, "task_todo_update", { id: "2", status: "completed" });

    const pass = await invoke(tools, "task_verify", {
      executionSummary: "Implemented and tested",
      matchedPlan: true,
    });
    assert.match(pass, /VERIFY PASS/);

    assert.ok(fs.existsSync(path.join(root, ".agent", "task", "board.json")));
    assert.ok(fs.existsSync(path.join(root, ".agent", "task", "last-verify.md")));
  });

  it("verify fails when todos open or plan unmatched", async () => {
    const root = tmpWorkspace();
    const tools = createTaskTools(root);
    await invoke(tools, "task_plan", {
      goal: "g",
      plan: "p",
      skillsUsed: [],
    });
    await invoke(tools, "task_todos", {
      todos: [{ id: "1", content: "still open" }],
    });

    const fail = await invoke(tools, "task_verify", {
      executionSummary: "partial",
      matchedPlan: false,
      unmatchedItems: ["still open"],
    });
    assert.match(fail, /VERIFY FAIL/);
    assert.match(fail, /Open todos/);
  });
});
