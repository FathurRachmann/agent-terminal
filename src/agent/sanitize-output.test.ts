import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isJunkGuideline,
  looksLikeIncompleteReasoning,
  stripThinkBlocks,
} from "./sanitize-output.js";

describe("sanitize-output", () => {
  it("strips closed think blocks", () => {
    const out = stripThinkBlocks("<think>secret</think>\nAnswer here");
    assert.equal(out, "Answer here");
  });

  it("drops unclosed think when no answer follows", () => {
    const out = stripThinkBlocks("<think>\nbad");
    assert.equal(out, "");
  });

  it("rejects junk guidelines", () => {
    assert.equal(isJunkGuideline("<think>"), true);
    assert.equal(isJunkGuideline("NONE"), true);
    assert.equal(
      isJunkGuideline(
        "WHEN langsmith export fails → DO pin langsmith to ^0.9.0",
      ),
      false,
    );
    assert.equal(
      isJunkGuideline("Okay, let's extract a guideline from the user task"),
      true,
    );
  });

  it("detects incomplete CoT answers", () => {
    const bad =
      "Okay, let's break down the problem step by step. The user asked about memory. However,";
    assert.equal(looksLikeIncompleteReasoning(bad), true);
    const good =
      "## Persistent\n- `.agent/session.json`\n## Long-term\n- hybrid RAG via embeddings";
    assert.equal(looksLikeIncompleteReasoning(good), false);
  });
});
