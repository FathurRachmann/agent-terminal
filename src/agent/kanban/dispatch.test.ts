import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "./boards.js";
import { claimTask } from "./claim.js";
import { dispatchBoardOnce } from "./dispatch.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-dispatch-"));
}

describe("kanban dispatch", () => {
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

  it("claim sets running; second claim fails", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const task = store.createTask({
      title: "work",
      assignee: "coder",
      status: "ready",
    });
    const a = claimTask(store, task.id, "coder");
    assert.ok(a);
    assert.equal(a.task.status, "running");
    assert.equal(claimTask(store, task.id, "coder"), null);
  });

  it("dispatchOnce spawns claimed ready tasks", async () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    store.setSettings({ maxInProgress: 2, autoDecompose: false });
    store.createTask({ title: "t1", assignee: "coder", status: "ready" });
    store.createTask({ title: "t2", assignee: "coder", status: "ready" });

    const spawned: string[] = [];
    const result = await dispatchBoardOnce(store, {
      spawn: async (req) => {
        spawned.push(req.task.id);
      },
      fallbackProfile: "coder",
    });
    assert.equal(result.spawned, 2);
    assert.equal(spawned.length, 2);
    assert.equal(store.listTasks({ status: "running" }).length, 2);
  });

  it("failure_limit auto-blocks after spawn failures", async () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    store.setSettings({ failureLimit: 2, autoDecompose: false });
    const task = store.createTask({
      title: "bad",
      assignee: "missing",
      status: "ready",
    });

    await dispatchBoardOnce(store, {
      spawn: async () => {
        throw new Error("profile missing");
      },
    });
    assert.equal(store.getTask(task.id)?.status, "ready");
    assert.equal(store.getTask(task.id)?.consecutiveFailures, 1);

    // Task back to ready — claim again
    store.updateTask(task.id, { status: "ready" });
    // After recordSpawnFailed the status may already be ready; force claimable
    const t = store.getTask(task.id)!;
    if (t.status !== "ready") {
      store.setStatusRaw(task.id, "ready");
    }

    await dispatchBoardOnce(store, {
      spawn: async () => {
        throw new Error("profile missing");
      },
    });
    assert.equal(store.getTask(task.id)?.status, "blocked");
  });
});
