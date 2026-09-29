import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveWorkspace } from "./workspace.js";
import type { KanbanTask } from "./types.js";
import {
  createProject,
  saveProjectRegistry,
} from "../projects/registry.js";

function baseTask(partial: Partial<KanbanTask>): KanbanTask {
  return {
    id: "t_test",
    title: "t",
    body: "",
    status: "ready",
    assignee: "default",
    tenant: null,
    priority: 0,
    projectId: null,
    workspaceKind: "scratch",
    workspacePath: null,
    branch: null,
    result: null,
    scheduledAt: null,
    goalMode: false,
    goalMaxTurns: 20,
    idempotencyKey: null,
    maxRuntimeSeconds: null,
    maxRetries: null,
    consecutiveFailures: 0,
    blockRecurrences: 0,
    lastBlockReason: null,
    currentRunId: null,
    claimLock: null,
    claimExpiresAt: null,
    lastHeartbeatAt: null,
    modelOverride: null,
    providerOverride: null,
    skillsJson: "[]",
    metadataJson: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("kanban resolveWorkspace project scope", () => {
  it("resolves projectId to primary folder and artifact dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-ws-"));
    const profileHome = path.join(tmp, "profile");
    const artifactHome = path.join(tmp, "Agent");
    const projectDir = path.join(tmp, "simkopdes-src");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(artifactHome, { recursive: true });
    fs.mkdirSync(path.join(profileHome, ".agent"), { recursive: true });
    saveProjectRegistry(profileHome, {
      version: 1,
      activeProjectId: null,
      projects: [],
    });
    const created = createProject(profileHome, {
      name: "SIMKOPDES",
      folders: [projectDir],
      activate: false,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const ws = resolveWorkspace(
      baseTask({
        projectId: created.project.id,
        workspaceKind: "project",
      }),
      "default",
      {
        profileHome,
        artifactHome,
      },
    );
    assert.equal(ws.kind, "project");
    assert.equal(ws.cwd, path.resolve(projectDir));
    assert.equal(ws.projectId, created.project.id);
    assert.ok(ws.artifactDir);
    assert.ok(
      ws.artifactDir!.includes(path.join("tmp", "project")),
      ws.artifactDir,
    );
    assert.ok(fs.existsSync(ws.artifactDir!));
  });

  it("rejects unknown projectId", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-ws-"));
    const profileHome = path.join(tmp, "profile");
    fs.mkdirSync(path.join(profileHome, ".agent"), { recursive: true });
    saveProjectRegistry(profileHome, {
      version: 1,
      activeProjectId: null,
      projects: [],
    });
    assert.throws(
      () =>
        resolveWorkspace(
          baseTask({ projectId: "missing", workspaceKind: "project" }),
          "default",
          { profileHome },
        ),
      /Unknown project/,
    );
  });
});
