import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  graphifyGraphPath,
  hasGraphifyGraph,
  graphifyOutDir,
} from "./graphify-tools.js";

describe("graphify status helpers", () => {
  it("reports missing graph for empty workspace", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-status-"));
    try {
      assert.equal(hasGraphifyGraph(root), false);
      assert.equal(
        graphifyGraphPath(root),
        path.join(root, "graphify-out", "graph.json"),
      );
      assert.equal(graphifyOutDir(root), path.join(root, "graphify-out"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports ready when graph.json exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-ready-"));
    try {
      const out = graphifyOutDir(root);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(graphifyGraphPath(root), '{"nodes":[]}', "utf8");
      assert.equal(hasGraphifyGraph(root), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
