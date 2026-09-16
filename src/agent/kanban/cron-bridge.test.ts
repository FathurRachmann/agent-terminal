import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "./boards.js";
import { applyCronKanbanAction } from "./cron-bridge.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-cron-"));
}

describe("kanban cron bridge", () => {
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

  it("creates with idempotency_key", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const a = applyCronKanbanAction(store, {
      type: "kanban.create",
      board: "default",
      task: {
        title: "nightly",
        assignee: "ops",
        idempotencyKey: "cron-nightly-1",
      },
    });
    const b = applyCronKanbanAction(store, {
      type: "kanban.create",
      board: "default",
      task: {
        title: "nightly",
        assignee: "ops",
        idempotencyKey: "cron-nightly-1",
      },
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) assert.equal(a.task?.id, b.task?.id);
    assert.equal(store.listTasks().length, 1);
  });

  it("block loop breaks cron unblock thrash into triage", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    store.setSettings({ blockRecurrenceLimit: 2 });
    const task = store.createTask({
      title: "loop",
      assignee: "ops",
      status: "ready",
    });
    for (let i = 0; i < 3; i++) {
      store.blockTask(task.id, "same");
      if (store.getTask(task.id)?.status === "triage") break;
      applyCronKanbanAction(store, {
        type: "kanban.unblock",
        board: "default",
        taskId: task.id,
      });
    }
    assert.equal(store.getTask(task.id)?.status, "triage");
  });
});
