import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  defaultSandboxAllowedRoots,
  isBroadFilesystemRoot,
  mergeAllowedRoots,
  privacyStrictAllowedRoots,
  unrestrictedFilesystemRoots,
  userHomeRoot,
  usersScopeRoot,
} from "./default-sandbox-roots.js";
import {
  loadPrivacyMode,
  privacyModeInstruction,
  savePrivacyMode,
} from "./privacy-mode.js";

describe("default-sandbox-roots", () => {
  it("userHomeRoot returns existing home", () => {
    const home = userHomeRoot();
    assert.ok(home);
    assert.ok(fs.existsSync(home!));
    assert.equal(home, path.resolve(os.homedir()));
  });

  it("usersScopeRoot is /Users on macOS/Linux", () => {
    const scope = usersScopeRoot();
    assert.ok(scope);
    if (process.platform === "darwin" || process.platform === "linux") {
      assert.equal(scope, "/Users");
    }
  });

  it("unrestrictedFilesystemRoots covers the machine", () => {
    const roots = unrestrictedFilesystemRoots();
    assert.ok(roots.length >= 1);
    if (process.platform === "win32") {
      assert.ok(/^[A-Za-z]:\\?$/.test(roots[0]!) || roots[0]!.endsWith("\\"));
    } else {
      assert.equal(roots[0], "/");
    }
  });

  it("defaultSandboxAllowedRoots includes unrestricted root (Privacy OFF)", () => {
    const unrestricted = unrestrictedFilesystemRoots()[0]!;
    const roots = defaultSandboxAllowedRoots({
      workspaceRoot: "/tmp/agent-app",
      artifactHome: "/tmp/agent-app",
      projectFolders: ["/tmp/proj"],
      persistedFolders: [],
    });
    assert.ok(
      roots.some((r) => path.resolve(r) === path.resolve(unrestricted)),
    );
  });

  it("privacyStrictAllowedRoots excludes broad roots", () => {
    const roots = privacyStrictAllowedRoots({
      workspaceRoot: "/tmp/agent-app",
      artifactHome: "/tmp/agent-app",
      projectFolders: ["/tmp/proj"],
      persistedFolders: ["/tmp/granted"],
    });
    assert.ok(!roots.some((r) => isBroadFilesystemRoot(r)));
    assert.ok(
      roots.some((r) => path.resolve(r) === path.resolve("/tmp/agent-app")),
    );
    assert.ok(
      roots.some((r) => path.resolve(r) === path.resolve("/tmp/granted")),
    );
  });

  it("mergeAllowedRoots dedupes", () => {
    const a = mergeAllowedRoots(["/tmp/x"], ["/tmp/x", "/tmp/y"]);
    assert.equal(
      a.filter((r) => r.endsWith("/x") || r === path.resolve("/tmp/x")).length,
      1,
    );
    assert.ok(a.length >= 2);
  });
});

describe("privacy-mode persist", () => {
  it("round-trips enabled flag", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-mode-"));
    try {
      assert.equal(loadPrivacyMode(tmp), false);
      savePrivacyMode(tmp, true);
      assert.equal(loadPrivacyMode(tmp), true);
      savePrivacyMode(tmp, false);
      assert.equal(loadPrivacyMode(tmp), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("instruction mentions Privacy ON vs OFF", () => {
    assert.match(privacyModeInstruction(true), /Privacy ON/);
    assert.match(privacyModeInstruction(true), /request_folder_access/);
    assert.match(privacyModeInstruction(false), /Privacy OFF/);
    assert.match(privacyModeInstruction(false), /full machine/i);
    assert.match(privacyModeInstruction(false), /Do not call request_folder_access/i);
  });
});
