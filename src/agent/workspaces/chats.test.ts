import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createGroupChat, updateGroupChat } from "./chats.js";
import { createWorkspace } from "./registry.js";

describe("group chat maxResponders", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chats-"));

  after(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("caps maxResponders at 10", () => {
    const ws = createWorkspace(home, { name: "Team" });
    assert.equal(ws.ok, true);
    if (!ws.ok) return;

    const created = createGroupChat(home, ws.workspace.id, {
      name: "General",
      maxResponders: 99,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.chat.maxResponders, 10);
    assert.equal(created.chat.supervisorEnabled, true);
    assert.equal(created.chat.maxRounds, 8);
    assert.equal(created.chat.roundCount, 0);

    const updated = updateGroupChat(home, ws.workspace.id, created.chat.id, {
      maxResponders: 12,
      maxRounds: 99,
      supervisorBotId: "cto",
      roundCount: 3,
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.chat.maxResponders, 10);
    assert.equal(updated.chat.maxRounds, 20);
    assert.equal(updated.chat.supervisorBotId, "cto");
    assert.equal(updated.chat.roundCount, 3);
  });
});
