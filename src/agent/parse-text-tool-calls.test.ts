import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage } from "@langchain/core/messages";
import {
  contentLooksLikeTextToolCall,
  parseTextToolCalls,
} from "./parse-text-tool-calls.js";
import { promoteTextToolCalls } from "./normalize-middleware.js";

describe("parseTextToolCalls", () => {
  it("parses array-of-tools JSON from 9router-style content", () => {
    const raw =
      '[{"name": "memory_recall", "arguments": {"kind": "fact", "limit": "10", "query": "arsitektur memory"}}]';
    const calls = parseTextToolCalls(raw);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "memory_recall");
    assert.equal(calls[0]?.args.query, "arsitektur memory");
    assert.equal(calls[0]?.args.limit, 10); // coerced from string
    assert.equal(calls[0]?.args.kind, "fact");
  });

  it("parses single tool object", () => {
    const calls = parseTextToolCalls(
      '{"name":"remember_rule","args":{"rule":"Pin langsmith ^0.9"}}',
    );
    assert.equal(calls[0]?.name, "remember_rule");
  });

  it("returns empty for normal prose", () => {
    assert.equal(parseTextToolCalls("Memory has two layers.").length, 0);
    assert.equal(contentLooksLikeTextToolCall("hello"), false);
  });
});

describe("promoteTextToolCalls", () => {
  it("lifts JSON content into native tool_calls", () => {
    const msg = new AIMessage({
      content:
        '[{"name":"memory_recall","arguments":{"query":"memory architecture"}}]',
    });
    const promoted = promoteTextToolCalls(msg);
    assert.ok(AIMessage.isInstance(promoted));
    assert.equal(promoted.tool_calls?.length, 1);
    assert.equal(promoted.tool_calls?.[0]?.name, "memory_recall");
    assert.equal(promoted.content, "");
  });

  it("leaves existing tool_calls alone", () => {
    const msg = new AIMessage({
      content: "calling",
      tool_calls: [
        {
          name: "execute",
          args: { command: "ls" },
          id: "x",
          type: "tool_call",
        },
      ],
    });
    const out = promoteTextToolCalls(msg);
    assert.equal(out, msg);
  });
});
