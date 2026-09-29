import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import {
  bundledMonthlyPdfCommand,
  extractPythonFence,
  isEmptySkeletonPdfDump,
  looksLikePdfLaporanPython,
  promotePdfPythonDumpToExecute,
} from "./promote-pdf-python-dump.js";

const EMPTY_DUMP = `\`\`\`python
import json
from fpdf import FPDF

report = {
    "executive_summary": "",
    "project_progress": [],
    "financial_performance": {
        "revenue": 0,
        "expenses": 0,
        "variances": []
    },
    "operational_highlights": [],
    "human_resources": {
        "team_changes": [],
        "training_programs": [],
        "employee_performance": []
    },
    "customer_feedback": { "positive": [], "negative": [] },
    "improvements_and_action_items": []
}

pdf = FPDF()
pdf.add_page()
pdf.set_font("Arial", size=15)
pdf.cell(200, 10, txt="Laporan Keuangan Bulanan Agustus", ln=1, align="C")
pdf.output("tmp/bots/laporan.pdf")
\`\`\``;

describe("promote-pdf-python-dump", () => {
  it("extracts python fences", () => {
    const body = extractPythonFence(EMPTY_DUMP);
    assert.ok(body);
    assert.match(body!, /from fpdf import FPDF/);
  });

  it("detects empty skeleton pdf dumps", () => {
    const body = extractPythonFence(EMPTY_DUMP)!;
    assert.equal(looksLikePdfLaporanPython(body), true);
    assert.equal(isEmptySkeletonPdfDump(body), true);
  });

  it("promotes empty dump to bundled execute", () => {
    const out = promotePdfPythonDumpToExecute(
      new AIMessage({ content: EMPTY_DUMP }),
    );
    assert.ok(AIMessage.isInstance(out));
    assert.ok(out.tool_calls?.length);
    assert.equal(out.tool_calls![0]!.name, "execute");
    const cmd = String((out.tool_calls![0]!.args as { command: string }).command);
    assert.match(cmd, /generate-monthly-financial-pdf\.py/);
    assert.match(cmd, /laporan_keuangan/);
    assert.match(String(out.content), /Empty laporan template/i);
  });

  it("leaves normal replies alone", () => {
    const msg = new AIMessage({ content: "PDF ready at tmp/bots/x.pdf" });
    assert.equal(promotePdfPythonDumpToExecute(msg), msg);
  });

  it("bundled command is runnable shape", () => {
    assert.match(bundledMonthlyPdfCommand(), /python3 .*generate-monthly-financial-pdf\.py/);
  });
});
