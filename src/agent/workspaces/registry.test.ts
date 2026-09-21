import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignProjectToWorkspace,
  createWorkspace,
  createWorkspaceWithSeed,
  deleteWorkspace,
  loadWorkspaceRegistry,
  setWorkspaceActiveProject,
  unassignProjectFromWorkspace,
  updateWorkspace,
} from "./index.js";

describe("workspace registry", () => {
  const dirs: string[] = [];

  after(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-reg-"));
    dirs.push(dir);
    return dir;
  }

  it("creates, updates, deletes workspaces", () => {
    const home = tmp();
    const created = createWorkspace(home, {
      name: "Divisi IT",
      description: "Engineering",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.workspace.name, "Divisi IT");
    assert.ok(created.workspace.id.includes("divisi") || created.workspace.id.length > 0);

    const updated = updateWorkspace(home, created.workspace.id, {
      name: "IT Division",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.workspace.name, "IT Division");

    const deleted = deleteWorkspace(home, created.workspace.id);
    assert.equal(deleted.ok, true);
    assert.equal(loadWorkspaceRegistry(home).workspaces.length, 0);
  });

  it("assigns and switches projects", () => {
    const home = tmp();
    const created = createWorkspace(home, { name: "Finance" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const wsId = created.workspace.id;

    const assigned = assignProjectToWorkspace(home, wsId, "alpha");
    assert.equal(assigned.ok, true);
    if (!assigned.ok) return;
    assert.deepEqual(assigned.workspace.projectIds, ["alpha"]);
    assert.equal(assigned.workspace.activeProjectId, "alpha");

    assignProjectToWorkspace(home, wsId, "beta");
    const switched = setWorkspaceActiveProject(home, wsId, "beta");
    assert.equal(switched.ok, true);
    if (!switched.ok) return;
    assert.equal(switched.workspace.activeProjectId, "beta");

    const bad = setWorkspaceActiveProject(home, wsId, "gamma");
    assert.equal(bad.ok, false);

    const noop = setWorkspaceActiveProject(home, wsId, "beta");
    assert.equal(noop.ok, true);
    if (!noop.ok) return;
    assert.equal(noop.workspace.updatedAt, switched.workspace.updatedAt);

    const un = unassignProjectFromWorkspace(home, wsId, "beta");
    assert.equal(un.ok, true);
    if (!un.ok) return;
    assert.equal(un.workspace.activeProjectId, "alpha");
  });

  it("seeds IT roles and default chat", () => {
    const home = tmp();
    const created = createWorkspaceWithSeed(home, {
      name: "Divisi IT",
      seedItRoles: true,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.bots.length >= 50);
    assert.ok(
      created.bots.some(
        (b) =>
          /frontend/i.test(b.id) ||
          /frontend/i.test(b.name) ||
          /backend/i.test(b.id),
      ),
    );
    assert.equal(created.chat.id, "general");
  });
});
