import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "./boards.js";
import { claimTask } from "./claim.js";
import { runKanbanGoalLoop } from "./goal.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-goal-"));
}

describe("kanban goal mode", () => {
  let root: string;
  let store: KanbanStore;

  afterEach(() => {
    try {
      store?.close();
    } catch {
      /* ignore */
    }
    closeAllBoardStores();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("continues until judge says done", async () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const task = store.createTask({
      title: "Translate docs",
      body: "Acceptance: every page translated",
      assignee: "linguist",
      status: "ready",
      goalMode: true,
      goalMaxTurns: 5,
    });
    claimTask(store, task.id, "linguist");

    let turns = 0;
    const result = await runKanbanGoalLoop({
      store,
      taskId: task.id,
      initialPrompt: "work",
      isTerminated: () => store.getTask(task.id)?.status === "done",
      runTurn: async () => {
        turns += 1;
        return turns >= 2 ? "every page translated — done" : "still working";
      },
      judge: async ({ lastOutput }) => ({
        done: lastOutput.includes("done"),
        feedback: lastOutput.includes("done") ? "ok" : "keep going",
      }),
    });
    assert.equal(result.outcome, "completed");
    assert.equal(result.turns, 2);
    assert.equal(store.getTask(task.id)?.status, "done");
  });

  it("blocks when budget exhausted", async () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const task = store.createTask({
      title: "Hard goal",
      body: "never finishes",
      assignee: "coder",
      status: "ready",
      goalMode: true,
      goalMaxTurns: 2,
    });
    claimTask(store, task.id, "coder");

    const result = await runKanbanGoalLoop({
      store,
      taskId: task.id,
      initialPrompt: "work",
      isTerminated: () => false,
      runTurn: async () => "not done yet",
      judge: async () => ({ done: false, feedback: "nope" }),
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(store.getTask(task.id)?.status, "blocked");
  });
});
