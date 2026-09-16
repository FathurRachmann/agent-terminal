import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBytes,
  isLongPasteText,
  LONG_PASTE_THRESHOLD,
  pastedContentLabel,
  pastedImageFileName,
  pastedTextFileName,
  truncateMiddle,
  truncatePath,
} from "./composer-attachments.js";

describe("composer-attachments", () => {
  it("treats text longer than 500 chars as paste attachment", () => {
    assert.equal(isLongPasteText("a".repeat(LONG_PASTE_THRESHOLD)), false);
    assert.equal(isLongPasteText("a".repeat(LONG_PASTE_THRESHOLD + 1)), true);
    assert.equal(isLongPasteText("short"), false);
  });

  it("formats pasted content label with size", () => {
    assert.equal(pastedContentLabel(8700), "Pasted content (8.5 KB)");
    assert.equal(formatBytes(500), "500 B");
  });

  it("builds deterministic-ish paste filenames", () => {
    const when = new Date("2026-09-15T15:22:28.099Z");
    assert.match(pastedTextFileName(when), /^pasted_content_.*\.txt$/);
    assert.match(pastedImageFileName("image/png", when), /^Screenshot_.*\.png$/);
    assert.match(pastedImageFileName("image/jpeg", when), /\.jpg$/);
  });

  it("truncates display strings", () => {
    assert.equal(truncateMiddle("abcdef", 10), "abcdef");
    assert.ok(truncateMiddle("Screenshot_2026-09-14_at_long_name.png", 20).includes("…"));
    assert.ok(truncatePath("/Users/fathur/Library/Application Support/x.png", 20).startsWith("…"));
  });
});
