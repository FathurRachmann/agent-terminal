import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolMessage } from "@langchain/core/messages";
import {
  BOT_SCOPE_ALWAYS_TOOLS,
  buildBotScopeInstruction,
  createBotScopeController,
  filterToolsByBotAllowlist,
  rejectBotScopedToolCall,
  withBotScopeAlwaysTools,
} from "./bot-scope-middleware.js";

describe("buildBotScopeInstruction", () => {
  it("includes specialty, allowlist, and refuse guidance", () => {
    const text = buildBotScopeInstruction({
      name: "Web Scraper Bot",
      description: "scrape only",
      systemPrompt: "Use browser tools only.",
      tools: ["browser_open", "write_file"],
    });
    assert.match(text, /Web Scraper Bot/);
    assert.match(text, /browser_open/);
    assert.match(text, /write_file/);
    assert.match(text, /request_folder_access/);
    assert.match(text, /Refuse requests outside this specialty/i);
    assert.match(text, /Use browser tools only/);
  });
});

describe("bot allowlist enforcement", () => {
  const tools = [
    { name: "browser_open" },
    { name: "execute" },
    { name: "write_file" },
    { name: "request_folder_access" },
    { name: "show_allowed_folders" },
    { name: "" },
    {},
  ];

  it("passes all tools through when allowlist is null (general)", () => {
    const filtered = filterToolsByBotAllowlist(tools, null);
    assert.equal(filtered?.length, tools.length);
  });

  it("keeps allowlisted tools plus folder-access always-tools", () => {
    const filtered = filterToolsByBotAllowlist(tools, [
      "browser_open",
      "write_file",
    ]);
    assert.deepEqual(
      filtered?.map((t) => ("name" in t ? t.name : undefined)).sort(),
      [
        "browser_open",
        "request_folder_access",
        "show_allowed_folders",
        "write_file",
      ].sort(),
    );
  });

  it("drops nameless tools under a specialized allowlist", () => {
    const filtered = filterToolsByBotAllowlist(
      [{ name: "browser_open" }, { name: "" }, {}],
      ["browser_open"],
    );
    assert.equal(filtered?.length, 1);
  });

  it("rejects out-of-scope tool calls", () => {
    const msg = rejectBotScopedToolCall(
      { name: "execute", id: "call-1" },
      ["browser_open"],
    );
    assert.ok(msg instanceof ToolMessage);
    assert.match(String(msg.content), /not available in this bot session/);
    assert.equal(msg.status, "error");
  });

  it("allows folder access even when not in specialty list", () => {
    assert.equal(
      rejectBotScopedToolCall(
        { name: "request_folder_access", id: "call-f" },
        ["browser_open"],
      ),
      null,
    );
  });

  it("allows in-scope tool calls", () => {
    const msg = rejectBotScopedToolCall(
      { name: "browser_open", id: "call-2" },
      ["browser_open"],
    );
    assert.equal(msg, null);
  });

  it("controller merges always-tools into allowlist", () => {
    const ctrl = createBotScopeController();
    assert.equal(ctrl.getAllowedTools(), null);
    ctrl.setAllowedTools(["browser_open"]);
    assert.deepEqual(
      ctrl.getAllowedTools()?.sort(),
      withBotScopeAlwaysTools(["browser_open"])!.sort(),
    );
    assert.ok(
      BOT_SCOPE_ALWAYS_TOOLS.every((t) =>
        ctrl.getAllowedTools()!.includes(t),
      ),
    );
    ctrl.setAllowedTools(null);
    assert.equal(ctrl.getAllowedTools(), null);
  });
});
