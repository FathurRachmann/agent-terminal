import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceBot } from "./bots.js";
import { mentionSuggestions, parseMentions } from "./mentions.js";
import {
  buildReplyQueue,
  heuristicRouteBots,
  isAddressAllMessage,
} from "./routing.js";

const BOTS: WorkspaceBot[] = [
  {
    id: "fe",
    name: "FE",
    role: "Frontend",
    description: "UI React",
  },
  {
    id: "be",
    name: "BE",
    role: "Backend",
    description: "API database",
  },
  {
    id: "qa",
    name: "QA",
    role: "QA",
    description: "tests bugs",
  },
];

describe("workspace mentions + routing", () => {
  it("parses @mentions by id and name", () => {
    const hits = parseMentions("Tolong @FE dan @be review ini", BOTS);
    assert.deepEqual(
      hits.map((h) => h.botId).sort(),
      ["be", "fe"],
    );
  });

  it("mention_only blocks replies without mention", () => {
    const q = buildReplyQueue({
      message: "cek status sprint",
      bots: BOTS,
      replyMode: "mention_only",
      maxResponders: 2,
    });
    assert.equal(q.source, "none");
    assert.equal(q.botIds.length, 0);
  });

  it("mentions override router", () => {
    const q = buildReplyQueue({
      message: "cek API @qa",
      bots: BOTS,
      replyMode: "auto",
      maxResponders: 3,
    });
    assert.equal(q.source, "mention");
    assert.deepEqual(q.botIds, ["qa"]);
  });

  it("heuristic router picks relevant bots", () => {
    const ids = heuristicRouteBots(
      "Tolong perbaiki frontend UI React",
      BOTS,
      2,
    );
    assert.ok(ids.includes("fe"));
  });

  it("autocomplete filters by prefix", () => {
    const sug = mentionSuggestions("f", BOTS);
    assert.equal(sug[0]?.id, "fe");
  });

  it("broadcasts to all bots on halo semuanya (capped by maxResponders)", () => {
    assert.equal(isAddressAllMessage("haloo semuanyaaa"), true);
    assert.equal(isAddressAllMessage("@pm buat PRD"), false);
    assert.equal(
      isAddressAllMessage(
        "coba suruh semua anggota yg ada disini buat bikin laporan",
      ),
      true,
    );
    const q = buildReplyQueue({
      message: "haloo semuanyaaa",
      bots: BOTS,
      replyMode: "auto",
      maxResponders: 1,
    });
    assert.equal(q.source, "broadcast");
    assert.equal(q.botIds.length, 1);
    const qAll = buildReplyQueue({
      message: "halo semuanya",
      bots: BOTS,
      replyMode: "auto",
      maxResponders: 8,
    });
    assert.deepEqual(qAll.botIds.sort(), ["be", "fe", "qa"]);
  });

  it("broadcast queue prefers CTO then PM before other roles", () => {
    const team: WorkspaceBot[] = [
      {
        id: "tech-writer",
        name: "Tech Writer",
        role: "Technical Writer",
        description: "docs",
      },
      {
        id: "cto",
        name: "CTO",
        role: "CTO",
        description: "leadership",
      },
      {
        id: "qa",
        name: "QA",
        role: "QA",
        description: "tests",
      },
      {
        id: "pm",
        name: "PM",
        role: "PM",
        description: "product",
      },
    ];
    const q = buildReplyQueue({
      message: "suruh semua anggota buat laporan proyek",
      bots: team,
      replyMode: "auto",
      maxResponders: 3,
    });
    assert.equal(q.source, "broadcast");
    assert.deepEqual(q.botIds, ["cto", "pm", "tech-writer"]);
  });

  it("parses multi-word @Name mentions", () => {
    const named: WorkspaceBot[] = [
      {
        id: "pm",
        name: "Product Manager",
        role: "PM",
        description: "roadmap",
      },
    ];
    const hits = parseMentions("ping @Product Manager please", named);
    assert.deepEqual(
      hits.map((h) => h.botId),
      ["pm"],
    );
  });

  it("skips inactive bots when caller filters the roster", () => {
    const active = BOTS.filter((b) => b.id !== "qa");
    const q = buildReplyQueue({
      message: "halo semuanya",
      bots: active,
      replyMode: "auto",
      maxResponders: 8,
    });
    assert.equal(q.source, "broadcast");
    assert.deepEqual(q.botIds.sort(), ["be", "fe"]);
  });
});

describe("workspace bot project tools", () => {
  it("merges ls/read_file into bot allowlist", async () => {
    const { mergeBotToolsForProject, buildWorkspaceBotInstruction } =
      await import("./bots.js");
    const tools = mergeBotToolsForProject(["web_search"]);
    assert.ok(tools.includes("ls"));
    assert.ok(tools.includes("read_file"));
    assert.ok(tools.includes("web_search"));
    const text = buildWorkspaceBotInstruction(BOTS[0]!, {
      project: {
        id: "simkopdes",
        name: "SIMKOPDES",
        folders: ["/tmp/simkopdes"],
        primaryFolder: "/tmp/simkopdes",
      },
    });
    assert.match(text, /SIMKOPDES/);
    assert.match(text, /\/tmp\/simkopdes/);
    assert.match(text, /Do NOT ask the user for the folder path/);
  });
});
