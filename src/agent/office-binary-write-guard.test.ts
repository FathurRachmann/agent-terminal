import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolMessage } from "@langchain/core/messages";
import {
  isOfficeBinaryPath,
  rejectOfficeBinaryWrite,
  officeBinaryWriteRejectMessage,
} from "./office-binary-write-guard.js";

describe("office-binary-write-guard", () => {
  it("detects office/pdf extensions", () => {
    assert.equal(isOfficeBinaryPath("tmp/bots/x.docx"), true);
    assert.equal(isOfficeBinaryPath("/abs/Bill_of_Delivery_JIRA.docx"), true);
    assert.equal(isOfficeBinaryPath("a.pdf"), true);
    assert.equal(isOfficeBinaryPath("sheet.XLSX"), true);
    assert.equal(isOfficeBinaryPath("notes.md"), false);
    assert.equal(isOfficeBinaryPath("script.py"), false);
    assert.equal(isOfficeBinaryPath(""), false);
  });

  it("rejects write_file to .docx with actionable error", () => {
    const msg = rejectOfficeBinaryWrite({
      name: "write_file",
      id: "tc1",
      args: {
        path: "/Users/fathurrachman/Desktop/Agent/tmp/bots/Bill_of_Delivery_JIRA.docx",
        content: "# BILL OF DELIVERY\nmarkdown…",
      },
    });
    assert.ok(msg);
    assert.ok(ToolMessage.isInstance(msg));
    assert.equal(msg.status, "error");
    assert.match(String(msg.content), /refuse write_file/i);
    assert.match(String(msg.content), /productivity\/docx/i);
    assert.match(String(msg.content), /python-docx/i);
  });

  it("rejects edit_file to .pdf", () => {
    const msg = rejectOfficeBinaryWrite({
      name: "edit_file",
      id: "tc2",
      args: { file_path: "tmp/bots/quotation.pdf", old_string: "a", new_string: "b" },
    });
    assert.ok(msg);
    assert.match(String(msg.content), /productivity\/pdf/i);
  });

  it("allows write_file for text/code paths", () => {
    assert.equal(
      rejectOfficeBinaryWrite({
        name: "write_file",
        args: { path: "tmp/bots/make_bod.py", content: "print(1)" },
      }),
      null,
    );
  });

  it("ignores non-write tools", () => {
    assert.equal(
      rejectOfficeBinaryWrite({
        name: "read_file",
        args: { path: "tmp/bots/x.docx" },
      }),
      null,
    );
  });

  it("message mentions binary stub risk", () => {
    assert.match(
      officeBinaryWriteRejectMessage("tmp/bots/x.docx"),
      /corrupt stub/i,
    );
  });
});
