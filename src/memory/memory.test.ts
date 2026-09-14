import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PersistentMemoryStore } from "./persistent-store.js";
import { SessionStore } from "./session-store.js";
import { rankRelevantMemories, tokenize } from "./relevance.js";
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  type EmbeddingClient,
} from "./embeddings.js";
import { reflectAndStore, agentsMdPathFor } from "./reflection.js";

function fakeEmbedder(dim = 8): EmbeddingClient {
  return {
    model: "fake",
    async embed(texts: string[]) {
      return texts.map((t) => {
        const vec = new Array(dim).fill(0);
        for (let i = 0; i < t.length; i += 1) {
          vec[i % dim] += t.charCodeAt(i) / 1000;
        }
        const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
        return vec.map((x) => x / norm);
      });
    },
  };
}

describe("tokenize / relevance", () => {
  it("tokenizes useful terms", () => {
    const tokens = tokenize("Fix npm install peer dependency langsmith");
    assert.ok(tokens.includes("npm"));
    assert.ok(tokens.includes("langsmith"));
  });

  it("ranks relevant memories higher (lexical)", () => {
    const hits = rankRelevantMemories(
      "langsmith experimental sandbox export error",
      [
        {
          id: "1",
          kind: "error",
          title: "langsmith sandbox export",
          content: "Pin langsmith ^0.9 for ./experimental/sandbox export",
          tags: ["deps", "langsmith"],
          importance: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
        {
          id: "2",
          kind: "fact",
          title: "project uses ink tui",
          content: "CLI TUI is built with Ink React",
          tags: ["ui"],
          importance: 0.5,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
        },
      ],
      2,
    );
    assert.equal(hits[0]?.id, "1");
    assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
  });

  it("hybrid ranking prefers semantic match when embeddings present", () => {
    const queryEmb = [1, 0, 0, 0];
    const hits = rankRelevantMemories(
      "zzz unrelated tokens",
      [
        {
          id: "sem",
          kind: "fact",
          title: "semantic twin",
          content: "vector neighbor",
          tags: [],
          importance: 0.2,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
          embedding: [0.99, 0.01, 0, 0],
        },
        {
          id: "lex",
          kind: "fact",
          title: "zzz unrelated tokens here",
          content: "zzz unrelated tokens",
          tags: [],
          importance: 0.9,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastAccessedAt: Date.now(),
          accessCount: 0,
          embedding: [0, 1, 0, 0],
        },
      ],
      2,
      queryEmb,
    );
    assert.equal(hits[0]?.id, "sem");
  });
});

describe("embeddings helpers", () => {
  it("round-trips float vectors", () => {
    const vec = [0.1, -0.25, 0.5, 1];
    const back = deserializeEmbedding(serializeEmbedding(vec));
    assert.ok(back);
    assert.equal(back!.length, 4);
    for (let i = 0; i < vec.length; i += 1) {
      assert.ok(Math.abs((back![i] ?? 0) - (vec[i] ?? 0)) < 1e-6);
    }
  });

  it("computes cosine similarity", () => {
    assert.ok(cosineSimilarity([1, 0], [1, 0]) > 0.99);
    assert.ok(cosineSimilarity([1, 0], [0, 1]) < 0.01);
  });
});

describe("SessionStore (persistent raw history)", () => {
  let dir: string;
  let sessions: SessionStore;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-session-"));
    sessions = new SessionStore(dir);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes session.json and append-only jsonl", () => {
    const state = sessions.startOrResume({
      threadId: "t1",
      model: "test-model",
    });
    assert.equal(state.threadId, "t1");
    sessions.markTurnStart("hello");
    sessions.appendTranscript({
      threadId: "t1",
      role: "user",
      content: "hello",
    });
    sessions.appendTranscript({
      threadId: "t1",
      role: "assistant",
      content: "world",
    });
    sessions.markTurnComplete("world");
    sessions.writeConfigSnapshot({ model: "test-model" });

    const disk = JSON.parse(
      fs.readFileSync(path.join(dir, ".agent", "session.json"), "utf8"),
    );
    assert.equal(disk.threadId, "t1");
    assert.equal(disk.turnCount, 1);
    assert.equal(disk.lastStatus, "completed");

    const events = sessions.readTranscript("t1");
    assert.equal(events.length, 2);
    assert.equal(events[0]?.role, "user");
    assert.ok(fs.existsSync(path.join(dir, ".agent", "memory", "config-snapshot.json")));
  });

  it("stores tool activity with uiEvent meta for reload", () => {
    sessions.appendTranscript({
      threadId: "t1",
      role: "tool",
      content: "tool_start:execute",
      meta: {
        uiEvent: {
          type: "tool_start",
          name: "execute",
          input: { command: "ls" },
        },
      },
    });
    sessions.appendTranscript({
      threadId: "t1",
      role: "tool",
      content: "tool_end:execute",
      meta: {
        uiEvent: {
          type: "tool_end",
          name: "execute",
          output: "ok",
        },
      },
    });
    const events = sessions.readTranscript("t1");
    const tools = events.filter((e) => e.role === "tool");
    assert.ok(tools.length >= 2);
    const last = tools[tools.length - 1];
    assert.equal((last?.meta?.uiEvent as { type?: string })?.type, "tool_end");
  });
});

describe("PersistentMemoryStore + embeddings", () => {
  let dir: string;
  let store: PersistentMemoryStore;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mem-"));
    store = new PersistentMemoryStore(dir);
  });

  after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("upserts and lists durable records", () => {
    const saved = store.upsert({
      kind: "rule",
      title: "Known Pitfalls",
      content: "Always pin langsmith to ^0.9.0",
      tags: ["deps"],
      importance: 0.8,
    });
    assert.ok(saved.id);
    const listed = store.list({ kind: "rule" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.content, "Always pin langsmith to ^0.9.0");
  });

  it("stores embedding blobs via upsertWithEmbedding", async () => {
    const record = await store.upsertWithEmbedding(
      {
        kind: "fact",
        title: "uses pty",
        content: "Sandbox is node-pty based",
        tags: ["sandbox"],
        importance: 0.6,
      },
      fakeEmbedder(),
    );
    const emb = store.getEmbedding(record.id);
    assert.ok(emb);
    assert.ok(emb!.length > 0);
  });

  it("mirrors rules to AGENTS.md", () => {
    const agentsPath = path.join(dir, ".agent", "AGENTS.md");
    store.syncRulesToAgentsMd(agentsPath);
    const text = fs.readFileSync(agentsPath, "utf8");
    assert.match(text, /pin langsmith/i);
  });
});

describe("reflection / compression", () => {
  let dir: string;
  let store: PersistentMemoryStore;
  let sessions: SessionStore;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reflect-"));
    store = new PersistentMemoryStore(dir);
    sessions = new SessionStore(dir);
    sessions.startOrResume({ threadId: "r1", model: "m" });
  });

  after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores an episode without LLM", async () => {
    const { storedIds } = await reflectAndStore({
      store,
      sessionStore: sessions,
      embedder: fakeEmbedder(),
      agentsMdPath: agentsMdPathFor(dir),
      input: {
        threadId: "r1",
        userPrompt: "fix the build",
        assistantResponse: "Pinned langsmith and reran npm install",
      },
    });
    assert.ok(storedIds.length >= 1);
    const episodes = store.list({ kind: "episode" });
    assert.ok(episodes.some((e) => /fix the build/i.test(e.title)));
    const transcript = sessions.readTranscript("r1");
    assert.ok(transcript.some((e) => e.role === "reflection"));
  });

  it("learns user style from ordinary Indonesian chat", async () => {
    const { storedIds } = await reflectAndStore({
      store,
      sessionStore: sessions,
      embedder: fakeEmbedder(),
      agentsMdPath: agentsMdPathFor(dir),
      input: {
        threadId: "r1",
        userPrompt: "tolong jelaskan dong yang lebih rapi aja buset",
        assistantResponse: "Oke, ringkasnya begini…",
      },
    });
    assert.ok(storedIds.length >= 1);
    const prefs = store.list({ kind: "preference" });
    assert.ok(
      prefs.some((p) => /USER prefers Indonesian/i.test(p.content)),
      `expected Indonesian preference, got: ${prefs.map((p) => p.content).join(" | ")}`,
    );
    assert.ok(
      prefs.some(
        (p) =>
          /USER writes informal/i.test(p.content) ||
          /USER prefers clean readable formatting/i.test(p.content),
      ),
      "expected style or formatting preference",
    );
    const agents = fs.readFileSync(agentsMdPathFor(dir), "utf8");
    assert.match(agents, /## User preferences/);
    assert.match(agents, /USER prefers Indonesian/i);
  });
});
