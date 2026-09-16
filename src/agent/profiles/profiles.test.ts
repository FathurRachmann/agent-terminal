import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  PROFILE_ID_RE,
  isValidProfileId,
  composeSystemPrompt,
  createProfile,
  loadRegistry,
  migrateWorkspaceAgentToProfiles,
  readSoul,
  setActiveProfile,
  writeSoul,
} from "./index.js";
import { LocalGatewayController } from "../gateway/local.js";

describe("profile id validation", () => {
  it("accepts hermes-style ids", () => {
    assert.equal(isValidProfileId("default"), true);
    assert.equal(isValidProfileId("my-profile"), true);
    assert.equal(isValidProfileId("p_1"), true);
    assert.equal(PROFILE_ID_RE.test("My-Profile"), false);
    assert.equal(isValidProfileId("-bad"), false);
    assert.equal(isValidProfileId(""), false);
  });
});

describe("composeSystemPrompt", () => {
  it("returns base when soul empty", () => {
    assert.equal(composeSystemPrompt("BASE", "  "), "BASE");
  });
  it("prepends soul", () => {
    const out = composeSystemPrompt("BASE", "SOUL");
    assert.match(out, /^SOUL/);
    assert.match(out, /BASE$/);
  });
});

describe("migrate + profiles", () => {
  let tmp: string;
  let workspace: string;
  let machine: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-profiles-"));
    workspace = path.join(tmp, "ws");
    machine = path.join(tmp, "machine");
    fs.mkdirSync(path.join(workspace, ".agent", "skills", "demo"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspace, ".agent", "AGENTS.md"),
      "# Agent Memory\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspace, ".agent", "bots.json"),
      "[]\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(workspace, ".agent", "skills", "demo", "SKILL.md"),
      "# Demo\n",
      "utf8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("migrates workspace .agent into default profile once", () => {
    const first = migrateWorkspaceAgentToProfiles(workspace, machine);
    assert.equal(first.migrated, true);
    assert.equal(first.profileId, "default");
    assert.ok(
      fs.existsSync(path.join(first.home, ".agent", "AGENTS.md")),
    );
    assert.ok(fs.existsSync(path.join(first.home, "SOUL.md")));
    assert.ok(readSoul(first.home).trim().length > 0);

    const second = migrateWorkspaceAgentToProfiles(workspace, machine);
    assert.equal(second.migrated, false);
    assert.equal(loadRegistry(machine).profiles.length, 1);
  });

  it("clones profile without copying session transcripts", () => {
    migrateWorkspaceAgentToProfiles(workspace, machine);
    const defaultHome = path.join(machine, "profiles", "default");
    fs.mkdirSync(path.join(defaultHome, ".agent", "memory", "sessions"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(defaultHome, ".agent", "memory", "sessions", "t1.jsonl"),
      "{}\n",
      "utf8",
    );
    writeSoul(defaultHome, "Soul A\n");

    const created = createProfile(
      { id: "work", cloneFrom: "default", soul: "Soul B\n" },
      machine,
    );
    assert.equal(created.id, "work");
    assert.equal(readSoul(created.home).trim(), "Soul B");
    assert.ok(
      fs.existsSync(path.join(created.home, ".agent", "skills", "demo", "SKILL.md")),
    );
    assert.equal(
      fs.existsSync(
        path.join(created.home, ".agent", "memory", "sessions", "t1.jsonl"),
      ),
      false,
    );
  });

  it("ignores path-traversal cloneFrom and clones default", () => {
    migrateWorkspaceAgentToProfiles(workspace, machine);
    const created = createProfile(
      { id: "safe", cloneFrom: "../../../tmp" },
      machine,
    );
    assert.ok(created.home.endsWith(`${path.sep}profiles${path.sep}safe`));
    assert.equal(created.home.includes(".."), false);
  });

  it("switch active profile updates registry", () => {
    migrateWorkspaceAgentToProfiles(workspace, machine);
    createProfile({ id: "alt", cloneFrom: "default" }, machine);
    const reg = setActiveProfile("alt", machine);
    assert.equal(reg.activeProfileId, "alt");
  });
});

describe("LocalGatewayController", () => {
  it("transitions starting → ready", () => {
    const gw = new LocalGatewayController();
    gw.markStarting({
      profileId: "default",
      profileHome: "/tmp/p",
      workspaceRoot: "/tmp/w",
    });
    assert.equal(gw.getStatus().phase, "starting");
    assert.equal(gw.test().ok, false);
    gw.markReady();
    const st = gw.getStatus();
    assert.equal(st.phase, "ready");
    assert.equal(st.label, "Gateway ready");
    assert.equal(st.inferenceReady, true);
    assert.equal(gw.test().ok, true);
  });
});
