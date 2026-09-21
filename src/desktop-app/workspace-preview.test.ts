import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  discoverDeliverables,
  listWorkspaceDir,
  readWorkspacePreview,
  wrapMermaidForMarkdownPreview,
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

  it("wraps raw .mmd as mermaid markdown for canvas", async () => {
    assert.match(
      wrapMermaidForMarkdownPreview("flowchart TD\n  A-->B", "mmd"),
      /```mermaid/,
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-"));
    dirs.push(root);
    fs.writeFileSync(
      path.join(root, "flow.mmd"),
      "flowchart TD\n  A[Start] --> B[End]\n",
      "utf8",
    );
    const res = await readWorkspacePreview(root, "flow.mmd");
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.kind, "markdown");
      assert.match(res.text ?? "", /```mermaid/);
      assert.match(res.text ?? "", /flowchart TD/);
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

  it("lists directory entries and expands nested folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "listdir-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "src", "util"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "src", "index.ts"), "export {}\n", "utf8");
    fs.writeFileSync(path.join(root, "src", "util", "a.ts"), "export {}\n", "utf8");
    fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });

    const top = listWorkspaceDir(root, "");
    assert.equal(top.ok, true);
    if (!top.ok) return;
    assert.ok(top.entries.some((e) => e.name === "src" && e.kind === "dir"));
    assert.ok(
      top.entries.some((e) => e.name === "package.json" && e.kind === "file"),
    );
    assert.ok(!top.entries.some((e) => e.name === "node_modules"));

    const src = listWorkspaceDir(root, "src");
    assert.equal(src.ok, true);
    if (!src.ok) return;
    assert.ok(src.entries.some((e) => e.name === "util" && e.kind === "dir"));
    assert.ok(src.entries.some((e) => e.name === "index.ts" && e.kind === "file"));

    const nested = listWorkspaceDir(root, "src/util");
    assert.equal(nested.ok, true);
    if (!nested.ok) return;
    assert.deepEqual(
      nested.entries.map((e) => e.path),
      ["src/util/a.ts"],
    );
  });

  it("rejects directory escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "listdir-esc-"));
    dirs.push(root);
    const res = listWorkspaceDir(root, "../");
    assert.equal(res.ok, false);
  });

  it("previews PDF via streaming previewUrl (not conversion note)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-pdf-"));
    dirs.push(root);
    const pdfPath = path.join(root, "guide.pdf");
    // Minimal PDF header is enough for file existence / metadata path
    fs.writeFileSync(pdfPath, "%PDF-1.4\n%fake\n");
    const res = await readWorkspacePreview(root, "guide.pdf");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.kind, "pdf");
    assert.ok(res.previewUrl?.startsWith("agent-preview://"));
    assert.ok(!String(res.note || "").includes("needs conversion"));
  });

  it("shows binary file card metadata for unknown binary types", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prev-bin-"));
    dirs.push(root);
    fs.writeFileSync(path.join(root, "model.onnx"), Buffer.from([0, 1, 2, 3, 4]));
    const res = await readWorkspacePreview(root, "model.onnx");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.kind, "binary");
    assert.ok(res.previewUrl?.startsWith("agent-preview://"));
    assert.ok(res.sizeLabel);
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
