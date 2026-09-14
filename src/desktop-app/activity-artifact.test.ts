import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractResultPathsFromText,
  inferPreviewKind,
  normalizeCanvasKey,
  parseDelimitedPreview,
  pickAutoFocusArtifact,
  preferCanvasPath,
  resolveArtifactsFromTool,
  resolveArtifactFromTool,
  shouldAutoFocusCanvas,
} from "../desktop-app/renderer/activity-artifact.js";

describe("activity artifacts", () => {
  it("infers preview kinds from extensions", () => {
    assert.equal(inferPreviewKind("tsx"), "code");
    assert.equal(inferPreviewKind("html"), "html");
    assert.equal(inferPreviewKind("csv"), "csv");
    assert.equal(inferPreviewKind("xlsx"), "spreadsheet");
    assert.equal(inferPreviewKind("docx"), "document");
    assert.equal(inferPreviewKind("docs"), "document");
    assert.equal(inferPreviewKind("sheet"), "spreadsheet");
  });

  it("resolves write_file artifacts with inline content", () => {
    const art = resolveArtifactFromTool({
      name: "write_file",
      input: {
        path: "working/demo.js",
        content: "console.log(1)",
      },
    });
    assert.ok(art);
    assert.equal(art?.basename, "demo.js");
    assert.equal(art?.kind, "code");
    assert.equal(art?.inlineContent, "console.log(1)");
  });

  it("prefers docx deliverable over generator script", () => {
    const arts = resolveArtifactsFromTool({
      name: "write_file",
      input: {
        path: "make_doc.py",
        content:
          'doc.save("laporan_bulanan.docx")\nprint("wrote laporan_bulanan.docx")\n',
      },
    });
    assert.ok(arts.some((a) => a.basename === "make_doc.py"));
    assert.ok(arts.some((a) => a.basename === "laporan_bulanan.docx"));
    const focus = pickAutoFocusArtifact(arts);
    assert.equal(focus?.basename, "laporan_bulanan.docx");
    assert.equal(shouldAutoFocusCanvas("code"), false);
    assert.equal(shouldAutoFocusCanvas("document"), true);
  });

  it("extracts result paths from shell output", () => {
    const paths = extractResultPathsFromText(
      "Saved report to ./working/laporan_bulanan.docx\n",
    );
    assert.ok(paths.some((p) => p.endsWith("laporan_bulanan.docx")));
  });

  it("parses csv preview grids", () => {
    const { headers, rows } = parseDelimitedPreview("a,b\n1,2\n3,4");
    assert.deepEqual(headers, ["a", "b"]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], ["1", "2"]);
  });

  it("collapses equivalent canvas paths to one key", () => {
    const a = normalizeCanvasKey("working/rencana_alur_login_secure.md");
    const b = normalizeCanvasKey(
      "/Users/me/Agent/working/rencana_alur_login_secure.md",
    );
    const c = normalizeCanvasKey("./working/rencana_alur_login_secure.md");
    assert.equal(a, b);
    assert.equal(a, c);
    assert.equal(
      preferCanvasPath("working/a.md", "/abs/working/a.md"),
      "/abs/working/a.md",
    );
  });
});
