import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveNewSessionProjectId,
  resolveSessionTurnProjectId,
} from "./session-project-binding.js";

describe("session-project-binding", () => {
  it("general session turn ignores sticky global project", () => {
    assert.equal(
      resolveSessionTurnProjectId({
        isBotThread: false,
        sessionMetaProjectId: null,
      }),
      null,
    );
  });

  it("project session turn uses meta", () => {
    assert.equal(
      resolveSessionTurnProjectId({
        isBotThread: false,
        sessionMetaProjectId: "appgw",
      }),
      "appgw",
    );
  });

  it("bot threads never bind a project", () => {
    assert.equal(
      resolveSessionTurnProjectId({
        isBotThread: true,
        sessionMetaProjectId: "appgw",
      }),
      null,
    );
  });

  it("new session from Sessions tab clears sticky project", () => {
    assert.equal(resolveNewSessionProjectId(null), null);
    assert.equal(resolveNewSessionProjectId(undefined), null);
    assert.equal(resolveNewSessionProjectId(""), null);
    assert.equal(resolveNewSessionProjectId("appgw"), "appgw");
  });
});
