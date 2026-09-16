import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPlanApprovalMarkdown,
  parseTaskPlanArgs,
  parseTaskBoardJson,
  extractTodosFromPlanInterrupt,
} from "./plan-approval.js";

describe("plan-approval helpers", () => {
  it("formats goal, skills, and plan body", () => {
    const md = formatPlanApprovalMarkdown({
      goal: "Add hello script",
      plan: "1. mkdir\n2. write file",
      skillsUsed: ["agent-tool-extension"],
    });
    assert.match(md, /Add hello script/);
    assert.match(md, /agent-tool-extension/);
    assert.match(md, /mkdir/);
    assert.match(md, /Approve plan/);
  });

  it("parses task_plan args", () => {
    const parsed = parseTaskPlanArgs({
      goal: "G",
      plan: "P",
      skillsUsed: ["a", 1, ""],
    });
    assert.deepEqual(parsed, {
      goal: "G",
      plan: "P",
      skillsUsed: ["a", "1"],
    });
  });

  it("parses board.json and interrupt todos", () => {
    const board = parseTaskBoardJson(
      JSON.stringify({
        goal: "Ship",
        plan: "Do it",
        skillsUsed: ["x"],
        todos: [{ id: "1", content: "A", status: "pending" }],
      }),
    );
    assert.ok(board);
    assert.equal(board!.goal, "Ship");
    const md = formatPlanApprovalMarkdown({
      ...board!,
      todos: extractTodosFromPlanInterrupt({
        actionRequests: [
          {
            name: "task_todos",
            args: { todos: [{ id: "t1", content: "From interrupt" }] },
          },
        ],
      }),
    });
    assert.match(md, /From interrupt/);
    assert.match(md, /Proposed todos/);
  });
});
