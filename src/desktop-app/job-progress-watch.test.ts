import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractWritePath,
  isProgressStatusPath,
  looksLikeProgressDone,
  parseProgressFraction,
} from "./job-progress-watch.js";

describe("job-progress-watch helpers", () => {
  it("detects status/progress file paths", () => {
    assert.equal(
      isProgressStatusPath("tmp/bots/transcription_status.txt"),
      true,
    );
    assert.equal(isProgressStatusPath("reports/progress.log"), true);
    assert.equal(isProgressStatusPath("src/main.ts"), false);
  });

  it("parses fraction and done signals", () => {
    assert.equal(
      parseProgressFraction("Transcribing chunk 16/37 (75m - 80m)"),
      16 / 37,
    );
    assert.equal(looksLikeProgressDone("Transcribing chunk 37/37"), true);
    assert.equal(looksLikeProgressDone("All chunks complete"), true);
    assert.equal(
      looksLikeProgressDone("Transcribing chunk 16/37 (75m - 80m)"),
      false,
    );
  });

  it("extracts write paths from tool input", () => {
    assert.equal(
      extractWritePath({ path: "tmp/bots/transcription_status.txt" }),
      "tmp/bots/transcription_status.txt",
    );
  });
});
