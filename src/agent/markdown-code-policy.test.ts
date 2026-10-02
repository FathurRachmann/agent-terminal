import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachFencePaths,
  shouldRenderFenceAsDiff,
  isDiagramLanguage,
} from "../desktop-app/renderer/markdown-code-policy.js";
import { diffLinesFromSides } from "../desktop-app/renderer/tool-diff.js";

describe("markdown-code-policy", () => {
  it("treats mermaid as diagram, ts as coding diff", () => {
    assert.equal(isDiagramLanguage("mermaid"), true);
    assert.equal(shouldRenderFenceAsDiff("mermaid", "graph TD"), false);
    assert.equal(shouldRenderFenceAsDiff("typescript", "const x = 1"), true);
    assert.equal(shouldRenderFenceAsDiff("ts", "export default {}"), true);
  });

  it("attaches backtick path onto the next fence", () => {
    const md = [
      "## Proposed Patch",
      "",
      "`frontend/nuxt.config.ts`",
      "",
      "```ts",
      "export default defineNuxtConfig({})",
      "```",
    ].join("\n");
    const out = attachFencePaths(md);
    assert.match(out, /```ts frontend\/nuxt\.config\.ts/);
  });
});

describe("diffLinesFromSides", () => {
  it("highlights only changed lines for a small edit", () => {
    const before = "a\nb\nc\n";
    const after = "a\nB\nc\n";
    const lines = diffLinesFromSides(before, after);
    assert.ok(lines.some((l) => l.kind === "del" && l.text === "-b"));
    assert.ok(lines.some((l) => l.kind === "add" && l.text === "+B"));
    assert.ok(lines.some((l) => l.kind === "ctx" && l.text === " a"));
  });

  it("shows all green when before is empty", () => {
    const lines = diffLinesFromSides("", "one\ntwo\n");
    assert.ok(lines.every((l) => l.kind === "add"));
    assert.equal(lines.length, 2);
  });
});
