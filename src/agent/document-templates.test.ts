import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  TEMPLATES_REL_DIR,
  documentTemplatesInstruction,
  ensureTemplatesDir,
  listDocumentTemplates,
  matchTemplatesForIntent,
} from "./document-templates.js";

describe("document-templates", () => {
  it("ensureTemplatesDir creates README", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-home-"));
    const dir = ensureTemplatesDir(home);
    assert.equal(dir, path.join(home, "tmp", "templates"));
    assert.ok(fs.existsSync(path.join(dir, "README.md")));
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lists folder templates with TEMPLATE.md", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-list-"));
    const root = ensureTemplatesDir(home);
    const folder = path.join(root, "laporan-keuangan");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "TEMPLATE.md"), "# hi\n", "utf8");
    fs.writeFileSync(path.join(folder, "sample.pdf"), "%PDF", "utf8");
    const list = listDocumentTemplates(home);
    assert.ok(list.some((t) => t.id === "laporan-keuangan"));
    const hit = list.find((t) => t.id === "laporan-keuangan")!;
    assert.equal(hit.kind, "folder");
    assert.ok(hit.guidePath?.endsWith("TEMPLATE.md"));
    assert.equal(hit.samples.length, 1);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("matchTemplatesForIntent scores laporan keuangan", () => {
    const templates = [
      {
        id: "laporan-keuangan",
        absPath: "/x/laporan-keuangan",
        kind: "folder" as const,
        guidePath: null,
        samples: [],
      },
      {
        id: "bod",
        absPath: "/x/bod",
        kind: "folder" as const,
        guidePath: null,
        samples: [],
      },
    ];
    const hits = matchTemplatesForIntent(
      templates,
      "buatkan laporan keuangan bulanan agustus pdf",
    );
    assert.equal(hits[0]?.id, "laporan-keuangan");
  });

  it("instruction mentions templates path", () => {
    assert.match(documentTemplatesInstruction(), new RegExp(TEMPLATES_REL_DIR));
    assert.match(documentTemplatesInstruction(), /TEMPLATE\.md/);
  });
});
