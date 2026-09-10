import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCommand, checkCommandWorkspaceAccess, isPathInsideWorkspace } from "./guardrails.js";
import { truncateOutput } from "./pty-sandbox.js";

describe("checkCommand", () => {
  it("blocks rm -rf /", () => {
    const r = checkCommand("rm -rf /");
    assert.equal(r.ok, false);
  });

  it("flags destructive rm -rf ./tmp for approval", () => {
    const r = checkCommand("rm -rf ./tmp");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.requiresApproval, true);
  });

  it("allows ls", () => {
    const r = checkCommand("ls -la");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.requiresApproval, false);
  });

  it("blocks raw osascript", () => {
    const r = checkCommand('osascript -e \'tell application "Finder" to activate\'');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /desktop_automate/i);
  });
});

describe("isPathInsideWorkspace", () => {
  it("rejects path traversal", () => {
    assert.equal(isPathInsideWorkspace("/tmp/ws", "../etc/passwd"), false);
  });

  it("allows nested paths", () => {
    assert.equal(isPathInsideWorkspace("/tmp/ws", "src/index.ts"), true);
  });
});

describe("checkCommandWorkspaceAccess", () => {
  it("blocks cd outside allowlist", () => {
    const r = checkCommandWorkspaceAccess(
      "cd /etc",
      ["/tmp/ws"],
      "/tmp/ws",
    );
    assert.equal(r.ok, false);
  });

  it("allows cd inside allowlist", () => {
    const r = checkCommandWorkspaceAccess(
      "cd /tmp/ws/src",
      ["/tmp/ws"],
      "/tmp/ws",
    );
    assert.equal(r.ok, true);
  });

  it("blocks absolute path outside allowlist in command", () => {
    const r = checkCommandWorkspaceAccess(
      "cat /etc/passwd",
      ["/tmp/ws"],
      "/tmp/ws",
    );
    assert.equal(r.ok, false);
  });
});

describe("truncateOutput", () => {
  it("truncates long output with head/tail", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const { truncated, text: out } = truncateOutput(text, 50, 100);
    assert.equal(truncated, true);
    assert.match(out, /lines truncated/);
  });
});
