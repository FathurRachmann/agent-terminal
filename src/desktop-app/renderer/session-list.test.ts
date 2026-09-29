import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeBusyThreadIds,
  sessionPreviewLabel,
  sortSessionsForSidebar,
  touchSessionRow,
} from "./session-list.js";

describe("session-list", () => {
  it("sorts busy sessions first then by updatedAt", () => {
    const rows = [
      {
        threadId: "a",
        updatedAt: "2026-01-01T10:00:00.000Z",
        preview: "old",
        turnCount: 1,
      },
      {
        threadId: "b",
        updatedAt: "2026-01-01T12:00:00.000Z",
        preview: "newer",
        turnCount: 1,
      },
      {
        threadId: "c",
        updatedAt: "2026-01-01T09:00:00.000Z",
        preview: "busy but old",
        turnCount: 1,
      },
    ];
    const sorted = sortSessionsForSidebar(rows, ["c"]);
    assert.deepEqual(
      sorted.map((s) => s.threadId),
      ["c", "b", "a"],
    );
  });

  it("touches a session to the top with new preview", () => {
    const rows = [
      {
        threadId: "a",
        updatedAt: "2026-01-01T10:00:00.000Z",
        preview: "old",
        turnCount: 2,
      },
      {
        threadId: "b",
        updatedAt: "2026-01-01T11:00:00.000Z",
        preview: "mid",
        turnCount: 1,
      },
    ];
    const next = touchSessionRow(rows, "a", { preview: "hello there" });
    assert.equal(next[0]?.threadId, "a");
    assert.equal(next[0]?.preview, "hello there");
    assert.ok(
      new Date(next[0]!.updatedAt).getTime() >=
        new Date(rows[0]!.updatedAt).getTime(),
    );
  });

  it("merges busy ids without dropping local optimistic", () => {
    assert.deepEqual(mergeBusyThreadIds(["a"], ["a", "b"]), ["a", "b"]);
    assert.deepEqual(mergeBusyThreadIds([], ["x"]), ["x"]);
  });

  it("builds clean preview labels from attachment prompts", () => {
    const raw = `[ATTACHMENTS]
- IMAGE: \`tmp/uploads/shot.png\` (image/png, 1 bytes).
[/ATTACHMENTS]

[USER]
gambar apa ini?`;
    assert.equal(sessionPreviewLabel(raw), "gambar apa ini?");
  });
});
