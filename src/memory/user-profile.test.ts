import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractUserPreferencesFromChat,
  normalizeUserPreference,
  shouldLearnUserStyle,
} from "./user-profile.js";

describe("user-profile", () => {
  it("normalizes USER prefers lines", () => {
    const p = normalizeUserPreference(
      "USER prefers short answers with Indonesian tone",
    );
    assert.ok(p);
    assert.equal(p!.kind, "prefers");
    assert.match(p!.text, /^USER prefers /);
  });

  it("rejects junk", () => {
    assert.equal(normalizeUserPreference("NONE"), null);
    assert.equal(normalizeUserPreference("Okay, let's do this"), null);
    assert.equal(
      normalizeUserPreference("WHEN x → DO y"),
      null,
    );
  });

  it("extracts Indonesian conversational style", () => {
    const prefs = extractUserPreferencesFromChat(
      "tolong bantu yang ini dong biar lebih rapi",
    );
    assert.ok(prefs.some((p) => /Indonesian/i.test(p.text)));
    assert.ok(prefs.some((p) => /clean readable formatting/i.test(p.text)));
  });

  it("learns style from ordinary chat by default", () => {
    assert.equal(
      shouldLearnUserStyle({ userPrompt: "halo dong" }),
      true,
    );
    assert.equal(
      shouldLearnUserStyle({ userPrompt: "x", skipEpisode: true }),
      false,
    );
  });
});
