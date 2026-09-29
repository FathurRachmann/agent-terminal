import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeVerbalFolderPermission } from "../cli/run-agent.js";

describe("looksLikeVerbalFolderPermission", () => {
  it("matches Indonesian and English grants", () => {
    assert.equal(looksLikeVerbalFolderPermission("ya saya izinkan"), true);
    assert.equal(looksLikeVerbalFolderPermission("Ya, silakan"), true);
    assert.equal(looksLikeVerbalFolderPermission("ok boleh"), true);
    assert.equal(looksLikeVerbalFolderPermission("yes, grant access"), true);
    assert.equal(looksLikeVerbalFolderPermission("Approve folder access"), true);
    assert.equal(looksLikeVerbalFolderPermission("ya"), true);
  });

  it("rejects unrelated messages", () => {
    assert.equal(looksLikeVerbalFolderPermission("buat laporan PDF"), false);
    assert.equal(looksLikeVerbalFolderPermission("yes please make the PDF"), false);
    assert.equal(looksLikeVerbalFolderPermission(""), false);
    assert.equal(
      looksLikeVerbalFolderPermission("x".repeat(300) + " izinkan"),
      false,
    );
  });
});
