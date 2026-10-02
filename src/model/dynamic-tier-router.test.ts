import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { DynamicTierRouter } from "./dynamic-tier-router.js";

describe("DynamicTierRouter classification heuristics", () => {
  const router = new DynamicTierRouter();

  it("classifies parameter sizes accurately", () => {
    assert.equal(router.classifyModel("llama-3.3-70b-instruct"), "high");
    assert.equal(router.classifyModel("deepseek-r1-distill-405b"), "high");
    assert.equal(router.classifyModel("meta-llama-8b-instruct"), "low");
    assert.equal(router.classifyModel("qwen-2.5-7b"), "low");
  });

  it("respects explicit capability overrides", () => {
    assert.equal(router.classifyModel("custom-model", { tier: "high" }), "high");
    assert.equal(router.classifyModel("custom-model", { fast: true }), "low");
  });

  it("classifies large context windows with reasoning flag", () => {
    assert.equal(router.classifyModel("custom-pro-model", {}, 128000), "high");
  });

  it("defaults unrecognized models to mid tier", () => {
    assert.equal(router.classifyModel("standard-model-v1"), "mid");
  });
});

describe("DynamicTierRouter In-Tier Failover & Graceful Degradation", () => {
  let router: DynamicTierRouter;

  beforeEach(() => {
    router = new DynamicTierRouter();
  });

  it("marks model failed with cooldown and recovers after expiration", async () => {
    router.markModelFailed("claude-3-7-sonnet", "rate limit", 20); // 20ms cooldown
    assert.equal(router.isModelHealthy("claude-3-7-sonnet"), false);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(router.isModelHealthy("claude-3-7-sonnet"), true);
  });

  it("performs in-tier fallback to the next available healthy model", async () => {
    router.setMockCache({
      low: ["gpt-4o-mini"],
      mid: ["gpt-4o"],
      high: ["claude-3-7-sonnet", "deepseek-r1", "o3-mini"],
    });

    // Normal plan resolution -> first high-tier model
    const m1 = await router.resolveModelForPhase("plan");
    assert.equal(m1, "claude-3-7-sonnet");

    // Primary fails -> in-tier fallback to 2nd high-tier model
    router.markModelFailed("claude-3-7-sonnet", "429 Quota Exceeded");
    const m2 = await router.resolveModelForPhase("plan");
    assert.equal(m2, "deepseek-r1");

    // 2nd fails -> in-tier fallback to 3rd high-tier model
    router.markModelFailed("deepseek-r1", "429 Quota Exceeded");
    const m3 = await router.resolveModelForPhase("plan");
    assert.equal(m3, "o3-mini");
  });

  it("performs graceful cross-tier degradation when all tier models fail", async () => {
    router.setMockCache({
      low: ["gpt-4o-mini"],
      mid: ["gpt-4o"],
      high: ["claude-3-7-sonnet", "deepseek-r1"],
    });

    router.markModelFailed("claude-3-7-sonnet", "quota");
    router.markModelFailed("deepseek-r1", "quota");

    // All high-tier models failed -> degrades to mid-tier (gpt-4o)
    const degraded = await router.resolveModelForPhase("plan");
    assert.equal(degraded, "gpt-4o");

    // Mid-tier also fails -> degrades to low-tier (gpt-4o-mini)
    router.markModelFailed("gpt-4o", "quota");
    const lowest = await router.resolveModelForPhase("plan");
    assert.equal(lowest, "gpt-4o-mini");
  });
});
