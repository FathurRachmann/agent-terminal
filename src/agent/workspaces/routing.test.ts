import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { EmbeddingClient } from "../../memory/embeddings.js";
import {
  clearSemanticCacheInflight,
} from "../../memory/semantic-cache.js";
import {
  clearSemanticCacheStoreCache,
  SemanticCacheStore,
} from "../../memory/semantic-cache-store.js";
import type { WorkspaceBot } from "./bots.js";
import { llmRouteBots } from "./routing.js";

const BOTS: WorkspaceBot[] = [
  {
    id: "fe",
    name: "Frontend",
    role: "Frontend",
    description: "UI React CSS",
  },
  {
    id: "qa",
    name: "QA",
    role: "QA",
    description: "Testing bugs",
  },
];

function constantEmbedder(vec = [1, 0, 0, 0]): EmbeddingClient {
  return {
    model: "constant",
    async embed(texts: string[]) {
      return texts.map(() => [...vec]);
    },
  };
}

describe("llmRouteBots + semantic cache", () => {
  let dir: string;
  let store: SemanticCacheStore;
  let prevFlag: string | undefined;

  beforeEach(() => {
    clearSemanticCacheInflight();
    clearSemanticCacheStoreCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-cache-"));
    store = new SemanticCacheStore(dir);
    prevFlag = process.env.SEMANTIC_CACHE_ROUTING;
    process.env.SEMANTIC_CACHE_ROUTING = "1";
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
    clearSemanticCacheInflight();
    clearSemanticCacheStoreCache();
    if (prevFlag === undefined) delete process.env.SEMANTIC_CACHE_ROUTING;
    else process.env.SEMANTIC_CACHE_ROUTING = prevFlag;
  });

  it("skips invoke on second similar message when cache enabled", async () => {
    let invokes = 0;
    const invoke = async () => {
      invokes += 1;
      return '["fe"]';
    };
    const cache = { store, embedder: constantEmbedder() };

    const first = await llmRouteBots({
      message: "refund policy?",
      bots: BOTS,
      maxResponders: 2,
      invoke,
      semanticCache: cache,
    });
    const second = await llmRouteBots({
      message: "how do i get a refund",
      bots: BOTS,
      maxResponders: 2,
      invoke,
      semanticCache: cache,
    });

    assert.deepEqual(first, ["fe"]);
    assert.deepEqual(second, ["fe"]);
    assert.equal(invokes, 1);
  });

  it("misses when catalog fingerprint changes", async () => {
    let invokes = 0;
    const invoke = async () => {
      invokes += 1;
      return invokes === 1 ? '["fe"]' : '["qa"]';
    };
    const cache = { store, embedder: constantEmbedder() };

    await llmRouteBots({
      message: "refund?",
      bots: BOTS,
      maxResponders: 2,
      invoke,
      semanticCache: cache,
    });

    const botsChanged: WorkspaceBot[] = [
      ...BOTS,
      {
        id: "be",
        name: "Backend",
        role: "Backend",
        description: "API",
      },
    ];
    const second = await llmRouteBots({
      message: "refund?",
      bots: botsChanged,
      maxResponders: 2,
      invoke,
      semanticCache: cache,
    });

    assert.deepEqual(second, ["qa"]);
    assert.equal(invokes, 2);
  });

  it("does not use cache when flag is off", async () => {
    process.env.SEMANTIC_CACHE_ROUTING = "0";
    let invokes = 0;
    const invoke = async () => {
      invokes += 1;
      return '["fe"]';
    };
    const cache = { store, embedder: constantEmbedder() };

    await llmRouteBots({
      message: "a",
      bots: BOTS,
      maxResponders: 1,
      invoke,
      semanticCache: cache,
    });
    await llmRouteBots({
      message: "a",
      bots: BOTS,
      maxResponders: 1,
      invoke,
      semanticCache: cache,
    });
    assert.equal(invokes, 2);
  });

  it("fails open when store throws on nearest", async () => {
    const brokenStore = {
      nearest() {
        throw new Error("down");
      },
      add() {
        throw new Error("down");
      },
    } as unknown as SemanticCacheStore;

    let invokes = 0;
    const ids = await llmRouteBots({
      message: "hello fe ui",
      bots: BOTS,
      maxResponders: 1,
      invoke: async () => {
        invokes += 1;
        return '["fe"]';
      },
      semanticCache: {
        store: brokenStore,
        embedder: constantEmbedder(),
      },
    });
    assert.deepEqual(ids, ["fe"]);
    assert.equal(invokes, 1);
  });

  it("drops stale bot ids when roster shrinks (same namespace)", async () => {
    // Same catalog fingerprint (ids/roles/names/descs) but we manually inject
    // a payload that references a removed bot — filterValidBotIds must clear it.
    const nsBots = BOTS;
    await llmRouteBots({
      message: "route me",
      bots: nsBots,
      maxResponders: 2,
      invoke: async () => '["fe","qa"]',
      semanticCache: { store, embedder: constantEmbedder() },
    });

    // Overwrite cache entry payload to include a removed id while keeping
    // the same embedding/namespace by using store.add after clearing via
    // a direct add with the routing namespace helpers would change if bots
    // change — instead shrink roster and verify filtered result.
    const shrunk: WorkspaceBot[] = [BOTS[0]!]; // fe only
    // Different catalog → namespace miss → new LLM call. Test filter path
    // by mocking store.nearest to return stale payload for same catalog.
    const staleStore = {
      nearest() {
        return {
          id: "x",
          payload: JSON.stringify(["fe", "qa", "ghost"]),
          score: 0.99,
          queryText: "route me",
        };
      },
      add() {
        /* no-op */
      },
    } as unknown as SemanticCacheStore;

    let invokes = 0;
    const ids = await llmRouteBots({
      message: "route me again",
      bots: shrunk,
      maxResponders: 2,
      invoke: async () => {
        invokes += 1;
        return '["be"]';
      },
      semanticCache: {
        store: staleStore,
        embedder: constantEmbedder(),
      },
    });

    // ghost + qa filtered out; fe remains → no heuristic, no invoke
    assert.deepEqual(ids, ["fe"]);
    assert.equal(invokes, 0);
  });
});
