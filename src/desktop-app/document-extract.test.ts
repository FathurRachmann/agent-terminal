import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { extractDocumentText } from "./document-extract.js";
import { spawnSync } from "node:child_process";

describe("document-extract", () => {
  it("extracts plain text files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-ex-"));
    const file = path.join(root, "note.txt");
    try {
      fs.writeFileSync(file, "Halo laporan September");
      const res = await extractDocumentText(file);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.match(res.text, /Halo laporan September/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects legacy .doc with clear error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-ex-"));
    const file = path.join(root, "old.doc");
    try {
      fs.writeFileSync(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
      const res = await extractDocumentText(file);
      assert.equal(res.ok, false);
      if (res.ok) return;
      assert.match(res.error, /\.doc/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("extracts text from a minimal docx zip", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-ex-"));
    const dir = path.join(root, "docx-src");
    const out = path.join(root, "sample.docx");
    try {
      fs.mkdirSync(path.join(dir, "word", "_rels"), { recursive: true });
      fs.mkdirSync(path.join(dir, "_rels"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "[Content_Types].xml"),
        `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      );
      fs.writeFileSync(
        path.join(dir, "_rels", ".rels"),
        `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      );
      fs.writeFileSync(
        path.join(dir, "word", "document.xml"),
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Laporan Diandra September 2026</w:t></w:r></w:p></w:body>
</w:document>`,
      );
      fs.writeFileSync(
        path.join(dir, "word", "_rels", "document.xml.rels"),
        `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
      );
      const zipped = spawnSync(
        "zip",
        ["-qr", out, ".", "-i", "*"],
        { cwd: dir, encoding: "utf8" },
      );
      if (zipped.status !== 0) {
        // Skip when zip CLI is unavailable
        return;
      }
      const res = await extractDocumentText(out);
      assert.equal(res.ok, true);
      if (!res.ok) return;
      assert.match(res.text, /Laporan Diandra September 2026/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
