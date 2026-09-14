import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  botThreadId,
  isBotThreadId,
  isSpecializedBot,
  parseBotIdFromThread,
  type BotDefinition,
} from "./bot-manager.js";

describe("bot session helpers", () => {
  it("builds stable bot thread ids", () => {
    assert.equal(botThreadId("web-scraper"), "bot-web-scraper");
    assert.equal(botThreadId("coder"), "bot-coder");
  });

  it("detects bot threads and parses bot id", () => {
    assert.equal(isBotThreadId("bot-web-scraper"), true);
    assert.equal(isBotThreadId("desktop-123"), false);
    assert.equal(parseBotIdFromThread("bot-web-scraper"), "web-scraper");
    assert.equal(parseBotIdFromThread("desktop-123"), null);
  });

  it("marks specialized bots by tools allowlist", () => {
    const general: BotDefinition = {
      id: "general",
      name: "General",
      description: "all",
    };
    const scraper: BotDefinition = {
      id: "web-scraper",
      name: "Scraper",
      description: "scrape",
      tools: ["browser_open"],
    };
    assert.equal(isSpecializedBot(general), false);
    assert.equal(isSpecializedBot(scraper), true);
  });
});
