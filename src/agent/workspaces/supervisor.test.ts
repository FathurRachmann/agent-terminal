import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkspaceBot } from "./bots.js";
import {
  applyRoundBudget,
  buildSupervisorUserPrompt,
  excludeSupervisorFromQueue,
  extractJsonObject,
  formatSupervisorSystemNote,
  parseSupervisorVerdict,
  pickSupervisorBot,
} from "./supervisor.js";

function bot(
  id: string,
  extras: Partial<WorkspaceBot> = {},
): WorkspaceBot {
  return {
    id,
    name: extras.name ?? id,
    role: extras.role ?? id,
    description: extras.description ?? "",
    systemPrompt: extras.systemPrompt ?? "",
    tools: extras.tools ?? ["ls"],
    active: extras.active ?? true,
  };
}

describe("pickSupervisorBot", () => {
  it("prefers explicit supervisorBotId", () => {
    const bots = [bot("fe"), bot("cto"), bot("qa")];
    const picked = pickSupervisorBot(bots, "qa");
    assert.equal(picked?.id, "qa");
  });

  it("prefers CTO over frontend", () => {
    const bots = [bot("frontend-developer"), bot("cto"), bot("qa")];
    assert.equal(pickSupervisorBot(bots)?.id, "cto");
  });

  it("falls back to senior-developer when no CTO", () => {
    const bots = [
      bot("frontend-developer"),
      bot("senior-developer", { name: "Senior Developer" }),
    ];
    assert.equal(pickSupervisorBot(bots)?.id, "senior-developer");
  });

  it("matches role keywords", () => {
    const bots = [
      bot("alice", { role: "Tech Lead", name: "Alice" }),
      bot("bob", { role: "Intern" }),
    ];
    assert.equal(pickSupervisorBot(bots)?.id, "alice");
  });
});

describe("excludeSupervisorFromQueue", () => {
  it("removes supervisor id", () => {
    assert.deepEqual(excludeSupervisorFromQueue(["a", "b", "c"], "b"), [
      "a",
      "c",
    ]);
  });
});

describe("parseSupervisorVerdict", () => {
  it("parses clean JSON", () => {
    const v = parseSupervisorVerdict(
      JSON.stringify({
        status: "done",
        summary: "Semua klar.",
        gaps: [],
        nextActions: [],
      }),
    );
    assert.equal(v.status, "done");
    assert.equal(v.parsed, true);
    assert.match(v.summary, /klar/i);
  });

  it("parses fenced JSON", () => {
    const v = parseSupervisorVerdict(`\`\`\`json
{"status":"needs_more","summary":"Kurang bukti","gaps":["ls belum"],"nextActions":["FE ls src"]}
\`\`\``);
    assert.equal(v.status, "needs_more");
    assert.deepEqual(v.gaps, ["ls belum"]);
    assert.equal(v.nextActions[0], "FE ls src");
  });

  it("falls back when prose only", () => {
    const v = parseSupervisorVerdict("Sudah selesai, jawaban tim cukup.");
    assert.equal(v.status, "done");
    assert.equal(v.parsed, false);
  });
});

describe("applyRoundBudget", () => {
  it("forces done at max rounds", () => {
    const base = parseSupervisorVerdict(
      '{"status":"needs_more","summary":"Masih kurang"}',
    );
    const forced = applyRoundBudget(base, 8, 8);
    assert.equal(forced.status, "done");
    assert.match(forced.summary, /batas putaran/i);
  });

  it("leaves early rounds alone", () => {
    const base = parseSupervisorVerdict(
      '{"status":"needs_more","summary":"Masih kurang"}',
    );
    assert.equal(applyRoundBudget(base, 2, 8).status, "needs_more");
  });
});

describe("format + prompt helpers", () => {
  it("extractJsonObject finds embedded object", () => {
    const obj = extractJsonObject('Catatan: {"status":"blocked","summary":"X"} ok');
    assert.ok(obj && typeof obj === "object");
    assert.equal((obj as { status: string }).status, "blocked");
  });

  it("buildSupervisorUserPrompt includes replies", () => {
    const p = buildSupervisorUserPrompt({
      userPrompt: "Cek bug",
      workerReplies: [
        { botId: "fe", botName: "FE", content: "Ada risiko di App.tsx" },
      ],
      round: 1,
      maxRounds: 8,
    });
    assert.match(p, /Cek bug/);
    assert.match(p, /FE/);
    assert.match(p, /App\.tsx/);
  });

  it("formatSupervisorSystemNote labels status", () => {
    const note = formatSupervisorSystemNote(
      {
        status: "blocked",
        summary: "Butuh path repo",
        gaps: ["path"],
        nextActions: ["tanya user"],
        raw: "",
        parsed: true,
      },
      "CTO",
    );
    assert.match(note, /TERBLOKIR/);
    assert.match(note, /CTO/);
  });
});
