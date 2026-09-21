import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recoverMermaidCodeFence,
  repairMermaidMarkdown,
} from "./mermaid-markdown-repair.js";

describe("repairMermaidMarkdown", () => {
  it("splits glued ```mermaidsequenceDiagram fence", () => {
    const raw = "```mermaidsequenceDiagram\n  A->>B: hi\n```";
    const out = repairMermaidMarkdown(raw);
    assert.match(out, /```mermaid\nsequenceDiagram/);
    assert.doesNotMatch(out, /mermaidsequenceDiagram/);
  });

  it("wraps bare mermaidsequenceDiagram prose", () => {
    const raw =
      "mermaidsequenceDiagram\n    actor User\n    User->>API: login\n\nFile tersimpan di working/bots/x.mmd";
    const out = repairMermaidMarkdown(raw);
    assert.match(out, /```mermaid\nsequenceDiagram/);
    assert.match(out, /```\nFile tersimpan/);
  });

  it("keeps valid fences unchanged", () => {
    const raw = "```mermaid\nsequenceDiagram\n  A->>B: hi\n```";
    assert.equal(repairMermaidMarkdown(raw).trim(), raw.trim());
  });
});

describe("recoverMermaidCodeFence", () => {
  it("recovers language mermaidsequenceDiagram", () => {
    const got = recoverMermaidCodeFence(
      "mermaidsequenceDiagram",
      "    actor User\n    User->>API: hi",
    );
    assert.ok(got);
    assert.equal(got!.language, "mermaid");
    assert.match(got!.code, /^sequenceDiagram\n/);
  });
});
