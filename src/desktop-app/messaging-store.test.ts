import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadMessagingConfig,
  saveMessagingConfig,
} from "./messaging-store.js";
import {
  allMessagingAllowlist,
  coerceMessagingConfig,
  formatAllowedUsersCsv,
  isWhatsAppIdentityAllowed,
  normalizeWhatsAppIdentity,
  parseAllowedUsersCsv,
  resolveWhatsAppAccessRole,
  resolveWhatsAppAccessRoleFromCandidates,
  threadIdForWhatsAppJid,
} from "./messaging-shared.js";
import { WA_FRIEND_ALLOWED_TOOLS } from "./messaging-roles.js";

describe("messaging store / allowlist", () => {
  it("normalizes phone and jid identities", () => {
    assert.equal(normalizeWhatsAppIdentity("+62 812-3456-7890"), "6281234567890");
    assert.equal(
      normalizeWhatsAppIdentity("6281234567890@s.whatsapp.net"),
      "6281234567890",
    );
    assert.equal(
      normalizeWhatsAppIdentity("6281234567890:12@s.whatsapp.net"),
      "6281234567890",
    );
  });

  it("denies all when allowlist empty", () => {
    assert.equal(isWhatsAppIdentityAllowed("6281234567890", []), false);
  });

  it("matches allowlisted phones", () => {
    const allowed = ["+62 812-3456-7890"];
    assert.equal(
      isWhatsAppIdentityAllowed("6281234567890@s.whatsapp.net", allowed),
      true,
    );
    assert.equal(isWhatsAppIdentityAllowed("6281999999999", allowed), false);
  });

  it("rejects partial / suffix allowlist entries", () => {
    assert.equal(
      isWhatsAppIdentityAllowed("6281234567890", ["890"]),
      false,
    );
    assert.equal(
      isWhatsAppIdentityAllowed("6281234567890", ["81234567890"]),
      false,
    );
  });

  it("can allow by exact LID digits when listed", () => {
    assert.equal(
      isWhatsAppIdentityAllowed("22969485119587@lid", ["22969485119587"]),
      true,
    );
  });

  it("parses csv and builds wa thread ids", () => {
    assert.deepEqual(parseAllowedUsersCsv("a, b;c\nd"), ["a", "b", "c", "d"]);
    assert.equal(formatAllowedUsersCsv(["a", "b"]), "a, b");
    assert.equal(
      threadIdForWhatsAppJid("6281234567890@s.whatsapp.net"),
      "wa-6281234567890",
    );
  });

  it("migrates legacy allowedUsers into users and resolves roles", () => {
    const migrated = coerceMessagingConfig({
      version: 1,
      whatsapp: {
        enabled: true,
        allowedUsers: ["628111000001"],
        friends: ["628222000002"],
        conciseReplies: true,
      },
    });
    assert.deepEqual(migrated.whatsapp.users, ["628111000001"]);
    assert.deepEqual(migrated.whatsapp.friends, ["628222000002"]);
    assert.equal(
      resolveWhatsAppAccessRole("628111000001", migrated.whatsapp),
      "user",
    );
    assert.equal(
      resolveWhatsAppAccessRole("628222000002", migrated.whatsapp),
      "friend",
    );
    assert.equal(resolveWhatsAppAccessRole("628999000099", migrated.whatsapp), null);
    assert.deepEqual(allMessagingAllowlist(migrated.whatsapp), [
      "628111000001",
      "628222000002",
    ]);
  });

  it("prefers user when any candidate is owner", () => {
    const cfg = {
      users: ["628111000001"],
      friends: ["628222000002"],
    };
    assert.equal(
      resolveWhatsAppAccessRoleFromCandidates(
        ["999@lid", "628111000001@s.whatsapp.net"],
        cfg,
      ),
      "user",
    );
    assert.equal(
      resolveWhatsAppAccessRoleFromCandidates(
        ["22969485119587@lid", "628222000002@s.whatsapp.net"],
        cfg,
      ),
      "friend",
    );
  });

  it("friend tool allowlist excludes shell and folder access", () => {
    assert.ok(WA_FRIEND_ALLOWED_TOOLS.includes("write_file"));
    assert.ok(WA_FRIEND_ALLOWED_TOOLS.includes("edit_file"));
    assert.ok(!WA_FRIEND_ALLOWED_TOOLS.includes("execute"));
    assert.ok(!WA_FRIEND_ALLOWED_TOOLS.includes("request_folder_access"));
    assert.ok(!WA_FRIEND_ALLOWED_TOOLS.includes("show_allowed_folders"));
    assert.ok(!WA_FRIEND_ALLOWED_TOOLS.includes("desktop_automate"));
  });

  it("saves and loads messaging config with roles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-msg-"));
    try {
      const saved = saveMessagingConfig(root, {
        version: 1,
        whatsapp: {
          enabled: true,
          users: ["628111000001"],
          friends: ["628222000002"],
          conciseReplies: false,
        },
      });
      assert.equal(saved.whatsapp.enabled, true);
      const loaded = loadMessagingConfig(root);
      assert.equal(loaded.whatsapp.enabled, true);
      assert.deepEqual(loaded.whatsapp.users, ["628111000001"]);
      assert.deepEqual(loaded.whatsapp.friends, ["628222000002"]);
      assert.equal(loaded.whatsapp.conciseReplies, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
