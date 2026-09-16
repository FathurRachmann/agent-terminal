import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  attachmentKindFor,
  buildAttachmentPromptBlock,
  buildMultimodalUserContent,
  composePromptWithAttachments,
  finalizeAttachmentFile,
  importLocalAttachment,
  INBOUND_UPLOAD_MAX_BYTES,
  isImageMime,
  resolveWorkspaceUploadAttachment,
  saveAttachmentBuffer,
  waMediaFileName,
} from "./inbound-attachments.js";

describe("inbound-attachments", () => {
  it("detects image mime/kind", () => {
    assert.equal(isImageMime("image/png"), true);
    assert.equal(isImageMime("application/pdf"), false);
    assert.equal(attachmentKindFor("shot.PNG"), "image");
    assert.equal(attachmentKindFor("notes.pdf"), "file");
  });

  it("saves buffer under working/uploads", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "in-att-"));
    try {
      const saved = saveAttachmentBuffer(root, {
        buffer: Buffer.from("hello"),
        fileName: "note.txt",
        mime: "text/plain",
        source: "desktop",
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      assert.equal(saved.attachment.kind, "file");
      assert.ok(saved.attachment.relPath.startsWith("working/uploads/"));
      assert.equal(
        fs.readFileSync(saved.attachment.absPath, "utf8"),
        "hello",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports any binary type via copy and accepts up to 1GB cap", () => {
    assert.equal(INBOUND_UPLOAD_MAX_BYTES, 1024 * 1024 * 1024);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "in-att-"));
    const src = path.join(root, "blob.onnx");
    try {
      fs.writeFileSync(src, Buffer.alloc(2048, 7));
      const imported = importLocalAttachment(root, src, "desktop");
      assert.equal(imported.ok, true);
      if (!imported.ok) return;
      assert.equal(imported.attachment.kind, "file");
      assert.equal(imported.attachment.mime, "application/octet-stream");
      assert.equal(imported.attachment.size, 2048);
      assert.ok(fs.existsSync(imported.attachment.absPath));

      const temp = path.join(os.tmpdir(), `fin-${Date.now()}.bin`);
      fs.writeFileSync(temp, Buffer.from("streamed"));
      const finalized = finalizeAttachmentFile(root, {
        tempAbsPath: temp,
        fileName: "wa-document.xyz",
        mime: "application/octet-stream",
        source: "whatsapp",
      });
      assert.equal(finalized.ok, true);
      if (!finalized.ok) return;
      assert.match(finalized.attachment.basename, /\.xyz$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("imports local image and builds multimodal content", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "in-att-"));
    const src = path.join(root, "pic.png");
    try {
      // minimal PNG-ish bytes are fine for file IO tests
      fs.writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
      const imported = importLocalAttachment(root, src, "desktop");
      assert.equal(imported.ok, true);
      if (!imported.ok) return;
      assert.equal(imported.attachment.kind, "image");

      const prompt = await composePromptWithAttachments("apa ini?", [
        imported.attachment,
      ]);
      assert.match(prompt, /\[ATTACHMENTS\]/);
      assert.match(prompt, /vision_analyze/);
      assert.match(prompt, /apa ini\?/);

      const multi = await buildMultimodalUserContent(prompt, [
        imported.attachment,
      ]);
      assert.ok(Array.isArray(multi));
      if (!Array.isArray(multi)) return;
      assert.equal(multi[0]?.type, "text");
      assert.equal(multi[1]?.type, "image_url");

      const allowed = resolveWorkspaceUploadAttachment(root, {
        path: imported.attachment.relPath,
      });
      assert.equal(allowed.ok, true);

      const blocked = resolveWorkspaceUploadAttachment(root, {
        absPath: src,
      });
      assert.equal(blocked.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("inlines extracted text for attached plain files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "in-att-"));
    try {
      const saved = saveAttachmentBuffer(root, {
        buffer: Buffer.from("Isi laporan TP Administrasi September"),
        fileName: "laporan.txt",
        mime: "text/plain",
        source: "desktop",
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      const block = await buildAttachmentPromptBlock([saved.attachment]);
      assert.match(block, /<extracted/);
      assert.match(block, /Isi laporan TP Administrasi September/);
      assert.match(block, /read_document/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("composes default prompt when text empty", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "in-att-"));
    try {
      const pdfPath = path.join(root, "working", "uploads", "x.pdf");
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      fs.writeFileSync(pdfPath, "%PDF-1.4 fake");
      const att = {
        absPath: pdfPath,
        relPath: "working/uploads/x.pdf",
        basename: "x.pdf",
        mime: "application/pdf",
        size: 12,
        kind: "file" as const,
        source: "whatsapp" as const,
      };
      const block = await buildAttachmentPromptBlock([att]);
      const prompt = await composePromptWithAttachments("", [att]);
      assert.match(block, /FILE:/);
      assert.match(block, /extract_error/);
      assert.match(prompt, /review the attached file/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds wa media file names", () => {
    assert.match(waMediaFileName("imageMessage", "image/jpeg"), /\.jpg$/);
    assert.equal(
      waMediaFileName("documentMessage", "application/pdf", "Report.PDF"),
      "Report.PDF",
    );
  });
});
