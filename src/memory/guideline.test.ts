import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deterministicGuideline,
  normalizeGuideline,
  shouldAttemptLlmRule,
} from "./guideline.js";

describe("normalizeGuideline", () => {
  it("accepts standard WHEN → DO", () => {
    const g = normalizeGuideline(
      "WHEN embeddings fail → DO switch EMBEDDING_MODEL to a working provider",
    );
    assert.ok(g);
    assert.match(g!.text, /^WHEN .+ → DO .+/);
  });

  it("accepts WHEN: | DO: pipe form", () => {
    const g = normalizeGuideline(
      "WHEN: path is outside allowlist | DO: call request_folder_access",
    );
    assert.ok(g);
    assert.equal(
      g!.text,
      "WHEN path is outside allowlist → DO call request_folder_access",
    );
  });

  it("wraps clear imperatives", () => {
    const g = normalizeGuideline("Never store API keys in memory");
    assert.ok(g);
    assert.match(g!.text, /→ DO Never store API keys in memory$/i);
  });

  it("rejects decline-permissions / cannot-open-chrome junk", () => {
    assert.equal(
      normalizeGuideline(
        "WHEN this situation recurs → DO Decline requests that require exceeding system permissions and propose compliant alternatives",
      ),
      null,
    );
    assert.equal(
      normalizeGuideline(
        "WHEN asked to open chrome → DO ask them to paste the link manually",
      ),
      null,
    );
  });

  it("rejects CoT and architecture essays", () => {
    assert.equal(
      normalizeGuideline("Okay, let's tackle this. The user wants…"),
      null,
    );
    assert.equal(
      normalizeGuideline("Arsitektur sistem ini terdiri dari 2 layer utama:"),
      null,
    );
    assert.equal(normalizeGuideline("NONE"), null);
    assert.equal(normalizeGuideline("[0.0:] First rule is always YAGNI,"), null);
  });
});

describe("deterministicGuideline", () => {
  it("emits folder-access rule", () => {
    const g = deterministicGuideline({
      userPrompt: "buka folder saya",
      assistantResponse: "Workspace confinement blocked; call request_folder_access",
    });
    assert.ok(g);
    assert.match(g!.text, /request_folder_access/);
  });
});

describe("shouldAttemptLlmRule", () => {
  it("skips summarization Q&A", () => {
    assert.equal(
      shouldAttemptLlmRule({
        userPrompt: "ringkas arsitektur memory",
        assistantResponse: "ada 2 layer",
      }),
      false,
    );
  });

  it("allows errors", () => {
    assert.equal(
      shouldAttemptLlmRule({
        hadError: true,
        userPrompt: "fix build",
        assistantResponse: "failed",
      }),
      true,
    );
  });
});
