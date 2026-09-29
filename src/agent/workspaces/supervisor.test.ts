import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkspaceBot } from "./bots.js";
import {
  applyRoundBudget,
  buildSupervisorContinuePrompt,
  buildSupervisorInstruction,
  buildSupervisorUserPrompt,
  excludeSupervisorFromQueue,
  extractJsonObject,
  formatSupervisorSystemNote,
  looksLikeDeferredNextActions,
  MAX_SUPERVISOR_AUTO_CONTINUE,
  parseSupervisorVerdict,
  pickSupervisorBot,
  resolveContinueWorkerIds,
  shouldAutoContinue,
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

  it("treats PERLU LANJUT prose as needs_more and extracts Next", () => {
    const v = parseSupervisorVerdict(
      "Supervisor: PERLU LANJUT\nKurang bukti file.\nNext: frontend-developer baca App.tsx; qa tulis test",
    );
    assert.equal(v.status, "needs_more");
    assert.ok(v.nextActions.length >= 1);
    assert.match(v.nextActions.join(" "), /frontend-developer/i);
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

  it("buildSupervisorInstruction forbids tool dumps", () => {
    const text = buildSupervisorInstruction(
      bot("senior-developer", { name: "Senior Developer", role: "Senior Dev" }),
    );
    assert.match(text, /NOT the implementer/i);
    assert.match(text, /automatically re-run workers/i);
    assert.match(text, /dump directory/i);
    assert.match(text, /BAD nextActions/i);
    assert.match(text, /EXECUTABLE work/i);
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

  it("formatSupervisorSystemNote labels PERLU LANJUT", () => {
    const note = formatSupervisorSystemNote(
      {
        status: "needs_more",
        summary: "Kurang",
        gaps: ["bukti"],
        nextActions: ["FE baca file"],
        raw: "",
        parsed: true,
      },
      "Senior Developer",
    );
    assert.match(note, /PERLU LANJUT/);
    assert.match(note, /Next:/);
  });

  it("shouldAutoContinue only for needs_more under budget", () => {
    const v = parseSupervisorVerdict(
      '{"status":"needs_more","summary":"x","gaps":[],"nextActions":["y"]}',
    );
    assert.equal(shouldAutoContinue(v, 2, 8, 0), true);
    assert.equal(shouldAutoContinue(v, 8, 8, 0), false);
    assert.equal(
      shouldAutoContinue({ ...v, status: "done" }, 2, 8, 0),
      false,
    );
    assert.equal(
      shouldAutoContinue(v, 2, 8, MAX_SUPERVISOR_AUTO_CONTINUE),
      false,
    );
    assert.equal(MAX_SUPERVISOR_AUTO_CONTINUE, 3);
  });

  it("buildSupervisorContinuePrompt includes gaps", () => {
    const p = buildSupervisorContinuePrompt({
      originalPrompt: "Cek bug",
      verdict: parseSupervisorVerdict(
        '{"status":"needs_more","summary":"Kurang","gaps":["bukti ls"],"nextActions":["FE ls"]}',
      ),
      round: 1,
      maxRounds: 8,
    });
    assert.match(p, /AUTO-CONTINUE/);
    assert.match(p, /EXECUTE NOW/i);
    assert.match(p, /write_file/);
    assert.match(p, /bukti ls/);
    assert.match(p, /FE ls/);
    assert.match(p, /FORBIDDEN/);
  });

  it("looksLikeDeferredNextActions detects audit-only endings", () => {
    assert.equal(
      looksLikeDeferredNextActions(
        "Audit selesai. Yang perlu dibereskan berikutnya adalah samakan kontrak API dan port.",
      ),
      true,
    );
    assert.equal(
      looksLikeDeferredNextActions(
        "Sudah saya ubah backend/src/server.js pakai write_file — port 3001 + PUT title/completed.",
      ),
      false,
    );
  });
});

describe("resolveContinueWorkerIds", () => {
  const bots = [
    bot("frontend-developer", {
      name: "Frontend Developer",
      role: "Frontend",
    }),
    bot("qa", { name: "QA Engineer", role: "QA" }),
    bot("senior-developer", {
      name: "Senior Developer",
      role: "Senior Developer",
    }),
  ];

  it("prefers bots named in nextActions", () => {
    const ids = resolveContinueWorkerIds({
      previousWorkerIds: ["frontend-developer", "qa"],
      bots,
      verdict: parseSupervisorVerdict(
        JSON.stringify({
          status: "needs_more",
          summary: "Kurang",
          gaps: [],
          nextActions: ["qa: tulis test untuk App.tsx"],
        }),
      ),
      supervisorId: "senior-developer",
    });
    assert.deepEqual(ids, ["qa"]);
  });

  it("falls back to previous workers excluding supervisor", () => {
    const ids = resolveContinueWorkerIds({
      previousWorkerIds: ["frontend-developer", "qa"],
      bots,
      verdict: parseSupervisorVerdict(
        '{"status":"needs_more","summary":"Kurang","gaps":["bukti"],"nextActions":["perbaiki"]}',
      ),
      supervisorId: "senior-developer",
    });
    assert.deepEqual(ids, ["frontend-developer", "qa"]);
    assert.ok(!ids.includes("senior-developer"));
  });

  it("includes supervisor when named as implementer", () => {
    const ids = resolveContinueWorkerIds({
      previousWorkerIds: ["frontend-developer"],
      bots,
      verdict: parseSupervisorVerdict(
        JSON.stringify({
          status: "needs_more",
          summary: "Senior harus fix",
          gaps: [],
          nextActions: ["Senior Developer: perbaiki bug di App.tsx"],
        }),
      ),
      supervisorId: "senior-developer",
    });
    assert.ok(ids.includes("senior-developer"));
  });
});
