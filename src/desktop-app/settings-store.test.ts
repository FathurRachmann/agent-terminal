import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  maskSecret,
  loadStoredSettings,
  saveStoredSettings,
  upsertEnvFile,
} from "./settings-store.js";

describe("settings-store", () => {
  it("masks secrets", () => {
    assert.equal(maskSecret(""), "");
    assert.match(maskSecret("sk-abcdefghijklmnop"), /^sk-•+/);
  });

  it("persists agent/ui settings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-settings-"));
    saveStoredSettings(root, {
      version: 1,
      agent: {
        autoApproveDestructive: false,
        requirePlanApproval: true,
        enableReflection: false,
        enableCheckpointer: true,
      },
      ui: {
        defaultRailOpen: false,
        defaultRailLayer: "canvas",
        compactActivity: true,
        showFooterPhase: false,
        showLearnedInFooter: true,
        openChatPathsInCanvas: false,
        preferStreamedAnswer: true,
      },
      env: { AGENT_MODEL: "test-model" },
    });
    const loaded = loadStoredSettings(root);
    assert.equal(loaded.agent.autoApproveDestructive, false);
    assert.equal(loaded.ui.defaultRailLayer, "canvas");
    assert.equal(loaded.ui.showFooterPhase, false);
    assert.equal(loaded.ui.openChatPathsInCanvas, false);
    assert.equal(loaded.env?.AGENT_MODEL, "test-model");
  });

  it("migrates legacy defaultRailLayer trace → canvas", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-settings-"));
    const file = path.join(root, ".agent", "settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        agent: {},
        ui: { defaultRailLayer: "trace" },
      }),
      "utf8",
    );
    const loaded = loadStoredSettings(root);
    assert.equal(loaded.ui.defaultRailLayer, "canvas");
    assert.equal(loaded.ui.showFooterPhase, true);
  });

  it("upserts env keys without wiping others", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-env-"));
    const file = path.join(root, ".env");
    fs.writeFileSync(file, "FOO=1\nBAR=2\n", "utf8");
    upsertEnvFile(file, { BAR: "9", BAZ: "3" });
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^FOO=1$/m);
    assert.match(text, /^BAR=9$/m);
    assert.match(text, /^BAZ=3$/m);
  });
});
