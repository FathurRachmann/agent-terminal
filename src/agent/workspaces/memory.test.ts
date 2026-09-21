import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  memoryMatchesScope,
  memoryTagsForScope,
} from "./index.js";

describe("workspace memory scope tags", () => {
  it("builds workspace and bot tags", () => {
    assert.deepEqual(memoryTagsForScope({ workspaceId: "it", botId: "cto" }), [
      "workspace:it",
      "bot:cto",
    ]);
  });

  it("matches required scope tags", () => {
    assert.equal(
      memoryMatchesScope(["workspace:it", "bot:cto", "auto"], {
        workspaceId: "it",
        botId: "cto",
      }),
      true,
    );
    assert.equal(
      memoryMatchesScope(["workspace:it", "bot:fe"], {
        workspaceId: "it",
        botId: "cto",
      }),
      false,
    );
  });

  it("allows unscoped when no filter", () => {
    assert.equal(memoryMatchesScope(["auto-reflection"], null), true);
  });
});
