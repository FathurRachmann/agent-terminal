import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChatSegments,
  summarizeTraceGroup,
  type AgentUiEvent,
} from "./ActivityChips.js";

function shellStart(cmd: string): AgentUiEvent {
  return {
    type: "tool_start",
    name: "execute",
    input: { command: cmd },
  };
}

describe("summarizeTraceGroup", () => {
  it("returns the single chip label for one event", () => {
    const summary = summarizeTraceGroup([shellStart('pdftotext "a.pdf"')]);
    assert.equal(summary.icon, "⌘");
    assert.match(summary.text, /^Ran pdftotext/);
  });

  it("collapses identical steps with a count", () => {
    const ev = shellStart('pdftotext "doc.pdf" -');
    const summary = summarizeTraceGroup([ev, ev, ev]);
    assert.equal(summary.icon, "⌘");
    assert.match(summary.text, /×3$/);
  });

  it("uses a generic step count for mixed tools", () => {
    const summary = summarizeTraceGroup([
      shellStart("ls"),
      {
        type: "tool_start",
        name: "read_file",
        input: { path: "src/app.ts" },
      },
    ]);
    assert.equal(summary.text, "2 steps");
  });
});

describe("buildChatSegments", () => {
  it("keeps the active turn's trailing traces live while loading", () => {
    const items = [
      { id: "u1", kind: "user" as const },
      {
        id: "t1",
        kind: "trace" as const,
        event: shellStart("ls"),
        at: "1",
      },
      {
        id: "t2",
        kind: "trace" as const,
        event: shellStart("pwd"),
        at: "2",
      },
    ];
    const segs = buildChatSegments(items, true);
    assert.equal(segs.length, 2);
    assert.equal(segs[0]!.type, "single");
    assert.equal(segs[1]!.type, "traces");
    if (segs[1]!.type === "traces") {
      assert.equal(segs[1].live, true);
      assert.equal(segs[1].items.length, 2);
    }
  });

  it("collapses finished traces after an assistant reply", () => {
    const items = [
      { id: "u1", kind: "user" as const },
      {
        id: "t1",
        kind: "trace" as const,
        event: shellStart("ls"),
        at: "1",
      },
      { id: "a1", kind: "assistant" as const },
    ];
    const segs = buildChatSegments(items, false);
    assert.equal(segs[1]!.type, "traces");
    if (segs[1]!.type === "traces") {
      assert.equal(segs[1].live, false);
    }
  });

  it("keeps prior-turn traces collapsed even while a later turn is loading", () => {
    const items = [
      { id: "u1", kind: "user" as const },
      {
        id: "t1",
        kind: "trace" as const,
        event: shellStart("ls"),
        at: "1",
      },
      { id: "a1", kind: "assistant" as const },
      { id: "u2", kind: "user" as const },
    ];
    const segs = buildChatSegments(items, true);
    assert.equal(segs[1]!.type, "traces");
    if (segs[1]!.type === "traces") {
      assert.equal(segs[1].live, false);
    }
  });
});
