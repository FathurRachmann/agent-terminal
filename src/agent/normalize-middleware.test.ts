import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMalformedProviderSdkError,
  rewriteProviderSdkCrash,
} from "./normalize-middleware.js";

describe("provider SDK crash rewrite", () => {
  it("detects OpenAI SDK undefined message TypeError", () => {
    const err = new TypeError(
      "Cannot read properties of undefined (reading 'message')",
    );
    assert.equal(isMalformedProviderSdkError(err), true);
    const rewritten = rewriteProviderSdkCrash(err);
    assert.match(rewritten.message, /malformed error payload/i);
    assert.match(rewritten.message, /parallel bot load/i);
  });

  it("passes through unrelated errors", () => {
    const err = new Error("rate limit exceeded");
    assert.equal(isMalformedProviderSdkError(err), false);
    assert.equal(rewriteProviderSdkCrash(err), err);
  });
});
