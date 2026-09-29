import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tryAutoResolveRunModeInterrupt } from "./run-mode-approval.js";

describe("tryAutoResolveRunModeInterrupt privacy", () => {
  const folderPayload = {
    actionRequests: [
      {
        name: "request_folder_access",
        args: { folderPath: "/Users/me/Desktop" },
      },
    ],
  };

  it("auto-approves folder grants when Privacy is OFF", async () => {
    const decision = await tryAutoResolveRunModeInterrupt({
      payload: folderPayload,
      runMode: "auto-review",
      allowlist: [],
      privacyOn: false,
    });
    assert.ok(decision);
    assert.equal(decision.source, "privacy-off");
    assert.equal(decision.decisions[0]?.type, "approve");
  });

  it("keeps folder HITL when Privacy is ON", async () => {
    const decision = await tryAutoResolveRunModeInterrupt({
      payload: folderPayload,
      runMode: "run-everything",
      allowlist: [],
      privacyOn: true,
    });
    assert.equal(decision, null);
  });

  it("never auto-resolves plan approval", async () => {
    const decision = await tryAutoResolveRunModeInterrupt({
      payload: {
        actionRequests: [{ name: "task_todos", args: { todos: [] } }],
      },
      runMode: "run-everything",
      allowlist: [],
      privacyOn: false,
    });
    assert.equal(decision, null);
  });
});
