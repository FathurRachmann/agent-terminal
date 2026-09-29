import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFindSymbolPatterns,
  detectVerifyCommands,
} from "./coding-tools.js";
import {
  isCodeEditPath,
  looksLikeEditSuccess,
} from "./post-edit-verify-middleware.js";

describe("coding-tools helpers", () => {
  it("buildFindSymbolPatterns includes the symbol", () => {
    const pats = buildFindSymbolPatterns("createAgent");
    assert.ok(pats.some((p) => p.includes("createAgent")));
  });

  it("detectVerifyCommands finds typecheck in this repo", () => {
    const d = detectVerifyCommands(process.cwd());
    assert.ok(d.typecheck);
    assert.match(d.typecheck!, /typecheck|tsc/);
  });
});

describe("post-edit-verify helpers", () => {
  it("isCodeEditPath recognizes ts/tsx", () => {
    assert.equal(isCodeEditPath("src/foo.ts"), true);
    assert.equal(isCodeEditPath("a/b.tsx"), true);
    assert.equal(isCodeEditPath("readme.md"), false);
    assert.equal(isCodeEditPath(null), false);
  });

  it("looksLikeEditSuccess rejects clear errors", () => {
    assert.equal(looksLikeEditSuccess("Error: old_string not found"), false);
    assert.equal(looksLikeEditSuccess("Successfully updated file"), true);
  });
});
