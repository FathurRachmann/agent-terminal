import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "./boards.js";
import { closeAllBoardStores, KanbanStore } from "./store.js";
import { createSwarm } from "./swarm.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-swarm-"));
}

describe("kanban swarm", () => {
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

  it("builds root + workers + verifier + synthesizer graph", () => {
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new KanbanStore("default", root);
    const result = createSwarm(store, {
      title: "failover plan",
      workers: ["researcher", "architect"],
      verifier: "reviewer",
      synthesizer: "writer",
    });

    assert.equal(store.getTask(result.rootId)?.status, "done");
    assert.equal(result.workerIds.length, 2);
    const verifierParents = store.getParents(result.verifierId);
    assert.deepEqual(verifierParents.sort(), [...result.workerIds].sort());
    assert.deepEqual(store.getParents(result.synthesizerId), [
      result.verifierId,
    ]);
    // Workers should be ready (parent root is done)
    for (const id of result.workerIds) {
      assert.equal(store.getTask(id)?.status, "ready");
    }
    // Verifier waits on workers
    assert.equal(store.getTask(result.verifierId)?.status, "todo");
  });
});
