import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  discoverDeliverables,
  readWorkspacePreview,
} from "./workspace-preview.js";

describe("workspace preview", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("reads code files under workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"));
    dirs.push(root);
    fs.writeFileSync(path.join(root, "hi.ts"), "export const x = 1;\n", "utf8");
    const res = await readWorkspacePreview(root, "hi.ts");
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.kind, "code");
      assert.match(res.text ?? "", /export const x/);
    }
  });

  it("rejects path escape", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"));
    dirs.push(root);
    const res = await readWorkspacePreview(root, "../secret.txt");
    assert.equal(res.ok, false);
  });

  it("discovers docx from python script command", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "working"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "working", "make_doc.py"),
      'doc.save("working/laporan_bulanan.docx")\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "working", "laporan_bulanan.docx"),
      "PK fake",
      "utf8",
    );
    const res = discoverDeliverables(root, {
      command: "python3 working/make_doc.py",
    });
    assert.ok(
      res.paths.some((p) =>
        p.replace(/\\/g, "/").endsWith("laporan_bulanan.docx"),
      ),
      `expected docx in ${JSON.stringify(res.paths)}`,
    );
  });
});
