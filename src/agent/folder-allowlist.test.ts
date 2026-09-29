import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addFolderAllowlist,
  loadFolderAllowlist,
  saveFolderAllowlist,
} from "./folder-allowlist.js";

describe("folder-allowlist", () => {
  let tmp: string;
  let folderA: string;
  let folderB: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "folder-allow-"));
    folderA = path.join(tmp, "a");
    folderB = path.join(tmp, "b");
    fs.mkdirSync(folderA);
    fs.mkdirSync(folderB);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("starts empty and persists grants", () => {
    assert.deepEqual(loadFolderAllowlist(tmp), []);
    const saved = addFolderAllowlist(tmp, folderA);
    assert.equal(saved.length, 1);
    assert.ok(fs.existsSync(saved[0]!));
    assert.deepEqual(loadFolderAllowlist(tmp), saved);
  });

  it("dedupes and skips missing paths on load", () => {
    const first = saveFolderAllowlist(tmp, [
      folderA,
      folderA,
      path.join(tmp, "gone"),
    ]);
    assert.equal(first.length, 1);
    const after = addFolderAllowlist(tmp, folderB);
    assert.equal(after.length, 2);
    assert.deepEqual(loadFolderAllowlist(tmp).sort(), after.sort());
  });
});
