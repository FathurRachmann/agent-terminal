import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInterruptOn,
  matchesToolAllowlist,
  resolveRunMode,
  isRunModeGatedTool,
} from "./run-modes.js";
import { isConfigSensitivePath } from "./config-edit-guard.js";
import { parseClassifierResponse } from "./tool-classifier.js";
import {
  chatModeToolAllowlist,
  intersectAllowlists,
  parseAgentChatMode,
} from "./chat-mode.js";
import {
  formatSkillCatalogBlock,
  listSkillDescriptions,
} from "./skill-catalog.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("run-modes", () => {
  it("migrates autoApproveDestructive to runMode", () => {
    assert.equal(resolveRunMode({ autoApproveDestructive: true }), "run-everything");
    assert.equal(resolveRunMode({ autoApproveDestructive: false }), "auto-review");
    assert.equal(
      resolveRunMode({ runMode: "allowlist", autoApproveDestructive: true }),
      "allowlist",
    );
  });

  it("buildInterruptOn omits edits; registers folder interrupt", () => {
    const on = buildInterruptOn({
      runMode: "auto-review",
      requirePlanApproval: true,
      desktopEnabled: true,
      extraGatedTools: ["mcp_tradingview_search"],
    });
    assert.equal(on.request_folder_access, true);
    assert.equal(on.task_todos, true);
    assert.equal(on.execute, true);
    assert.equal(on.edit_file, undefined);
    assert.equal(on.write_file, undefined);
    assert.equal(on.mcp_tradingview_search, true);
    assert.equal(on.desktop_automate, true);
  });

  it("run-everything only keeps folder (+ optional plan)", () => {
    const on = buildInterruptOn({
      runMode: "run-everything",
      requirePlanApproval: false,
    });
    assert.deepEqual(on, { request_folder_access: true });
  });

  it("matches allowlist by tool name and command prefix", () => {
    assert.equal(
      matchesToolAllowlist("execute", { command: "git status" }, ["git status"]),
      true,
    );
    assert.equal(
      matchesToolAllowlist("execute", { command: "rm -rf /" }, ["git status"]),
      false,
    );
    assert.equal(matchesToolAllowlist("web_search", {}, ["web_search"]), true);
    assert.equal(isRunModeGatedTool("execute"), true);
    assert.equal(isRunModeGatedTool("read_file"), false);
  });
});

describe("config-edit-guard", () => {
  it("flags env and secret paths", () => {
    assert.equal(isConfigSensitivePath(".env"), true);
    assert.equal(isConfigSensitivePath("src/.env.local"), true);
    assert.equal(isConfigSensitivePath("credentials.json"), true);
    assert.equal(isConfigSensitivePath(".agent/mcp.json"), true);
    assert.equal(isConfigSensitivePath("src/app.ts"), false);
  });
});

describe("tool-classifier", () => {
  it("parses JSON and keyword verdicts", () => {
    assert.equal(parseClassifierResponse('{"decision":"allow"}'), "allow");
    assert.equal(parseClassifierResponse("Verdict: deny this"), "deny");
    assert.equal(parseClassifierResponse("please ask the user"), "ask");
    assert.equal(parseClassifierResponse(""), "ask");
  });
});

describe("chat-mode", () => {
  it("ask/plan allowlists; agent/debug unrestricted", () => {
    assert.ok(chatModeToolAllowlist("ask")?.includes("read_file"));
    assert.ok(!chatModeToolAllowlist("ask")?.includes("execute"));
    assert.ok(chatModeToolAllowlist("plan")?.includes("task_todos"));
    assert.equal(chatModeToolAllowlist("plan", { planUnlocked: true }), null);
    assert.equal(chatModeToolAllowlist("agent"), null);
    assert.equal(parseAgentChatMode("debug"), "debug");
    assert.equal(parseAgentChatMode("nope"), "agent");
  });

  it("intersects allowlists", () => {
    assert.deepEqual(intersectAllowlists(["a", "b"], ["b", "c"]), ["b"]);
    assert.deepEqual(intersectAllowlists(null, ["a"]), ["a"]);
    assert.equal(intersectAllowlists(null, null), null);
  });
});

describe("skill-catalog", () => {
  it("lists descriptions and formats catalog block", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
    const skillDir = path.join(dir, "demo");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo capability\n---\n\n# Body\n",
      "utf8",
    );
    const list = listSkillDescriptions(dir);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.name, "demo-skill");
    const block = formatSkillCatalogBlock(list);
    assert.match(block, /Available skills/);
    assert.match(block, /demo-skill/);
    assert.match(block, /\/skills\/demo\/SKILL\.md/);
  });
});
