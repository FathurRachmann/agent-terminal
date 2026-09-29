import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findPersistedWrite,
  isEmptyReportSkeleton,
  isEmptySkeletonShellWrite,
  isTinyStubDeliverable,
  resolveWriteCandidatePaths,
} from "./write-persist-middleware.js";

describe("write-persist-middleware", () => {
  it("flags title-only laporan stubs", () => {
    assert.equal(
      isTinyStubDeliverable(
        "tmp/bots/laporan_bulanan_agustus.md",
        "Laporan Bulanan Agustus",
      ),
      true,
    );
    assert.equal(
      isTinyStubDeliverable("tmp/bots/notes.md", "hello"),
      false,
    );
    assert.equal(
      isTinyStubDeliverable(
        "tmp/bots/laporan.md",
        "# Laporan\n\n## Ringkasan\n\nPanjang substansi cukup untuk draft.\n".repeat(
          3,
        ),
      ),
      false,
    );
  });

  it("flags empty JSON laporan skeletons", () => {
    const skeleton = `{
  "executive_summary": "",
  "project_progress": [],
  "financial_performance": { "revenue": 0, "expenses": 0, "variances": [] },
  "operational_highlights": [],
  "human_resources": { "team_changes": [], "training_programs": [], "employee_performance": [] },
  "customer_feedback": { "positive": [], "negative": [] },
  "improvements_and_action_items": []
}`;
    assert.equal(isEmptyReportSkeleton(skeleton), true);
    assert.equal(
      isEmptySkeletonShellWrite(
        `python\nimport json\nreport = ${skeleton}\nwith open("tmp/bots/laporan_bulanan_agustus.md", "w") as f:\n  json.dump(report, f)`,
      ),
      true,
    );
    assert.equal(
      isEmptyReportSkeleton(
        JSON.stringify({
          executive_summary: "Agustus solid; revenue naik 12%.",
          project_progress: [{ name: "Jira Kemenkop", pct: 65 }],
          financial_performance: { revenue: 1_850_000_000, expenses: 980_000_000 },
        }),
      ),
      false,
    );
  });

  it("resolves working/ onto artifact home", () => {
    const paths = resolveWriteCandidatePaths(
      "/agent-home",
      "/project",
      "tmp/bots/x.md",
    );
    assert.ok(paths.some((p) => p.endsWith("/agent-home/tmp/bots/x.md")));
  });

  it("findPersistedWrite requires non-empty file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "persist-"));
    const empty = path.join(root, "empty.md");
    const full = path.join(root, "full.md");
    fs.writeFileSync(empty, "");
    fs.writeFileSync(full, "hi");
    assert.equal(findPersistedWrite([empty]), null);
    assert.deepEqual(findPersistedWrite([full]), {
      abs: path.resolve(full),
      size: 2,
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
