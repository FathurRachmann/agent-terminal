import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractInterruptActionNames,
  isPlanApprovalInterrupt,
} from "./interrupt-utils.js";

describe("interrupt utils", () => {
  it("detects task_todos plan gate from nested interrupt payload", () => {
    const payload = {
      value: {
        actionRequests: [{ name: "task_todos", args: { todos: [] } }],
      },
    };
    assert.deepEqual(extractInterruptActionNames(payload), ["task_todos"]);
    assert.equal(isPlanApprovalInterrupt(payload), true);
    assert.equal(
      isPlanApprovalInterrupt({
        actionRequests: [{ name: "execute", args: {} }],
      }),
      false,
    );
  });
});
