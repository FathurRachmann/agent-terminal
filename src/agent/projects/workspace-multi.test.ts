import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listWorkspaceDirMulti } from "../../desktop-app/workspace-preview.js";
import fs from "node:fs";
import os from "node:os";

describe("listWorkspaceDirMulti", () => {
  it("rejects empty roots", () => {
    const res = listWorkspaceDirMulti([]);
    assert.equal(res.ok, false);
  });

  it("lists virtual roots for multi-folder projects", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ws-multi-"));
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "one.txt"), "1");
    try {
      const top = listWorkspaceDirMulti([a, b], "");
      assert.equal(top.ok, true);
      if (!top.ok) return;
      assert.equal(top.entries.length, 2);
      assert.ok(top.entries.every((e) => e.kind === "dir"));

      const inside = listWorkspaceDirMulti([a, b], a);
      assert.equal(inside.ok, true);
      if (!inside.ok) return;
      assert.ok(inside.entries.some((e) => e.name === "one.txt"));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
