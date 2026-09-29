import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PtySandbox } from "../sandbox/pty-sandbox.js";
import {
  projectFoldersOf,
  softAllowProjectFolders,
} from "./soft-allow-project.js";
import type { ProjectRecord } from "../agent/projects/registry.js";

describe("soft-allow-project", () => {
  it("projectFoldersOf prefers primary then unique folders", () => {
    const project = {
      id: "p1",
      name: "Demo",
      folders: ["/a/b", "/a/c", "/a/b"],
      createdAt: "",
      updatedAt: "",
    } as ProjectRecord;
    const folders = projectFoldersOf(project);
    assert.ok(folders.includes("/a/b"));
    assert.ok(folders.includes("/a/c"));
    assert.equal(new Set(folders).size, folders.length);
  });

  it("allowFolders expands roots without changing cwd", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "soft-allow-"));
    const extra = path.join(root, "extra");
    fs.mkdirSync(extra);
    const realExtra = fs.realpathSync(extra);
    const sandbox = new PtySandbox({
      workingDirectory: root,
      poolSize: 1,
      timeoutMs: 5_000,
    });
    try {
      const beforeCwd = sandbox.getWorkspaceRoot();
      const added = sandbox.allowFolders([extra]);
      assert.deepEqual(added, [realExtra]);
      assert.equal(sandbox.getWorkspaceRoot(), beforeCwd);
      assert.ok(sandbox.getAllowedRoots().includes(realExtra));
      assert.equal(sandbox.allowFolders([extra]).length, 0);
    } finally {
      sandbox.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("softAllowProjectFolders fails without bundle", () => {
    const res = softAllowProjectFolders(null, "/tmp", "x");
    assert.equal(res.ok, false);
  });
});
