import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_WINDOW_TOKENS,
  SUMMARIZE_TRIGGER_TOKENS,
  KEEP_RECENT_TOKENS,
  SUMMARIZE_TRIGGER_RATIO,
  KEEP_RECENT_RATIO,
  describeContextPolicy,
} from "./context-policy.js";
import { compactToolOutput } from "./tool-result-compact-middleware.js";

describe("context-policy (aggressive defaults)", () => {
  it("defaults to a smaller window than 256k with earlier summarize", () => {
    // Env may override in CI — assert ratios are sane and trigger < window.
    assert.ok(CONTEXT_WINDOW_TOKENS >= 8_000);
    assert.ok(SUMMARIZE_TRIGGER_RATIO <= 0.7);
    assert.ok(KEEP_RECENT_RATIO <= 0.2);
    assert.ok(SUMMARIZE_TRIGGER_TOKENS < CONTEXT_WINDOW_TOKENS);
    assert.ok(KEEP_RECENT_TOKENS < SUMMARIZE_TRIGGER_TOKENS);
    assert.match(describeContextPolicy(), /summarize_trigger=/);
  });
});

describe("tool-result compact", () => {
  it("compacts oversized output and keeps signals", () => {
    const big =
      "line0\n" +
      Array.from({ length: 200 }, (_, i) => `body ${i}`).join("\n") +
      "\nError: boom at src/x.ts:12\n" +
      Array.from({ length: 50 }, (_, i) => `tail ${i}`).join("\n");
    const { text, compacted } = compactToolOutput(big, { maxChars: 1500 });
    assert.equal(compacted, true);
    assert.ok(text.length <= 1600);
    assert.match(text, /omitted/);
    assert.match(text, /Error: boom/);
  });

  it("dedupes identical search queries across turns", async () => {
    const mw = (await import("./tool-result-compact-middleware.js")).createToolResultCompactMiddleware();
    const req = {
      toolCall: { name: "grep", args: { query: "select-none", path: "src" }, id: "c1" },
    };
    const handler = async () => ({ content: "0 matches found", tool_call_id: "c1", name: "grep" });
    
    // First run -> executes handler
    const res1 = await mw.wrapToolCall(req, handler);
    assert.match(String(res1.content), /0 matches found/);

    // Second identical run -> immediately intercepted
    const res2 = await mw.wrapToolCall(req, handler);
    assert.match(String(res2.content), /\[DEDUPED SEARCH\]/);
  });
});
