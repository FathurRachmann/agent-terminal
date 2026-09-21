import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createApprovalMutex,
  createClaimGate,
  workspaceBotRunThreadId,
} from "./workspace-group-turn.js";

describe("workspace-group-turn helpers", () => {
  it("builds per-bot checkpoint thread ids", () => {
    assert.equal(
      workspaceBotRunThreadId("ws:chat:general", "cto"),
      "ws:chat:general__cto",
    );
  });

  it("claim gate allows only the first caller", () => {
    const claim = createClaimGate();
    assert.equal(claim(), true);
    assert.equal(claim(), false);
    assert.equal(claim(), false);
  });

  it("approval mutex serializes overlapping waiters", async () => {
    const withLock = createApprovalMutex();
    const order: number[] = [];
    const jobs = [1, 2, 3].map((n) =>
      withLock(async () => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n + 10);
        return n;
      }),
    );
    const results = await Promise.all(jobs);
    assert.deepEqual(results, [1, 2, 3]);
    // Fully nested: enter1, leave1, enter2, leave2, …
    assert.deepEqual(order, [1, 11, 2, 12, 3, 13]);
  });

  it("parallel bot jobs overlap instead of running serially", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const started: string[] = [];

    const runBot = async (botId: string, delayMs: number) => {
      started.push(botId);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, delayMs));
      concurrent -= 1;
      return { botId, content: `ok:${botId}` };
    };

    const botIds = ["a", "b", "c"];
    const claim = createClaimGate();
    const jobs = botIds.map((id) => {
      const writeUser = claim();
      return runBot(id, 40).then((reply) => ({
        ...reply,
        writeUser,
      }));
    });

    const settled = await Promise.allSettled(jobs);
    const replies = settled
      .filter(
        (r): r is PromiseFulfilledResult<{
          botId: string;
          content: string;
          writeUser: boolean;
        }> => r.status === "fulfilled",
      )
      .map((r) => r.value);

    assert.equal(replies.length, 3);
    assert.ok(maxConcurrent >= 2, `expected overlap, got maxConcurrent=${maxConcurrent}`);
    assert.equal(replies.filter((r) => r.writeUser).length, 1);
    assert.deepEqual(
      replies.map((r) => r.botId).sort(),
      ["a", "b", "c"],
    );
    assert.equal(started.length, 3);
  });
});
