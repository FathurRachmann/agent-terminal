import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isJunkGuideline,
  looksLikeIncompleteReasoning,
  looksLikeProviderNotice,
  looksLikeResponsePlanning,
  looksLikeToolPlanNarration,
  resolveFinalAssistantText,
  salvageUserFacingAnswer,
  shouldRenderAsReasoning,
  stripThinkBlocks,
  extractSuggestedModel,
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

  it("flags English tool-plan narration as incomplete", () => {
    const narrate =
      "First, I should start by exploring the project structure. I remember that the project root is set to /tmp/app. I can use the ls command to list the contents of this directory. Next I should check if there's a README.md.";
    assert.equal(looksLikeToolPlanNarration(narrate), true);
    assert.equal(looksLikeIncompleteReasoning(narrate), true);
    const answered =
      "Ya, bisa. Saya sudah `ls` di root project — ada `src/`, `package.json`, dan `README.md` (Next.js).";
    assert.equal(looksLikeToolPlanNarration(answered), false);

    const availableTools =
      "I need to use the available tools to thoroughly check the project for potential bugs. First, I should start by listing the contents of the project root using `ls` to see the structure.";
    assert.equal(looksLikeToolPlanNarration(availableTools), true);

    const lintPlan =
      "I need to use tools like `tslint` (if it's TypeScript) or `eslint` to find common issues such as unused variables.";
    assert.equal(looksLikeToolPlanNarration(lintPlan), true);

    const metaRemember =
      "I need to remember to keep my response concise and in Indonesian, avoiding any lengthy explanations or planning statements. My goal is to provide a clear and useful answer based on the tool outputs.";
    assert.equal(looksLikeResponsePlanning(metaRemember), true);
    assert.equal(looksLikeIncompleteReasoning(metaRemember), true);
  });

  it("detects greeting response-planning monologues", () => {
    const leak = `First, the user greeted me with "halooo," which is a casual way of saying hello in Indonesian. My response should be friendly and approachable. I shouldn't be too formal. Something like "Hello! How can I help you today?" or "Hi there! What's up?" would work. Since the user is speaking Indonesian casually, I could respond in Indonesian. "Halo! Ada yang bisa saya bantu?" would be perfect. But looking back, the guidelines don't specify language preference. I'll go with a friendly English response for now, but make sure it's concise. The response should be straightforward.`;
    assert.equal(looksLikeResponsePlanning(leak), true);
    assert.equal(looksLikeIncompleteReasoning(leak), true);
    assert.equal(
      salvageUserFacingAnswer(leak),
      "Halo! Ada yang bisa saya bantu?",
    );
    // Salvage wins → not rendered as reasoning bubble
    assert.equal(shouldRenderAsReasoning(leak), false);
    assert.equal(
      resolveFinalAssistantText(leak, ""),
      "Halo! Ada yang bisa saya bantu?",
    );
  });

  it("treats provider sunset notices as reasoning-style", () => {
    const notice =
      "Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash in the latest version of Antigravity.";
    assert.equal(looksLikeProviderNotice(notice), true);
    assert.equal(shouldRenderAsReasoning(notice), true);
    assert.equal(shouldRenderAsReasoning("Folder created successfully."), false);
    assert.equal(extractSuggestedModel(notice), "Gemini 3.7 Flash");
  });

  it("keeps longer streamed draft when done payload is shorter", () => {
    const draft =
      "1. First point\n2. **Logic error**: variable might be unset in edge cases.\n3. Done.";
    const done = "1. First point\n2. **Logic error**: variable might be unset in edge";
    assert.equal(resolveFinalAssistantText(done, draft), draft);
  });

  it("prefers complete done answer over incomplete CoT draft", () => {
    const draft =
      "Okay, let's break down the problem step by step. The user asked about memory. However,";
    const done = "Memory uses SQLite under `.agent/memory`.";
    assert.equal(resolveFinalAssistantText(done, draft), done);
  });

  it("drops truncated tool-call JSON so it never becomes the chat bubble", () => {
    const dump = `[{"name":"task_plan","arguments":{"goal":"x"}},{"name":"execute","arguments":{"command":"ls"}},{"name":`;
    assert.equal(resolveFinalAssistantText(dump, dump), "");
    assert.equal(resolveFinalAssistantText("", dump), "");
  });
});
