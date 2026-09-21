import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBenignNetworkTermination } from "./network-abort.js";

describe("network-abort", () => {
  it("treats undici terminated TypeError as benign", () => {
    assert.equal(
      isBenignNetworkTermination(new TypeError("terminated")),
      true,
    );
  });

  it("treats AbortError as benign", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    assert.equal(isBenignNetworkTermination(err), true);
  });

  it("does not swallow real application bugs", () => {
    assert.equal(
      isBenignNetworkTermination(
        new TypeError("Cannot read properties of null"),
      ),
      false,
    );
    assert.equal(isBenignNetworkTermination(new Error("boom")), false);
  });

  it("walks error.cause", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause: Error }).cause = new TypeError("terminated");
    assert.equal(isBenignNetworkTermination(err), true);
  });
});
