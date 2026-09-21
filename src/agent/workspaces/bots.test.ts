import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWorkspaceBotInstruction } from "./bots.js";

describe("buildWorkspaceBotInstruction", () => {
  it("requires tools-first answers when a project is assigned", () => {
    const text = buildWorkspaceBotInstruction(
      {
        id: "cto",
        name: "CTO",
        role: "CTO",
        description: "Architecture",
        systemPrompt: "Respond in Indonesian.",
      },
      {
        project: {
          id: "p1",
          name: "SIMKOPDES",
          folders: ["/tmp/frontend"],
          primaryFolder: "/tmp/frontend",
        },
      },
    );
    assert.match(text, /Call tools FIRST/i);
    assert.match(text, /SAME tools as the global agent/i);
    assert.match(text, /I need to use the available tools/i);
    assert.match(text, /NOT under working\/project/i);
    assert.match(text, /NEVER invent \"folder kosong\"/i);
    assert.match(text, /element type `mermaid`/i);
    assert.match(text, /SIMKOPDES/);
    assert.match(text, /\/tmp\/frontend/);
    assert.match(text, /at most 3 independent `execute` calls/i);
  });

  it("marks parallel group turns and soft-limits shell use", () => {
    const text = buildWorkspaceBotInstruction(
      {
        id: "qa",
        name: "QA",
        role: "QA",
        description: "Testing",
        systemPrompt: "",
      },
      {
        parallelGroup: true,
        priorBotNames: ["CTO", "FE"],
      },
    );
    assert.match(text, /answering this prompt in parallel/i);
    assert.match(text, /Speak ONLY as your own role/i);
    assert.match(text, /at most 3 independent `execute` calls/i);
    assert.match(text, /shared group pool has up to 10 slots/i);
    assert.doesNotMatch(text, /Other teammates already replied/);
  });
});

