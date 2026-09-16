import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  decodeAgentPreviewUrl,
  encodeAgentPreviewUrl,
  formatBytes,
} from "./preview-protocol.js";

describe("preview-protocol", () => {
  it("round-trips absolute paths", () => {
    const abs = path.resolve("/tmp/working/guide.pdf");
    const url = encodeAgentPreviewUrl(abs);
    assert.match(url, /^agent-preview:\/\/local\//);
    assert.equal(decodeAgentPreviewUrl(url), abs);
  });

  it("formats byte sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.match(formatBytes(2048), /KB/);
    assert.match(formatBytes(5 * 1024 * 1024), /MB/);
  });
});
