import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractDiffFromEditArgs,
  resolveToolDiff,
  summarizePatchStats,
  fileDiffPayloadFromEditArgs,
} from "../desktop-app/renderer/tool-diff.js";

describe("extractDiffFromEditArgs", () => {
  it("builds red/green lines from edit_file old/new strings", () => {
    const diff = extractDiffFromEditArgs("edit_file", {
      file_path: "nuxt.config.ts",
      old_string: "modules: []",
      new_string: "modules: ['@nuxt/ui']",
    });
    assert.ok(diff);
    assert.equal(diff!.header, "nuxt.config.ts");
    assert.ok(diff!.lines.some((l) => l.kind === "del" && l.text.includes("modules: []")));
    assert.ok(
      diff!.lines.some(
        (l) => l.kind === "add" && l.text.includes("@nuxt/ui"),
      ),
    );
  });

  it("treats write_file content as additions", () => {
    const diff = extractDiffFromEditArgs("write_file", {
      path: "receiptParser.js",
      content: "export function parse() {}\n",
    });
    assert.ok(diff);
    assert.ok(diff!.lines.every((l) => l.kind === "add" || l.kind === "ctx"));
    assert.ok(diff!.lines.some((l) => l.kind === "add"));
  });

  it("resolveToolDiff falls back to args when output has no +/-", () => {
    const diff = resolveToolDiff(
      "edit_file",
      "Successfully updated file",
      {
        file_path: "package.json",
        old_string: '"name": "a"',
        new_string: '"name": "b"',
      },
    );
    assert.ok(diff);
    assert.ok(diff!.lines.some((l) => l.kind === "del"));
    assert.ok(diff!.lines.some((l) => l.kind === "add"));
  });

  it("summarizePatchStats uses args when output is bare success", () => {
    const label = summarizePatchStats(
      "Updated file",
      "edit_file",
      {
        file_path: "a.ts",
        old_string: "a\nb",
        new_string: "a\nc",
      },
    );
    assert.ok(label);
    assert.match(label!, /\+/);
    assert.match(label!, /−|-/);
  });

  it("fileDiffPayloadFromEditArgs supplies Monaco sides", () => {
    const payload = fileDiffPayloadFromEditArgs("edit_file", {
      file_path: "x.js",
      old_string: "1",
      new_string: "2",
    });
    assert.ok(payload);
    assert.equal(payload!.before, "1");
    assert.equal(payload!.after, "2");
  });
});
