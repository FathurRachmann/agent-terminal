import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getDecisionEngine,
  resetDecisionEngineCache,
  isDecisionEngineEnabled,
} from "./engine.js";
import { createHeuristicDecisionEngine } from "./heuristics.js";
import { routeBotsWithDecisionEngine } from "./route-bots.js";
import { gateDesktopFastPath } from "./desktop-gate.js";
import { decideExtraDisabledTools } from "./tool-filter.js";
import { decideKanbanTriage, layaAwareDecomposer } from "./kanban-triage.js";
import type { WorkspaceBot } from "../agent/workspaces/bots.js";

describe("decision engine", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetDecisionEngineCache();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    resetDecisionEngineCache();
  });

  it("enabled by default", () => {
    delete process.env.LAYA_ENABLED;
    delete process.env.DECISION_ENGINE;
    resetDecisionEngineCache();
    assert.equal(isDecisionEngineEnabled(), true);
  });

  it("can be disabled explicitly", () => {
    process.env.LAYA_ENABLED = "0";
    resetDecisionEngineCache();
    assert.equal(isDecisionEngineEnabled(), false);
  });

  it("heuristic answers choice/noul", async () => {
    const engine = createHeuristicDecisionEngine();
    const res = await engine.predict(
      { message: "fix the react frontend css bug" },
      {
        bot: {
          type: "choice",
          instructions: "pick a bot",
          criteria: {
            fe: "frontend react ui css",
            be: "backend api database",
            qa: "testing qa bugs",
          },
        },
        need_web: {
          type: "noul",
          instructions: "needs web search",
        },
      },
    );
    assert.ok(res);
    assert.equal(res.source, "heuristic");
    assert.equal(res.answers.bot?.type, "choice");
    if (res.answers.bot?.type === "choice") {
      assert.equal(res.answers.bot.choice, "fe");
    }
  });

  it("routes bots when LAYA_ENABLED + heuristic only", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const bots: WorkspaceBot[] = [
      {
        id: "fe",
        name: "Frontend",
        role: "FE",
        description: "React UI CSS",
        systemPrompt: "",
      },
      {
        id: "be",
        name: "Backend",
        role: "BE",
        description: "API database server",
        systemPrompt: "",
      },
    ];
    const routed = await routeBotsWithDecisionEngine({
      message: "tolong perbaiki react css di halaman login",
      bots,
      maxResponders: 2,
    });
    assert.ok(routed);
    assert.equal(routed.botIds[0], "fe");
  });

  it("gates desktop fast-path", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const open = await gateDesktopFastPath({
      prompt: "buka https://youtube.com di chrome",
      hasParsedIntent: true,
      hasFollowUp: false,
    });
    assert.equal(open.allowFastPath, true);

    const code = await gateDesktopFastPath({
      prompt: "refactor the auth module and write unit tests",
      hasParsedIntent: true,
      hasFollowUp: false,
    });
    // Coding-shaped requests should not prefer desktop-only fast path.
    assert.equal(code.allowFastPath, false);
  });

  it("filters heavy tools for simple coding prompts", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const decided = await decideExtraDisabledTools({
      prompt: "rename variable foo to bar in src/main.ts",
      alreadyDisabled: new Set(),
    });
    assert.ok(decided.disabledExtra.has("web_search"));
    assert.ok(decided.disabledExtra.has("desktop_automate"));
  });

  it("kanban triage specify vs decompose", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const simple = await decideKanbanTriage({
      task: {
        id: "t1",
        title: "Fix typo in README",
        body: "one word typo",
        status: "triage",
      } as never,
      profiles: [
        { id: "default", description: "general" },
        { id: "fe", description: "frontend react" },
      ],
      defaultAssignee: "default",
    });
    assert.equal(simple.action, "specify");

    const decomposer = layaAwareDecomposer();
    const plan = await decomposer({
      task: {
        id: "t2",
        title: "Build login page and API",
        body: "need frontend react and backend api database work across team",
        status: "triage",
      } as never,
      profiles: [
        { id: "fe", description: "frontend react ui" },
        { id: "be", description: "backend api database" },
      ],
      defaultAssignee: "fe",
    });
    assert.ok(plan === null || plan.children.length >= 1);
  });

  it("getDecisionEngine returns heuristic when enabled", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const engine = getDecisionEngine();
    assert.equal(engine.kind, "heuristic");
    const res = await engine.predict("hello", {
      x: { type: "noul", instructions: "greeting" },
    });
    assert.ok(res);
  });

  it("resolveTurnScope builds allowlist + agent nudge for main chat", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const { resolveTurnScope } = await import("./turn-scope.js");
    const scope = await resolveTurnScope({
      prompt: "refactor auth module and add unit tests",
    });
    assert.ok(scope.allowlist);
    assert.ok(scope.allowlist!.includes("ls"));
    assert.ok(scope.allowlist!.includes("task"));
    assert.ok(scope.nudge.includes("TURN SCOPE"));
    assert.equal(scope.source, "heuristic");
  });

  it("resolveTurnScope keeps bot base allowlist intact", async () => {
    process.env.LAYA_ENABLED = "1";
    process.env.LAYA_HEURISTIC_ONLY = "1";
    resetDecisionEngineCache();
    const { resolveTurnScope } = await import("./turn-scope.js");
    const base = ["ls", "read_file", "web_search", "browser_open", "execute"];
    const scope = await resolveTurnScope({
      prompt: "cek UI login form di browser",
      baseAllowlist: base,
    });
    assert.deepEqual(scope.allowlist, base);
    assert.match(scope.reason, /base-tools/);
    assert.match(scope.nudge, /allowlist is already set/i);
  });
});
