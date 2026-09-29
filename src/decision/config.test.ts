import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadDecisionConfig,
  projectVenvPythonExists,
  resolveLayaPythonBin,
} from "./config.js";

describe("decision config", () => {
  it("defaults enabled and prefers project venv python", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "laya-cfg-"));
    const venvPy = path.join(tmp, ".venv", "bin", "python");
    fs.mkdirSync(path.dirname(venvPy), { recursive: true });
    fs.writeFileSync(venvPy, "#!/bin/sh\n");
    fs.chmodSync(venvPy, 0o755);
    try {
      assert.equal(projectVenvPythonExists(tmp), true);
      assert.equal(resolveLayaPythonBin({}, tmp), venvPy);
      const cfg = loadDecisionConfig({
        // no LAYA_ENABLED → on
        LAYA_PYTHON: venvPy,
      });
      assert.equal(cfg.enabled, true);
      assert.equal(cfg.pythonBin, venvPy);
      // Process bridge is opt-in — venv alone must not spawn per-turn.
      assert.equal(cfg.useProcessBridge, false);
      assert.equal(cfg.timeoutMs, 2000);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("LAYA_ENABLED=0 disables", () => {
    const cfg = loadDecisionConfig({ LAYA_ENABLED: "0" });
    assert.equal(cfg.enabled, false);
  });

  it("LAYA_FORCE_PROCESS=0 disables process bridge", () => {
    const cfg = loadDecisionConfig({
      LAYA_ENABLED: "1",
      LAYA_FORCE_PROCESS: "0",
      LAYA_URL: "http://127.0.0.1:8765/predict",
    });
    assert.equal(cfg.useProcessBridge, false);
  });

  it("process bridge is opt-in (not auto from venv)", () => {
    const cfg = loadDecisionConfig({
      LAYA_ENABLED: "1",
      LAYA_PYTHON: "/usr/bin/python3",
    });
    assert.equal(cfg.useProcessBridge, false);
    assert.equal(cfg.timeoutMs, 2000);
  });

  it("LAYA_FORCE_PROCESS=1 enables process bridge", () => {
    const cfg = loadDecisionConfig({
      LAYA_ENABLED: "1",
      LAYA_FORCE_PROCESS: "1",
    });
    assert.equal(cfg.useProcessBridge, true);
  });
});
