import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { indexArtifactsFromTranscript } from "./artifacts-index.js";
import type { TranscriptEvent } from "../memory/session-store.js";

describe("artifacts index", () => {
  it("indexes files and links from tool uiEvents", () => {
    const events: TranscriptEvent[] = [
      {
        ts: "2026-09-14T08:00:00.000Z",
        threadId: "t1",
        role: "tool",
        content: "tool_start:write_file",
        meta: {
          uiEvent: {
            type: "tool_start",
            name: "write_file",
            input: { path: "working/report.md", content: "# hi" },
          },
        },
      },
      {
        ts: "2026-09-14T08:00:01.000Z",
        threadId: "t1",
        role: "tool",
        content: "tool_end:write_file",
        meta: {
          uiEvent: {
            type: "tool_end",
            name: "write_file",
            output: "ok",
          },
        },
      },
      {
        ts: "2026-09-14T08:00:02.000Z",
        threadId: "t1",
        role: "tool",
        content: "tool_start:browser_open",
        meta: {
          uiEvent: {
            type: "tool_start",
            name: "browser_open",
            input: { url: "https://example.com/docs" },
          },
        },
      },
      {
        ts: "2026-09-14T08:00:03.000Z",
        threadId: "t1",
        role: "assistant",
        content: "Saved at working/laporan_bulanan.docx and https://npmjs.com",
      },
    ];

    const rows = indexArtifactsFromTranscript(events, {
      threadId: "t1",
      sessionPreview: "Friendly greeting",
    });

    assert.ok(rows.some((r) => r.location.includes("report.md")));
    assert.ok(rows.some((r) => r.category === "links" && r.location.includes("example.com")));
    assert.ok(rows.some((r) => r.location.includes("laporan_bulanan.docx")));
    assert.ok(rows.some((r) => r.location.includes("npmjs.com")));
  });
});
