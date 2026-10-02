import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sectionDefaultOpen,
  splitMarkdownByH2,
} from "./md-sections.js";

describe("splitMarkdownByH2", () => {
  it("returns single prose chunk when no h2", () => {
    const chunks = splitMarkdownByH2("Hello\n\nWorld");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.type, "prose");
  });

  it("splits intro + Files to Touch + Patch Outline", () => {
    const md = [
      "Berikut berkas yang akan diubah.",
      "",
      "---",
      "",
      "## Files to Touch",
      "",
      "1. `frontend/app.vue`",
      "",
      "---",
      "",
      "## Patch Outline",
      "",
      "1. Header fix",
      "   - Ganti padding `px-6`",
      "2. Modal escape",
    ].join("\n");
    const chunks = splitMarkdownByH2(md);
    assert.equal(chunks[0]!.type, "prose");
    assert.match((chunks[0] as { markdown: string }).markdown, /Berkas/i);
    assert.equal(chunks[1]!.type, "section");
    assert.equal((chunks[1] as { title: string }).title, "Files to Touch");
    assert.match(
      (chunks[1] as { markdown: string }).markdown,
      /frontend\/app\.vue/,
    );
    assert.equal(chunks[2]!.type, "section");
    assert.equal((chunks[2] as { title: string }).title, "Patch Outline");
    assert.ok((chunks[2] as { lineCount: number }).lineCount >= 3);
  });

  it("also splits bold titles and known plain section names", () => {
    const md = [
      "Intro.",
      "",
      "---",
      "",
      "**Files to Touch**",
      "",
      "1. `a.ts`",
      "",
      "---",
      "",
      "Patch Outline",
      "",
      "1. Fix header",
      "2. Fix modal",
      "3. Tests",
      "4. Verify",
    ].join("\n");
    const chunks = splitMarkdownByH2(md);
    assert.equal(chunks.filter((c) => c.type === "section").length, 2);
    assert.equal((chunks[1] as { title: string }).title, "Files to Touch");
    assert.equal((chunks[2] as { title: string }).title, "Patch Outline");
  });
});

describe("sectionDefaultOpen", () => {
  it("opens short sections; collapses long ones unless streaming", () => {
    assert.equal(sectionDefaultOpen(2), true);
    assert.equal(sectionDefaultOpen(8), false);
    assert.equal(sectionDefaultOpen(8, { streaming: true }), true);
  });
});
