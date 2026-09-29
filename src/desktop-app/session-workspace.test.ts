import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDeliverySearchRoots,
  sessionWorkspaceFields,
} from "./session-workspace.js";

describe("buildDeliverySearchRoots", () => {
  const agent = path.resolve("/Users/me/Desktop/Agent");
  const todo = path.resolve("/Users/me/Desktop/todoapp");

  it("general session is Agent-only (no leftover project folder)", () => {
    const roots = buildDeliverySearchRoots({
      projectFolders: null,
      toolWorkspaceRoot: agent,
      artifactHome: agent,
    });
    assert.deepEqual(roots, [agent]);
  });

  it("project session includes project + Agent", () => {
    const roots = buildDeliverySearchRoots({
      projectFolders: [todo],
      toolWorkspaceRoot: todo,
      artifactHome: agent,
    });
    assert.deepEqual(roots, [todo, agent]);
  });
});

describe("sessionWorkspaceFields", () => {
  it("exposes cleared project for general session sync", () => {
    const fields = sessionWorkspaceFields({
      workspaceRoot: "/Agent",
      projectFolders: null,
      activeProjectId: null,
      projectId: null,
    });
    assert.equal(fields.activeProjectId, null);
    assert.equal(fields.projectId, null);
    assert.equal(fields.projectFolders, null);
    assert.equal(fields.workspaceRoot, "/Agent");
  });
});
