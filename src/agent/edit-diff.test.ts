import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFileDiffPayload,
  buildUnifiedDiff,
  formatDiffToolSuffix,
  parseFileDiffPayload,
  reconstructBeforeFromEdit,
} from "./edit-diff.js";
import { extractDiffFromToolOutput } from "../desktop-app/renderer/tool-diff.js";

describe("edit-diff", () => {
  it("builds a parseable unified diff for a simple line change", () => {
    const before = "a\nb\nc\n";
    const after = "a\nB\nc\n";
    const unified = buildUnifiedDiff({
      path: "src/demo.ts",
      before,
      after,
    });
    assert.match(unified, /--- a\/src\/demo\.ts/);
    assert.match(unified, /\+\+\+ b\/src\/demo\.ts/);
    assert.match(unified, /^-b$/m);
    assert.match(unified, /^\+B$/m);

    const extracted = extractDiffFromToolOutput(`\`\`\`diff\n${unified}\n\`\`\``);
    assert.ok(extracted);
    assert.ok(extracted!.lines.some((l) => l.kind === "del"));
    assert.ok(extracted!.lines.some((l) => l.kind === "add"));
  });

  it("reconstructs before from edit args", () => {
    const after = "hello\nworld\n";
    const before = reconstructBeforeFromEdit({
      after,
      oldString: "hello",
      newString: "hi",
    });
    // after doesn't contain newString "hi" — expect null
    assert.equal(before, null);

    const after2 = "hi\nworld\n";
    const before2 = reconstructBeforeFromEdit({
      after: after2,
      oldString: "hello",
      newString: "hi",
    });
    assert.equal(before2, "hello\nworld\n");
  });

  it("round-trips FILE_DIFF fence for Monaco payload", () => {
    const payload = buildFileDiffPayload({
      path: "foo.ts",
      before: "const x = 1;\n",
      after: "const x = 2;\n",
    });
    const suffix = formatDiffToolSuffix(payload);
    assert.match(suffix, /```diff/);
    assert.match(suffix, /```agent-file-diff/);
    const parsed = parseFileDiffPayload(`ok${suffix}`);
    assert.ok(parsed);
    assert.equal(parsed!.path, "foo.ts");
    assert.equal(parsed!.before, payload.before);
    assert.equal(parsed!.after, payload.after);
  });
});
