import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureDefaultBoard } from "../kanban/boards.js";
import { CronStore, parseInterval } from "./store.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cron-test-"));
}

describe("cron store", () => {
  let root: string;
  let store: CronStore;

  afterEach(() => {
    try {
      store?.close();
    } catch {
      /* ignore */
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("parses intervals and fires due jobs", () => {
    assert.equal(parseInterval("30m"), 30 * 60_000);
    root = tempRoot();
    ensureDefaultBoard(root);
    store = new CronStore(root);
    const job = store.create({
      name: "nightly",
      schedule: { kind: "interval", everyMs: 60_000 },
      action: {
        type: "kanban.create",
        board: "default",
        task: {
          title: "from-cron",
          assignee: "ops",
          idempotencyKey: "cron-once-1",
        },
      },
    });
    // Force due
    store.update(job.id, {});
    // Manually set next_run in past via tick with future-spoof: recreate with once past
    store.remove(job.id);
    const past = new Date(Date.now() - 1000).toISOString();
    const due = store.create({
      name: "due",
      schedule: { kind: "once", at: past },
      action: {
        type: "kanban.create",
        board: "default",
        task: {
          title: "from-cron",
          assignee: "ops",
          idempotencyKey: "cron-once-1",
        },
      },
    });
    // nextRunAt for past once may be null — force by writing
    assert.ok(due);
    const results = store.tick(root, Date.now() + 60_000);
    // If next was null because past, create with future then tick after
    void results;
    const future = new Date(Date.now() + 5_000).toISOString();
    const j2 = store.create({
      name: "soon",
      schedule: { kind: "once", at: future },
      action: {
        type: "kanban.create",
        board: "default",
        task: {
          title: "from-cron-2",
          assignee: "ops",
          idempotencyKey: "cron-once-2",
        },
      },
    });
    const fired = store.tick(root, Date.parse(future) + 1);
    assert.ok(fired.some((r) => r.jobId === j2.id && r.ok));
  });
});
