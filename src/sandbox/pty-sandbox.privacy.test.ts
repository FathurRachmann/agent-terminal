import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PtySandbox } from "./pty-sandbox.js";
import { unrestrictedFilesystemRoots } from "../agent/default-sandbox-roots.js";

describe("PtySandbox privacy mode", () => {
  it("Privacy OFF allows filesystem root; ON confines to workspace", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pty-privacy-"));
    const workspace = path.join(tmp, "project");
    fs.mkdirSync(workspace, { recursive: true });
    try {
      const sandbox = new PtySandbox({
        workingDirectory: workspace,
        artifactHome: tmp,
        privacyStrict: false,
        initialAllowedRoots: unrestrictedFilesystemRoots(),
        poolSize: 1,
      });
      try {
        assert.equal(sandbox.isPrivacyStrict(), false);
        const offRoots = sandbox.getAllowedRoots();
        assert.ok(
          offRoots.some(
            (r) =>
              path.resolve(r) ===
              path.resolve(unrestrictedFilesystemRoots()[0]!),
          ),
        );
        assert.ok(sandbox.isPathAllowed(path.join(os.homedir(), "Desktop")));

        const on = sandbox.setPrivacyMode(true);
        assert.equal(on.privacyStrict, true);
        assert.equal(sandbox.isPrivacyStrict(), true);
        assert.ok(!on.allowedRoots.some((r) => path.resolve(r) === "/"));
        assert.ok(sandbox.isPathAllowed(workspace));
        const outside = path.join(os.tmpdir(), "not-in-project-xyz");
        fs.mkdirSync(outside, { recursive: true });
        assert.equal(sandbox.isPathAllowed(outside), false);

        const off = sandbox.setPrivacyMode(false);
        assert.equal(off.privacyStrict, false);
        assert.ok(sandbox.isPathAllowed(outside));
      } finally {
        sandbox.dispose();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("PtySandbox.ls", () => {
  it("lists visible and hidden entries like ls -la", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pty-ls-"));
    fs.writeFileSync(path.join(tmp, "visible.txt"), "hi");
    fs.writeFileSync(path.join(tmp, ".secret"), "x");
    fs.mkdirSync(path.join(tmp, "subdir"));
    const sandbox = new PtySandbox({
      workingDirectory: tmp,
      privacyStrict: true,
      poolSize: 1,
    });
    try {
      const result = await sandbox.ls(tmp);
      assert.ok(!result.error, result.error);
      const names = (result.files ?? []).map((f) =>
        path.basename(f.path.replace(/\/$/, "")),
      );
      assert.ok(names.includes("visible.txt"));
      assert.ok(names.includes(".secret"));
      assert.ok(names.includes("subdir"));
      assert.ok((result.files ?? []).some((f) => f.is_dir));
    } finally {
      sandbox.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("lists real Downloads when Privacy OFF (regression)", async () => {
    const downloads = path.join(os.homedir(), "Downloads");
    if (!fs.existsSync(downloads)) return;
    const sandbox = new PtySandbox({
      workingDirectory: process.cwd(),
      privacyStrict: false,
      initialAllowedRoots: unrestrictedFilesystemRoots(),
      poolSize: 1,
    });
    try {
      const result = await sandbox.ls(downloads);
      assert.ok(!result.error, result.error);
      assert.ok(
        (result.files?.length ?? 0) > 0,
        "Downloads must not look empty",
      );
    } finally {
      sandbox.dispose();
    }
  });
});
