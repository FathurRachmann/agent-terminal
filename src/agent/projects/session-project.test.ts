import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../../memory/session-store.js";

describe("SessionStore project scoping", () => {
  const dirs: string[] = [];

  after(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("filters listSessions by projectId meta", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sess-proj-"));
    dirs.push(root);
    const store = new SessionStore(root, root);

    store.startOrResume({
      threadId: "desktop-global",
      model: "m",
      projectId: null,
    });
    store.appendTranscript({
      threadId: "desktop-global",
      role: "user",
      content: "hello global",
    });

    store.startOrResume({
      threadId: "desktop-proj",
      model: "m",
      projectId: "alpha",
    });
    store.appendTranscript({
      threadId: "desktop-proj",
      role: "user",
      content: "hello project",
    });

    const globalOnly = store.listSessions(null);
    assert.equal(globalOnly.length, 1);
    assert.equal(globalOnly[0]!.threadId, "desktop-global");
    assert.equal(globalOnly[0]!.projectId, null);

    const projectOnly = store.listSessions("alpha");
    assert.equal(projectOnly.length, 1);
    assert.equal(projectOnly[0]!.threadId, "desktop-proj");
    assert.equal(projectOnly[0]!.projectId, "alpha");

    const all = store.listSessions();
    assert.equal(all.length, 2);
  });

  it("treats missing meta as global", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sess-legacy-"));
    dirs.push(root);
    const store = new SessionStore(root, root);
    const file = path.join(
      root,
      ".agent",
      "memory",
      "sessions",
      "legacy.jsonl",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        threadId: "legacy",
        role: "user",
        content: "old",
      })}\n`,
      "utf8",
    );
    const globalOnly = store.listSessions(null);
    assert.ok(globalOnly.some((s) => s.threadId === "legacy"));
  });
});
