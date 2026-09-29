import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseContextMentions,
  buildMentionContextNudge,
} from "./context-mentions.js";
import {
  loadMergedPermissions,
  writeProjectPermissions,
  writeTeamPermissions,
  mcpToolAllowed,
} from "./permissions-store.js";
import { loadHooksConfig } from "./hooks/run-hooks.js";
describe("context-mentions", () => {
  it("parses file, terminals, commit, branch", () => {
    const m = parseContextMentions(
      "see @file:src/app.ts and @Terminals plus @Commit @Branch",
    );
    const kinds = m.map((x) => x.kind);
    assert.ok(kinds.includes("file"));
    assert.ok(kinds.includes("terminals"));
    assert.ok(kinds.includes("commit"));
    assert.ok(kinds.includes("branch"));
  });

  it("expands file mention from temp workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mention-"));
    fs.writeFileSync(path.join(dir, "hello.ts"), "export const x = 1;\n");
    const { nudge } = buildMentionContextNudge("look at @file:hello.ts", {
      workspaceRoot: dir,
    });
    assert.match(nudge, /ATTACHED CONTEXT/);
    assert.match(nudge, /export const x/);
  });
});

describe("permissions-store", () => {
  it("merges project permissions and team overrides", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perms-"));
    writeProjectPermissions(dir, {
      terminalAllowlist: ["git status"],
      autoRun: { allow_instructions: ["allow npm test"] },
    });
    const merged = loadMergedPermissions({ workspaceRoot: dir });
    assert.ok(merged.terminalAllowlist.includes("git status"));
    assert.ok(merged.allowInstructions.includes("allow npm test"));
    assert.equal(merged.teamOverride, false);

    writeTeamPermissions(dir, {
      terminalAllowlist: ["team-only"],
      autoRun: { block_instructions: ["block curl"] },
    });
    const team = loadMergedPermissions({ workspaceRoot: dir });
    assert.equal(team.teamOverride, true);
    assert.deepEqual(team.terminalAllowlist, ["team-only"]);
    assert.ok(team.blockInstructions.includes("block curl"));
  });

  it("matches mcp allowlist patterns", () => {
    assert.equal(mcpToolAllowed("mcp_tv_search", ["tv:*"]), true);
    assert.equal(mcpToolAllowed("mcp_tv_search", ["other:*"]), false);
    assert.equal(mcpToolAllowed("mcp_tv_search", ["*:*"]), true);
  });
});

describe("hooks config", () => {
  it("loads project hooks.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-"));
    fs.mkdirSync(path.join(dir, ".agent"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".agent", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "echo '{}'", timeout: 5 }],
        },
      }),
      "utf8",
    );
    const cfg = loadHooksConfig({ workspaceRoot: dir });
    assert.equal(cfg.hooks?.beforeSubmitPrompt?.length, 1);
  });
});
