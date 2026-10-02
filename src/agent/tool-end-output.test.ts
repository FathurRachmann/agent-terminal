import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDiffToolSuffix, buildFileDiffPayload } from "./edit-diff.js";
import { formatToolEndOutput, truncateOneLine } from "./tool-end-output.js";
import { parseAgentFileDiffPayload } from "../desktop-app/renderer/tool-diff.js";

describe("formatToolEndOutput", () => {
  it("preserves newlines and FILE_DIFF for edit_file (unlike one-line truncate)", () => {
    const payload = buildFileDiffPayload({
      path: "backend/server.js",
      before: "const x = 1;\n",
      after: "const x = 2;\n",
    });
    const raw = `Updated file successfully${formatDiffToolSuffix(payload)}`;
    const smashed = truncateOneLine(raw, 400);
    assert.equal(parseAgentFileDiffPayload(smashed), null);

    const kept = formatToolEndOutput("edit_file", raw, 400);
    assert.match(kept, /\n/);
    const parsed = parseAgentFileDiffPayload(kept);
    assert.ok(parsed);
    assert.equal(parsed!.path, "backend/server.js");
    assert.equal(parsed!.before, payload.before);
    assert.equal(parsed!.after, payload.after);
  });

  it("still truncates plain execute output", () => {
    const long = "ok " + "x".repeat(800);
    const out = formatToolEndOutput("execute", long, 400);
    assert.ok(out.length <= 400);
    assert.ok(out.endsWith("…"));
  });
});
