import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectDeliverablePaths,
  isDeliverableChatPath,
  mimeForPath,
  prepareFileForDelivery,
  resolveExistingWorkspaceFile,
  readFileForDelivery,
  WA_DOCUMENT_MAX_BYTES,
} from "./file-delivery.js";

describe("file-delivery", () => {
  it("allows any file extension for chat/WA delivery", () => {
    assert.equal(isDeliverableChatPath("working/report.pdf"), true);
    assert.equal(isDeliverableChatPath("working/archive.tar.gz"), true);
    assert.equal(isDeliverableChatPath("working/data.bin"), true);
    assert.equal(isDeliverableChatPath("working/model.onnx"), true);
    assert.equal(isDeliverableChatPath("working/noext"), false);
    assert.equal(mimeForPath("x.unknownext"), "application/octet-stream");
    assert.equal(WA_DOCUMENT_MAX_BYTES, 1024 * 1024 * 1024);
  });

  it("collects deliverable paths from assistant text", () => {
    const paths = collectDeliverablePaths([
      "Saved at `working/laporan_september_2026.doc` and also working/notes.md",
    ]);
    assert.ok(paths.some((p) => p.includes("laporan_september_2026.doc")));
    assert.ok(paths.some((p) => p.endsWith("notes.md")));
  });

  it("collects arbitrary extensions mentioned in replies", () => {
    const paths = collectDeliverablePaths([
      "File siap: `working/export.iso` dan working/backup.rar",
    ]);
    assert.ok(paths.some((p) => p.endsWith("export.iso")));
    assert.ok(paths.some((p) => p.endsWith("backup.rar")));
  });

  it("collects spaced filenames inside backticks", () => {
    const paths = collectDeliverablePaths([
      "Sudah dibuat: `working/LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc`",
    ]);
    assert.equal(paths.length, 1);
    assert.equal(
      paths[0],
      "working/LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc",
    );
  });

  it("resolves basename fallback under working/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      fs.mkdirSync(path.join(root, "working"), { recursive: true });
      const full = path.join(
        root,
        "working",
        "LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc",
      );
      fs.writeFileSync(full, "doc-bytes");
      // Truncated name as previously extracted from unquoted text
      const resolved = resolveExistingWorkspaceFile([root], "DIANDRA.doc");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(
        resolved.basename,
        "LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves and reads a workspace file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      const rel = path.join("working", "hi.docx");
      fs.mkdirSync(path.join(root, "working"), { recursive: true });
      fs.writeFileSync(path.join(root, rel), "PK\x00fake");
      const resolved = resolveExistingWorkspaceFile([root], "working/hi.docx");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.basename, "hi.docx");
      assert.equal(mimeForPath(resolved.abs), mimeForPath("x.docx"));
      const read = readFileForDelivery([root], "working/hi.docx");
      assert.equal(read.ok, true);
      if (!read.ok) return;
      assert.equal(read.basename, "hi.docx");
      assert.ok(read.buffer.length > 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("prepareFileForDelivery reports 1GB max without buffering", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      fs.mkdirSync(path.join(root, "working"), { recursive: true });
      const rel = path.join("working", "big.bin");
      fs.writeFileSync(path.join(root, rel), Buffer.alloc(100));
      const ok = prepareFileForDelivery([root], "working/big.bin");
      assert.equal(ok.ok, true);
      if (!ok.ok) return;
      assert.equal(ok.mime, "application/octet-stream");
      assert.ok(ok.abs.length > 0);

      const tooBig = prepareFileForDelivery([root], "working/big.bin", 50);
      assert.equal(tooBig.ok, false);
      if (tooBig.ok) return;
      assert.match(tooBig.error, /too large/i);
      assert.match(tooBig.error, /Max /i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects path escape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      const res = resolveExistingWorkspaceFile([root], "../secret.txt");
      assert.equal(res.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
