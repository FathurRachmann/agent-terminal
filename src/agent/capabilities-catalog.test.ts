import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  buildDisabledSkillPermissions,
  filterMcpServers,
  filterToolsByCapability,
  listCapabilities,
  resolveCapabilityFilter,
  setCapabilityEnabled,
} from "./capabilities-catalog.js";

describe("capabilities catalog", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("lists skills from .agent/skills and tools catalog", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    dirs.push(root);
    const skillDir = path.join(root, ".agent", "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo capability skill\n---\n\n# Demo\n",
      "utf8",
    );

    const caps = listCapabilities({ workspaceRoot: root, desktopEnabled: false });
    assert.ok(caps.skills.some((s) => s.name === "demo-skill"));
    assert.ok(caps.tools.some((t) => t.name === "execute"));
    assert.ok(caps.tools.some((t) => t.name === "delegate_task"));
    assert.equal(caps.mcp.length, 0);
    assert.ok(caps.counts.tools > 10);
  });

  it("persists enable/disable prefs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    dirs.push(root);
    setCapabilityEnabled(root, "tool:execute", false);
    const caps = listCapabilities({ workspaceRoot: root });
    const exec = caps.tools.find((t) => t.id === "tool:execute");
    assert.equal(exec?.enabled, false);
    setCapabilityEnabled(root, "tool:execute", true);
    const again = listCapabilities({ workspaceRoot: root });
    assert.equal(again.tools.find((t) => t.id === "tool:execute")?.enabled, true);
  });

  it("reads mcp servers from .agent/mcp.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, ".agent"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".agent", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          memory: { command: "npx", args: ["-y", "memory-server"], description: "Memory MCP" },
        },
      }),
      "utf8",
    );
    const caps = listCapabilities({ workspaceRoot: root });
    assert.equal(caps.mcp.length, 1);
    assert.equal(caps.mcp[0]?.name, "memory");
    assert.equal(caps.mcp[0]?.authStatus, "none");
    assert.equal(caps.mcp[0]?.badge, "configured");
  });

  it("marks url MCP servers as needing login until connected", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, ".agent"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".agent", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          notion: {
            url: "https://mcp.notion.com/mcp",
            description: "Notion MCP",
          },
        },
      }),
      "utf8",
    );
    const caps = listCapabilities({ workspaceRoot: root });
    assert.equal(caps.mcp[0]?.authStatus, "required");
    assert.equal(caps.mcp[0]?.badge, "needs login");
    assert.equal(caps.mcp[0]?.canOAuth, true);
    assert.equal(caps.mcp[0]?.canBearer, true);
  });

  it("resolves runtime filter and filters tools/mcp/skills", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));
    dirs.push(root);
    setCapabilityEnabled(root, "tool:web_search", false);
    setCapabilityEnabled(root, "skill:demo-skill", false);
    setCapabilityEnabled(root, "mcp:memory", false);

    const filter = resolveCapabilityFilter(root);
    assert.ok(filter.disabledToolNames.has("web_search"));
    assert.ok(filter.disabledSkillFolders.has("demo-skill"));
    assert.ok(filter.disabledMcpServers.has("memory"));

    const tools = filterToolsByCapability(
      [{ name: "web_search" }, { name: "execute" }],
      filter.disabledToolNames,
    );
    assert.deepEqual(
      tools.map((t) => t.name),
      ["execute"],
    );

    const perms = buildDisabledSkillPermissions(filter.disabledSkillFolders);
    assert.equal(perms.length, 1);
    assert.ok(perms[0]?.paths.includes("/skills/demo-skill/**"));

    const mcp = filterMcpServers(
      { memory: { command: "x" }, other: { command: "y" } },
      filter.disabledMcpServers,
    );
    assert.deepEqual(Object.keys(mcp), ["other"]);
  });
});
