import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boardFingerprint,
  buildFixedWorkerTasks,
  mergeOrchestrationResult,
  shouldRunFixedOrchestration,
} from "./fixed-orchestration.js";
import type { TaskBoard } from "./task-tools.js";

const sampleBoard = (): TaskBoard => ({
  goal: "Add dark mode",
  plan: "1. Theme tokens\n2. Toggle\n3. Tests",
  todos: [
    { id: "t1", content: "Add tokens", status: "pending" },
    { id: "t2", content: "Wire toggle", status: "pending" },
  ],
  skillsUsed: ["owasp"],
  updatedAt: new Date().toISOString(),
});

describe("fixed-orchestration", () => {
  it("requires plan + todos", () => {
    assert.equal(shouldRunFixedOrchestration(null), false);
    assert.equal(
      shouldRunFixedOrchestration({ ...sampleBoard(), plan: "" }),
      false,
    );
    assert.equal(
      shouldRunFixedOrchestration({ ...sampleBoard(), todos: [] }),
      false,
    );
    assert.equal(shouldRunFixedOrchestration(sampleBoard()), true);
  });

  it("builds explorer/coder/reviewer plus matched skill agents", () => {
    const tasks = buildFixedWorkerTasks(sampleBoard(), [
      {
        skillFolder: "security/owasp",
        name: "owasp-agent",
        description: "sec",
        systemPrompt: "Audit auth.",
      },
    ]);
    assert.equal(tasks.length, 4);
    assert.deepEqual(
      tasks.slice(0, 3).map((t) => t.role),
      ["explorer", "coder", "reviewer"],
    );
    assert.match(tasks[3]!.goal, /owasp-agent/);
  });

  it("fingerprint stable for same board", () => {
    const a = sampleBoard();
    const b = sampleBoard();
    assert.equal(boardFingerprint(a), boardFingerprint(b));
    b.plan = "changed";
    assert.notEqual(boardFingerprint(a), boardFingerprint(b));
  });

  it("merges worker output into tool result", () => {
    const merged = mergeOrchestrationResult("Todos saved.", "### Worker 1\nok");
    assert.match(merged, /Todos saved/);
    assert.match(merged, /Parallel worker synthesis/);
    assert.match(merged, /Worker 1/);
  });
});
