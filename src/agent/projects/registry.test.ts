import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  deleteProject,
  getActiveProject,
  listProjectSummaries,
  loadProjectRegistry,
  setActiveProject,
  updateProject,
} from "./registry.js";

describe("projects registry", () => {
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

  function tmpHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "proj-reg-"));
    dirs.push(home);
    const folder = path.join(home, "code");
    fs.mkdirSync(folder, { recursive: true });
    return home;
  }

  it("creates, activates, lists, and deletes projects", () => {
    const home = tmpHome();
    const folder = path.join(home, "code");
    const created = createProject(home, {
      name: "Skunkworks",
      folders: [folder],
      idea: "Build cool stuff",
      activate: true,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.project.name, "Skunkworks");
    assert.ok(fs.existsSync(path.join(folder, "IDEA.md")));
    assert.equal(getActiveProject(home)?.id, created.project.id);

    const listed = listProjectSummaries(home);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.isActive, true);

    const left = setActiveProject(home, null);
    assert.equal(left.ok, true);
    assert.equal(getActiveProject(home), null);

    const deleted = deleteProject(home, created.project.id);
    assert.equal(deleted.ok, true);
    assert.equal(loadProjectRegistry(home).projects.length, 0);
  });

  it("rejects create without folders", () => {
    const home = tmpHome();
    const res = createProject(home, { name: "Empty", folders: [] });
    assert.equal(res.ok, false);
  });

  it("updates folders on existing project", () => {
    const home = tmpHome();
    const a = path.join(home, "code");
    const b = path.join(home, "extra");
    fs.mkdirSync(b, { recursive: true });
    const created = createProject(home, {
      name: "Multi",
      folders: [a],
      activate: false,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = updateProject(home, created.project.id, {
      folders: [a, b],
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.deepEqual(updated.project.folders, [a, b]);
  });
});
