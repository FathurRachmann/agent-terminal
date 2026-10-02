import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolMessage } from "@langchain/core/messages";
import { createMultiTaskInjectMiddleware } from "./multi-task-inject-middleware.js";
import type { TaskBoard } from "./task-tools.js";

describe("multi-task-inject-middleware", () => {
  it("injects parallel synthesis after task_todos", async () => {
    const board: TaskBoard = {
      goal: "Ship feature",
      plan: "Implement X",
      todos: [{ id: "1", content: "Do X", status: "pending" }],
      skillsUsed: [],
      updatedAt: new Date().toISOString(),
    };

    let ran = 0;
    const mw = createMultiTaskInjectMiddleware({
      workspaceRoot: "/tmp/unused",
      skillsRoot: "/tmp/unused-skills",
      loadBoard: () => board,
      loadSkillSpecs: () => [],
      runWorkers: async (tasks) => {
        ran = tasks.length;
        return `### Workers\nran=${tasks.length}`;
      },
    });

    assert.ok(mw.wrapToolCall);
    const out = await mw.wrapToolCall!(
      {
        toolCall: {
          name: "task_todos",
          args: {},
          id: "call-1",
          type: "tool_call",
        },
      } as never,
      async () =>
        new ToolMessage({
          content: "Todos saved.\n\nGoal: Ship feature",
          tool_call_id: "call-1",
          name: "task_todos",
        }),
    );

    assert.ok(ToolMessage.isInstance(out));
    assert.match(String(out.content), /Parallel worker synthesis/);
    assert.match(String(out.content), /ran=4/);
    assert.equal(ran, 4);
  });

  it("skips duplicate fingerprint", async () => {
    const board: TaskBoard = {
      goal: "Ship",
      plan: "Plan",
      todos: [{ id: "1", content: "A", status: "pending" }],
      skillsUsed: [],
      updatedAt: new Date().toISOString(),
    };
    let calls = 0;
    const mw = createMultiTaskInjectMiddleware({
      workspaceRoot: "/tmp",
      skillsRoot: "/tmp",
      loadBoard: () => board,
      loadSkillSpecs: () => [],
      runWorkers: async () => {
        calls += 1;
        return "ok";
      },
    });

    const handler = async () =>
      new ToolMessage({
        content: "Todos saved.",
        tool_call_id: "c",
        name: "task_todos",
      });

    const req = {
      toolCall: {
        name: "task_todos",
        args: {},
        id: "c",
        type: "tool_call",
      },
    } as never;

    await mw.wrapToolCall!(req, handler);
    const second = await mw.wrapToolCall!(req, handler);
    assert.equal(calls, 1);
    assert.match(String((second as ToolMessage).content), /skipped/);
  });

  it("does not inject on other tools", async () => {
    let workers = 0;
    const mw = createMultiTaskInjectMiddleware({
      workspaceRoot: "/tmp",
      skillsRoot: "/tmp",
      loadBoard: () => null,
      runWorkers: async () => {
        workers += 1;
        return "x";
      },
    });
    const out = await mw.wrapToolCall!(
      {
        toolCall: {
          name: "execute",
          args: {},
          id: "e",
          type: "tool_call",
        },
      } as never,
      async () =>
        new ToolMessage({
          content: "ok",
          tool_call_id: "e",
          name: "execute",
        }),
    );
    assert.equal(workers, 0);
    assert.equal(String((out as ToolMessage).content), "ok");
  });
});
