import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { EmbeddingClient } from "./embeddings.js";
import {
  clearSemanticCacheInflight,
  coarseEmbeddingHash,
  isSemanticCacheRoutingEnabled,
  routingCacheNamespace,
  withSemanticCache,
} from "./semantic-cache.js";
import {
  clearSemanticCacheStoreCache,
  SemanticCacheStore,
} from "./semantic-cache-store.js";

function constantEmbedder(vec = [1, 0, 0, 0]): EmbeddingClient {
  return {
    model: "constant",
    async embed(texts: string[]) {
      return texts.map(() => [...vec]);
    },
  };
}

describe("SemanticCacheStore", () => {
  let dir: string;
  let store: SemanticCacheStore;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sem-cache-"));
    store = new SemanticCacheStore(dir);
  });

  after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("adds and finds nearest above threshold", () => {
    const ns = "test:hit";
    store.add({
      namespace: ns,
      queryText: "refund policy?",
      embedding: [1, 0, 0],
      payload: JSON.stringify(["fe"]),
      model: "fake",
      ttlMs: 60_000,
    });
    const hit = store.nearest({
      namespace: ns,
      embedding: [0.99, 0.01, 0],
      threshold: 0.92,
    });
    assert.ok(hit);
    assert.equal(hit!.payload, JSON.stringify(["fe"]));
    assert.ok(hit!.score >= 0.92);
  });

  it("misses below threshold", () => {
    const ns = "test:miss";
    store.add({
      namespace: ns,
      queryText: "orthogonal",
      embedding: [1, 0, 0],
      payload: JSON.stringify(["qa"]),
      model: "fake",
      ttlMs: 60_000,
    });
    const hit = store.nearest({
      namespace: ns,
      embedding: [0, 1, 0],
      threshold: 0.92,
    });
    assert.equal(hit, null);
  });

  it("isolates namespaces", () => {
    store.add({
      namespace: "ns-a",
      queryText: "same",
      embedding: [1, 0],
      payload: JSON.stringify(["a"]),
      model: "fake",
      ttlMs: 60_000,
    });
    store.add({
      namespace: "ns-b",
      queryText: "same",
      embedding: [1, 0],
      payload: JSON.stringify(["b"]),
      model: "fake",
      ttlMs: 60_000,
    });
    const a = store.nearest({
      namespace: "ns-a",
      embedding: [1, 0],
      threshold: 0.5,
    });
    const b = store.nearest({
      namespace: "ns-b",
      embedding: [1, 0],
      threshold: 0.5,
    });
    assert.equal(a?.payload, JSON.stringify(["a"]));
    assert.equal(b?.payload, JSON.stringify(["b"]));
  });

  it("prunes expired entries", () => {
    const ns = "test:ttl";
    store.add({
      namespace: ns,
      queryText: "old",
      embedding: [1, 0],
      payload: JSON.stringify(["gone"]),
      model: "fake",
      ttlMs: 1,
    });
    // Force expiry
    const hit = store.nearest({
      namespace: ns,
      embedding: [1, 0],
      threshold: 0.5,
      now: Date.now() + 1000,
    });
    assert.equal(hit, null);
    assert.equal(store.count(ns, Date.now() + 1000), 0);
  });
});

describe("withSemanticCache", () => {
  let dir: string;
  let store: SemanticCacheStore;

  beforeEach(() => {
    clearSemanticCacheInflight();
    clearSemanticCacheStoreCache();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sem-cache-h-"));
    store = new SemanticCacheStore(dir);
  });

  after(() => {
    clearSemanticCacheInflight();
    clearSemanticCacheStoreCache();
  });

  it("caches compute result and skips second call", async () => {
    let calls = 0;
    const embedder = constantEmbedder();
    const first = await withSemanticCache({
      store,
      embedder,
      namespace: "w:1",
      query: "refund policy?",
      compute: async () => {
        calls += 1;
        return ["fe"];
      },
      threshold: 0.92,
      ttlMs: 60_000,
    });
    const second = await withSemanticCache({
      store,
      embedder,
      namespace: "w:1",
      query: "how do i get a refund",
      compute: async () => {
        calls += 1;
        return ["qa"];
      },
      threshold: 0.92,
      ttlMs: 60_000,
    });
    assert.deepEqual(first, ["fe"]);
    assert.deepEqual(second, ["fe"]);
    assert.equal(calls, 1);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("single-flights concurrent misses", async () => {
    let calls = 0;
    const embedder = constantEmbedder([0, 1, 0, 0]);
    const compute = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return ["cto"];
    };
    const [a, b] = await Promise.all([
      withSemanticCache({
        store,
        embedder,
        namespace: "w:sf",
        query: "q1",
        compute,
        threshold: 0.92,
        ttlMs: 60_000,
      }),
      withSemanticCache({
        store,
        embedder,
        namespace: "w:sf",
        query: "q2",
        compute,
        threshold: 0.92,
        ttlMs: 60_000,
      }),
    ]);
    assert.deepEqual(a, ["cto"]);
    assert.deepEqual(b, ["cto"]);
    assert.equal(calls, 1);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails open when store.nearest throws", async () => {
    const broken = {
      nearest() {
        throw new Error("index down");
      },
      add() {
        throw new Error("index down");
      },
    } as unknown as SemanticCacheStore;
    const result = await withSemanticCache({
      store: broken,
      embedder: constantEmbedder(),
      namespace: "w:fail",
      query: "hi",
      compute: async () => ["fallback"],
    });
    assert.deepEqual(result, ["fallback"]);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips cache for lexical-only embedder", async () => {
    let calls = 0;
    const embedder: EmbeddingClient = {
      model: "lexical-only",
      async embed() {
        return [];
      },
    };
    await withSemanticCache({
      store,
      embedder,
      namespace: "w:noop",
      query: "a",
      compute: async () => {
        calls += 1;
        return ["x"];
      },
    });
    await withSemanticCache({
      store,
      embedder,
      namespace: "w:noop",
      query: "a",
      compute: async () => {
        calls += 1;
        return ["y"];
      },
    });
    assert.equal(calls, 2);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("routingCacheNamespace / helpers", () => {
  it("changes namespace when catalog fingerprint changes", () => {
    const a = routingCacheNamespace(
      [
        { id: "fe", role: "Frontend", name: "FE", description: "UI" },
        { id: "qa", role: "QA", name: "QA", description: "Test" },
      ],
      2,
    );
    const b = routingCacheNamespace(
      [
        { id: "fe", role: "Frontend", name: "FE", description: "UI" },
        { id: "qa", role: "QA Lead", name: "QA", description: "Test" },
      ],
      2,
    );
    const c = routingCacheNamespace(
      [
        { id: "fe", role: "Frontend", name: "FE", description: "UI React" },
        { id: "qa", role: "QA", name: "QA", description: "Test" },
      ],
      2,
    );
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it("coarseEmbeddingHash is stable for same vector", () => {
    const h1 = coarseEmbeddingHash([0.123456, 0.999]);
    const h2 = coarseEmbeddingHash([0.123456, 0.999]);
    assert.equal(h1, h2);
  });

  it("isSemanticCacheRoutingEnabled reads env", () => {
    const prev = process.env.SEMANTIC_CACHE_ROUTING;
    process.env.SEMANTIC_CACHE_ROUTING = "1";
    assert.equal(isSemanticCacheRoutingEnabled(), true);
    process.env.SEMANTIC_CACHE_ROUTING = "0";
    assert.equal(isSemanticCacheRoutingEnabled(), false);
    if (prev === undefined) delete process.env.SEMANTIC_CACHE_ROUTING;
    else process.env.SEMANTIC_CACHE_ROUTING = prev;
  });
});
