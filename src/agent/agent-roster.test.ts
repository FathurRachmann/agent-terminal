import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_KIND_COUNT,
  AGENT_PRESETS,
  buildAgentSystemPrompt,
  resolveAgentPreset,
} from "./agent-presets.js";
import {
  createSpecialistSubagents,
  SPECIALIST_SUBAGENT_NAMES,
} from "./subagents.js";

describe("agent presets (3)", () => {
  it("exposes exactly 3 presets", () => {
    assert.equal(AGENT_KIND_COUNT, 3);
    assert.equal(AGENT_PRESETS.length, 3);
    assert.deepEqual(
      AGENT_PRESETS.map((p) => p.id),
      ["general", "research", "ops"],
    );
  });

  it("resolves overlays for research/ops", () => {
    assert.equal(resolveAgentPreset("general").runtimeName, "terminal-agent");
    assert.equal(resolveAgentPreset("research").runtimeName, "research-agent");
    assert.equal(resolveAgentPreset("ops").runtimeName, "ops-agent");
    const research = buildAgentSystemPrompt("BASE", "research");
    assert.match(research, /BASE/);
    assert.match(research, /Research agent/i);
  });
});

describe("specialist subagents (8)", () => {
  it("registers eight named specialists", () => {
    const list = createSpecialistSubagents();
    assert.equal(list.length, 8);
    assert.equal(SPECIALIST_SUBAGENT_NAMES.length, 8);
    assert.deepEqual(
      list.map((s) => s.name),
      [...SPECIALIST_SUBAGENT_NAMES],
    );
    for (const s of list) {
      assert.ok(s.description);
      assert.ok(s.systemPrompt && s.systemPrompt.length > 40);
    }
  });
});
