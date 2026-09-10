import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDesktopIntent,
  extractDesktopFollowUp,
  enrichDesktopIntent,
  isPlayMusicFollowUp,
} from "./intent.js";

describe("parseDesktopIntent", () => {
  it("parses Indonesian open URL in Chrome", () => {
    const intent = parseDesktopIntent("buka https://example.com di Chrome");
    assert.ok(intent);
    assert.equal(intent!.kind, "open_url");
    if (intent!.kind === "open_url") {
      assert.match(intent.url, /^https:\/\/example\.com\/?$/);
      assert.equal(intent.app, "Google Chrome");
    }
  });

  it("parses English open URL", () => {
    const intent = parseDesktopIntent("open https://example.com in chrome");
    assert.ok(intent);
    assert.equal(intent!.kind, "open_url");
  });

  it("parses open Chrome without URL", () => {
    const intent = parseDesktopIntent("buka Google Chrome");
    assert.ok(intent);
    assert.equal(intent!.kind, "open_app");
  });

  it("ignores unrelated prompts", () => {
    assert.equal(parseDesktopIntent("fix the build"), null);
    assert.equal(parseDesktopIntent("apa itu chrome extension"), null);
  });

  it("extracts follow-up after opening YouTube", () => {
    const prompt =
      "buka https://www.youtube.com/ dan setel lagu apapun yg lagi viral saat ini";
    const intent = parseDesktopIntent(prompt);
    assert.ok(intent);
    const follow = extractDesktopFollowUp(prompt, intent!);
    assert.ok(follow);
    assert.match(follow!, /lagu|viral/i);
    assert.equal(isPlayMusicFollowUp(follow), true);
  });

  it("parses bare YouTube name without URL", () => {
    const prompt = "buka YouTube dan setel lagu viral";
    const intent = parseDesktopIntent(prompt);
    assert.ok(intent);
    assert.equal(intent!.kind, "open_url");
    if (intent!.kind === "open_url") {
      assert.match(intent.url, /youtube\.com/i);
    }
    const follow = extractDesktopFollowUp(prompt, intent!);
    assert.ok(follow);
    assert.match(follow!, /lagu|viral/i);
    const enriched = enrichDesktopIntent(intent!, prompt);
    assert.equal(enriched.kind, "open_url");
    if (enriched.kind === "open_url") {
      assert.match(enriched.url, /results\?search_query=/);
    }
  });

  it("buka whatsapp has no leftover follow-up", () => {
    const prompt = "buka whatsapp";
    const intent = parseDesktopIntent(prompt);
    assert.ok(intent);
    assert.equal(intent!.kind, "open_url");
    if (intent!.kind === "open_url") {
      assert.match(intent.url, /whatsapp/i);
    }
    assert.equal(extractDesktopFollowUp(prompt, intent!), null);
  });
});
