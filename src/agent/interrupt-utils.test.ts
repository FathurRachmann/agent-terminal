import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractFolderAccessPath,
  extractInterruptActionNames,
  formatToolApprovalDetail,
  isFolderAccessInterrupt,
  isPlanApprovalInterrupt,
  normalizeApprovalDecision,
  buildApprovalDecisions,
  countInterruptActionRequests,
  requiresExplicitApproval,
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

  it("pads approval decisions to match hanging actionRequests", () => {
    const payload = {
      actionRequests: [
        { name: "execute", args: {} },
        { name: "write_file", args: {} },
        { name: "edit_file", args: {} },
      ],
    };
    assert.equal(countInterruptActionRequests(payload), 3);
    assert.equal(buildApprovalDecisions("approve", payload).length, 3);
    const normalized = normalizeApprovalDecision(
      { decisions: [{ type: "approve" }] },
      payload,
    );
    assert.equal(normalized.decisions.length, 3);
    assert.ok(normalized.decisions.every((d) => d.type === "approve"));
  });

  it("detects request_folder_access and extracts path", () => {
    const payload = {
      actionRequests: [
        {
          name: "request_folder_access",
          args: { folderPath: "/Users/me/Desktop" },
        },
      ],
    };
    assert.equal(isFolderAccessInterrupt(payload), true);
    assert.equal(requiresExplicitApproval(payload), true);
    assert.equal(
      requiresExplicitApproval(payload, { privacyOn: true }),
      true,
    );
    assert.equal(
      requiresExplicitApproval(payload, { privacyOn: false }),
      false,
    );
    assert.equal(extractFolderAccessPath(payload), "/Users/me/Desktop");
    assert.match(
      formatToolApprovalDetail(payload),
      /Allow folder access[\s\S]*\/Users\/me\/Desktop/,
    );
  });

  it("requires explicit approval for plan and folder only", () => {
    assert.equal(
      requiresExplicitApproval({
        actionRequests: [{ name: "execute", args: {} }],
      }),
      false,
    );
    assert.equal(
      requiresExplicitApproval({
        actionRequests: [{ name: "task_todos", args: {} }],
      }),
      true,
    );
  });
});
