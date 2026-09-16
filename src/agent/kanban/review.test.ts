import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "./boards.js";
import { claimTask } from "./claim.js";
import {
  requestChanges,
  requestReview,
  reviewLens,
  reviewRound,
} from "./review.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-review-"));
}

describe("kanban review", () => {
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

  it("request_review moves to review and refuses self-review", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    store.setSettings({ allowSelfReview: false });
    const task = store.createTask({
      title: "impl",
      assignee: "dev",
      status: "ready",
    });
    claimTask(store, task.id, "dev");

    assert.throws(() =>
      requestReview(store, {
        taskId: task.id,
        implementer: "dev",
        reviewer: "dev",
      }),
    );

    const reviewed = requestReview(store, {
      taskId: task.id,
      implementer: "dev",
      reviewer: "reviewer",
      summary: "please review",
    });
    assert.equal(reviewed.status, "review");
    assert.equal(reviewed.assignee, "reviewer");
  });

  it("request_changes returns to implementer and increments round", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const task = store.createTask({
      title: "impl",
      assignee: "dev",
      status: "ready",
    });
    claimTask(store, task.id, "dev");
    requestReview(store, {
      taskId: task.id,
      implementer: "dev",
      reviewer: "reviewer",
    });
    claimTask(store, task.id, "reviewer");

    assert.equal(reviewRound(store, task.id), 1);
    assert.equal(reviewLens(1), "artifact");

    const back = requestChanges(store, {
      taskId: task.id,
      reviewer: "reviewer",
      reason: "fix tests",
    });
    assert.equal(back.status, "ready");
    assert.equal(back.assignee, "dev");
    assert.equal(reviewRound(store, task.id), 2);
    assert.equal(reviewLens(2), "execution");
    assert.equal(reviewLens(3), "contract");
  });
});
