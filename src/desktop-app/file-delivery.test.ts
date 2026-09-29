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
    assert.equal(isDeliverableChatPath("tmp/report.pdf"), true);
    assert.equal(isDeliverableChatPath("tmp/archive.tar.gz"), true);
    assert.equal(isDeliverableChatPath("tmp/data.bin"), true);
    assert.equal(isDeliverableChatPath("tmp/model.onnx"), true);
    assert.equal(isDeliverableChatPath("tmp/noext"), false);
    assert.equal(mimeForPath("x.unknownext"), "application/octet-stream");
    assert.equal(WA_DOCUMENT_MAX_BYTES, 1024 * 1024 * 1024);
  });

  it("collects deliverable paths from assistant text", () => {
    const paths = collectDeliverablePaths([
      "Saved at `tmp/laporan_september_2026.doc` and also working/notes.md",
    ]);
    assert.ok(paths.some((p) => p.includes("laporan_september_2026.doc")));
    assert.ok(paths.some((p) => p.endsWith("notes.md")));
  });

  it("collects arbitrary extensions mentioned in replies", () => {
    const paths = collectDeliverablePaths([
      "File siap: `tmp/export.iso` dan working/backup.rar",
    ]);
    assert.ok(paths.some((p) => p.endsWith("export.iso")));
    assert.ok(paths.some((p) => p.endsWith("backup.rar")));
  });

  it("collects spaced filenames inside backticks", () => {
    const paths = collectDeliverablePaths([
      "Sudah dibuat: `tmp/LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc`",
    ]);
    assert.equal(paths.length, 1);
    assert.equal(
      paths[0],
      "tmp/LAPORAN TP ADMINISTRASI SEPTEMBER 2026 - DIANDRA.doc",
    );
  });

  it("preserves absolute Unix paths from backticks", () => {
    const paths = collectDeliverablePaths([
      "Saved at `/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf`",
    ]);
    assert.equal(
      paths[0],
      "/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf",
    );
  });

  it("restores absolute path when leading slash was stripped", () => {
    const paths = collectDeliverablePaths(
      [],
      ["Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf"],
    );
    assert.equal(
      paths[0],
      "/Users/fathurrachman/Desktop/Agent/tmp/project/simkopdes/FSD_SIMKOPDES_FINAL.pdf",
    );
  });

  it("resolves basename under tmp/project/<name>/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      const dir = path.join(root, "tmp", "project", "simkopdes");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "FSD_SIMKOPDES_FINAL.pdf"), "%PDF");
      const resolved = resolveExistingWorkspaceFile(
        [root],
        "FSD_SIMKOPDES_FINAL.pdf",
      );
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.basename, "FSD_SIMKOPDES_FINAL.pdf");
      assert.ok(resolved.abs.includes(path.join("tmp", "project", "simkopdes")));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves absolute path under artifact home root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-"));
    try {
      const dir = path.join(root, "tmp", "project", "simkopdes");
      fs.mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, "FSD_SIMKOPDES_FINAL.pdf");
      fs.writeFileSync(abs, "%PDF");
      const stripped = abs.replace(/^\//, "");
      const resolved = resolveExistingWorkspaceFile([root], stripped);
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.abs, abs);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves basename fallback under tmp/", () => {
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
      const rel = path.join("tmp", "hi.docx");
      fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
      fs.writeFileSync(path.join(root, rel), "PK\x00fake");
      const resolved = resolveExistingWorkspaceFile([root], "tmp/hi.docx");
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.basename, "hi.docx");
      assert.equal(mimeForPath(resolved.abs), mimeForPath("x.docx"));
      const read = readFileForDelivery([root], "tmp/hi.docx");
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
      fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
      const rel = path.join("tmp", "big.bin");
      fs.writeFileSync(path.join(root, rel), Buffer.alloc(100));
      const ok = prepareFileForDelivery([root], "tmp/big.bin");
      assert.equal(ok.ok, true);
      if (!ok.ok) return;
      assert.equal(ok.mime, "application/octet-stream");
      assert.ok(ok.abs.length > 0);

      const tooBig = prepareFileForDelivery([root], "tmp/big.bin", 50);
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

  it("opens absolute path outside workspace roots when file exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-ws-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-out-"));
    try {
      const abs = path.join(outside, "(08122025) Undangan.docx");
      fs.writeFileSync(abs, "PK\x00fake");
      const resolved = resolveExistingWorkspaceFile([root], abs);
      assert.equal(resolved.ok, true);
      if (!resolved.ok) return;
      assert.equal(resolved.abs, abs);
      assert.equal(resolved.basename, "(08122025) Undangan.docx");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("drops truncated basename when longer spaced name is present", () => {
    const paths = collectDeliverablePaths([
      "Lihat `Kata Kami- Rumusan Kebijakan Keamanan Pemerintah Digital.pdf` dan Digital.pdf",
    ]);
    assert.ok(
      paths.some((p) =>
        p.includes("Kata Kami- Rumusan Kebijakan Keamanan Pemerintah Digital.pdf"),
      ),
    );
    assert.ok(!paths.includes("Digital.pdf"));
  });

  it("finds basename nested under a user-style folder tree", async () => {
    const { findByBasenameUnderDirs } = await import("./file-delivery.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-del-nest-"));
    try {
      const nested = path.join(
        root,
        "Bahan Tayang",
        "Materi 1: Rumusan",
      );
      fs.mkdirSync(nested, { recursive: true });
      const name = "Kata Kami- Rumusan Kebijakan Keamanan Pemerintah Digital.pdf";
      const abs = path.join(nested, name);
      fs.writeFileSync(abs, "%PDF-1.4");
      const hit = findByBasenameUnderDirs([root], name, 6);
      assert.ok(hit);
      assert.equal(hit!.abs, abs);
      assert.equal(hit!.basename, name);

      // Truncated scrape still resolves via suffix match
      const trunc = findByBasenameUnderDirs([root], "Digital.pdf", 6);
      assert.ok(trunc);
      assert.equal(trunc!.basename, name);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
