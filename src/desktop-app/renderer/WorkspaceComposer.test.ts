import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segmentMentions } from "./WorkspaceComposer.js";

const BOTS = [
  { id: "cto", name: "CTO", role: "CTO" },
  { id: "pm", name: "PM", role: "Product Manager" },
];

describe("segmentMentions", () => {
  it("chips known @handles and leaves other text", () => {
    const parts = segmentMentions("halo @cto cek dong", BOTS);
    assert.deepEqual(parts, [
      { type: "text", value: "halo " },
      { type: "mention", value: "@cto" },
      { type: "text", value: " cek dong" },
    ]);
  });

  it("ignores unknown @tokens", () => {
    const parts = segmentMentions("ping @nobody", BOTS);
    assert.deepEqual(parts, [{ type: "text", value: "ping @nobody" }]);
  });
});
