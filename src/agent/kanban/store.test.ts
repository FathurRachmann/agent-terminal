import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createBoard, ensureDefaultBoard, listBoards } from "./boards.js";
import { claimTask } from "./claim.js";
import { recomputeReady } from "./ready.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-test-"));
}

describe("kanban store", () => {
  let root: string;
  const stores: KanbanStore[] = [];

  afterEach(() => {
    for (const s of stores) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
    stores.length = 0;
    closeAllBoardStores();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function open(slug = "default"): KanbanStore {
    const s = new KanbanStore(slug, root);
    stores.push(s);
    return s;
  }

  it("creates tasks, links parents, and promotes to ready", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    store.setSettings({ defaultAssignee: "coder" });

    const parent = store.createTask({
      title: "parent",
      assignee: "coder",
      status: "todo",
    });
    const child = store.createTask({
      title: "child",
      assignee: "coder",
      parents: [parent.id],
      status: "todo",
    });

    assert.equal(store.getTask(child.id)?.status, "todo");
    const promoted1 = recomputeReady(store);
    assert.ok(!promoted1.includes(child.id));

    store.completeTask(parent.id, { summary: "done" });
    // completeTask already recomputes ready
    assert.equal(store.getTask(child.id)?.status, "ready");
    const promotedAgain = recomputeReady(store);
    assert.ok(!promotedAgain.includes(child.id));
  });

  it("isolates boards", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    createBoard({ slug: "ops", name: "Ops" }, root);
    const a = open("default");
    const b = open("ops");
    a.createTask({ title: "only-default", assignee: "a" });
    b.createTask({ title: "only-ops", assignee: "b" });
    assert.equal(a.listTasks().length, 1);
    assert.equal(b.listTasks().length, 1);
    assert.equal(a.listTasks()[0]?.title, "only-default");
    assert.equal(listBoards(root).map((x) => x.slug).sort().join(","), "default,ops");
  });

  it("respects scheduled_at on claim", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    const future = new Date(Date.now() + 60_000).toISOString();
    const task = store.createTask({
      title: "later",
      assignee: "ops",
      status: "ready",
      scheduledAt: future,
    });
    assert.equal(store.listClaimableReady().length, 0);
    assert.equal(claimTask(store, task.id, "ops"), null);

    store.updateTask(task.id, {
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    const claimed = claimTask(store, task.id, "ops");
    assert.ok(claimed);
    assert.equal(claimed.task.status, "running");
  });

  it("claim is idempotent — second claim fails", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    const task = store.createTask({
      title: "once",
      assignee: "coder",
      status: "ready",
    });
    const first = claimTask(store, task.id, "coder");
    assert.ok(first);
    const second = claimTask(store, task.id, "coder");
    assert.equal(second, null);
  });

  it("idempotency_key dedups creates", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    const a = store.createTask({
      title: "nightly",
      assignee: "ops",
      idempotencyKey: "nightly-2026-09-15",
    });
    const b = store.createTask({
      title: "nightly again",
      assignee: "ops",
      idempotencyKey: "nightly-2026-09-15",
    });
    assert.equal(a.id, b.id);
    assert.equal(store.listTasks().length, 1);
  });

  it("block recurrence routes to triage", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    store.setSettings({ blockRecurrenceLimit: 2 });
    const task = store.createTask({
      title: "flaky",
      assignee: "ops",
      status: "ready",
    });
    store.blockTask(task.id, "missing input");
    assert.equal(store.getTask(task.id)?.status, "blocked");
    store.unblockTask(task.id);
    store.blockTask(task.id, "missing input");
    assert.equal(store.getTask(task.id)?.status, "blocked");
    store.unblockTask(task.id);
    store.blockTask(task.id, "missing input");
    assert.equal(store.getTask(task.id)?.status, "triage");
  });

  it("filters by tenant", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    const store = open();
    store.createTask({ title: "a", assignee: "x", tenant: "biz-a" });
    store.createTask({ title: "b", assignee: "x", tenant: "biz-b" });
    assert.equal(store.listTasks({ tenant: "biz-a" }).length, 1);
    assert.equal(store.listTasks({ tenant: "biz-a" })[0]?.title, "a");
  });
});
