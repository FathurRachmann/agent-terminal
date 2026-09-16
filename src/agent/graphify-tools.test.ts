import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  graphifyGraphPath,
  graphifyOutDir,
  hasGraphifyGraph,
} from "./graphify-tools.js";

describe("graphify-tools helpers", () => {
  it("resolves project-scoped graphify-out paths", () => {
    const root = "/tmp/my-project";
    assert.equal(graphifyOutDir(root), path.join(root, "graphify-out"));
    assert.equal(
      graphifyGraphPath(root),
      path.join(root, "graphify-out", "graph.json"),
    );
  });

  it("detects missing vs present graph.json under project root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gf-tools-"));
    try {
      assert.equal(hasGraphifyGraph(root), false);
      fs.mkdirSync(path.join(root, "graphify-out"), { recursive: true });
      fs.writeFileSync(graphifyGraphPath(root), "{\"nodes\":[]}");
      assert.equal(hasGraphifyGraph(root), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
