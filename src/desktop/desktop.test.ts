import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DESKTOP_APPS,
  grantDesktopApp,
  isAppAllowed,
  loadDesktopAllowlist,
  saveDesktopAllowlist,
} from "./allowlist.js";
import { runDesktopAction, validateHttpUrl } from "./actions.js";
import {
  escapeAppleScriptString,
  KEYSTROKE_MAX_CHARS,
} from "./macos.js";

describe("desktop allowlist", () => {
  let dir: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-"));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to Google Chrome only", () => {
    assert.deepEqual(loadDesktopAllowlist(dir), [...DEFAULT_DESKTOP_APPS]);
    assert.equal(isAppAllowed(dir, "Google Chrome"), true);
    assert.equal(isAppAllowed(dir, "Safari"), false);
  });

  it("grants and persists additional apps", () => {
    const apps = grantDesktopApp(dir, "Safari");
    assert.ok(apps.includes("Google Chrome"));
    assert.ok(apps.includes("Safari"));
    assert.equal(isAppAllowed(dir, "safari"), true);
    const reloaded = loadDesktopAllowlist(dir);
    assert.ok(reloaded.includes("Safari"));
  });

  it("save replaces allowlist", () => {
    saveDesktopAllowlist(dir, ["Google Chrome"]);
    assert.deepEqual(loadDesktopAllowlist(dir), ["Google Chrome"]);
  });
});

describe("desktop validation", () => {
  it("escapes AppleScript string literals", () => {
    assert.equal(escapeAppleScriptString('say "hi"'), 'say \\"hi\\"');
    assert.equal(escapeAppleScriptString("a\\b"), "a\\\\b");
  });

  it("allows only http(s) URLs", () => {
    assert.equal(validateHttpUrl("https://example.com").ok, true);
    assert.equal(validateHttpUrl("http://localhost:3000").ok, true);
    assert.equal(validateHttpUrl("javascript:alert(1)").ok, false);
    assert.equal(validateHttpUrl("file:///etc/passwd").ok, false);
    assert.equal(validateHttpUrl("not a url").ok, false);
  });

  it("caps keystroke length constant", () => {
    assert.equal(KEYSTROKE_MAX_CHARS, 200);
  });

  it("rejects apps outside allowlist without calling osascript", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-block-"));
    try {
      const result = await runDesktopAction(dir, {
        action: "open_app",
        app: "Safari",
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /not on desktop allowlist/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects dangerous URL schemes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-url-"));
    try {
      const result = await runDesktopAction(dir, {
        action: "open_url",
        app: "Google Chrome",
        url: "javascript:alert(1)",
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /blocked scheme/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects control characters in AppleScript strings", () => {
    assert.throws(() => escapeAppleScriptString("a\nb"), /control characters/);
  });

  it("rejects newline app names for allowlist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-nl-"));
    try {
      assert.equal(isAppAllowed(dir, "Google\nChrome"), false);
      const result = await runDesktopAction(dir, {
        action: "open_app",
        app: "Google\nChrome",
      });
      assert.equal(result.ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects oversized keystroke text", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-keys-"));
    try {
      const result = await runDesktopAction(dir, {
        action: "keystroke",
        app: "Google Chrome",
        text: "x".repeat(KEYSTROKE_MAX_CHARS + 1),
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /exceeds/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks Cmd+Q keystroke", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-desktop-qq-"));
    try {
      const result = await runDesktopAction(dir, {
        action: "keystroke",
        app: "Google Chrome",
        text: "q",
        modifiers: ["cmd"],
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /Cmd\+Q/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
