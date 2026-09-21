import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
} from "./embeddings.js";

export type SemanticCacheEntry = {
  id: string;
  namespace: string;
  queryText: string;
  embedding: number[];
  payload: string;
  model: string;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
};

export type SemanticCacheHit = {
  id: string;
  payload: string;
  score: number;
  queryText: string;
};

/**
 * SQLite-backed semantic completion cache (vector nearest within a namespace).
 * Linear scan — fine for small routing caches; same scale model as LTM.
 */
export class SemanticCacheStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private lastPruneAt = 0;
  private static readonly PRUNE_INTERVAL_MS = 60_000;

  constructor(agentHome: string) {
    const dir = path.join(path.resolve(agentHome), ".agent", "memory");
    fs.mkdirSync(dir, { recursive: true });
    this.dbPath = path.join(dir, "semantic-cache.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        query_text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        payload TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_entries_ns_expires
        ON entries(namespace, expires_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  pruneExpired(now = Date.now()): number {
    const result = this.db
      .prepare(`DELETE FROM entries WHERE expires_at <= ?`)
      .run(now);
    this.lastPruneAt = now;
    return Number(result.changes ?? 0);
  }

  /** Prune at most once per PRUNE_INTERVAL_MS on read paths. */
  private maybePrune(now: number): void {
    if (now - this.lastPruneAt < SemanticCacheStore.PRUNE_INTERVAL_MS) return;
    this.pruneExpired(now);
  }

  add(input: {
    namespace: string;
    queryText: string;
    embedding: number[];
    payload: string;
    model: string;
    ttlMs: number;
  }): SemanticCacheEntry {
    const now = Date.now();
    this.maybePrune(now);
    const id = randomUUID();
    const expiresAt = now + Math.max(1, input.ttlMs);
    this.db
      .prepare(
        `INSERT INTO entries
          (id, namespace, query_text, embedding, payload, model, created_at, expires_at, hit_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        id,
        input.namespace,
        input.queryText,
        serializeEmbedding(input.embedding),
        input.payload,
        input.model,
        now,
        expiresAt,
      );
    return {
      id,
      namespace: input.namespace,
      queryText: input.queryText,
      embedding: input.embedding,
      payload: input.payload,
      model: input.model,
      createdAt: now,
      expiresAt,
      hitCount: 0,
    };
  }

  /**
   * Nearest neighbor within namespace by cosine similarity.
   * Skips expired rows; bumps hit_count on a threshold hit.
   */
  nearest(options: {
    namespace: string;
    embedding: number[];
    threshold: number;
    now?: number;
  }): SemanticCacheHit | null {
    const now = options.now ?? Date.now();
    this.maybePrune(now);
    const rows = this.db
      .prepare(
        `SELECT id, query_text, embedding, payload, hit_count
         FROM entries
         WHERE namespace = ? AND expires_at > ?`,
      )
      .all(options.namespace, now) as Array<{
      id: string;
      query_text: string;
      embedding: Buffer | Uint8Array;
      payload: string;
      hit_count: number;
    }>;

    let best: SemanticCacheHit | null = null;
    for (const row of rows) {
      const vec = deserializeEmbedding(row.embedding);
      if (!vec) continue;
      const score = cosineSimilarity(options.embedding, vec);
      if (score < options.threshold) continue;
      if (!best || score > best.score) {
        best = {
          id: row.id,
          payload: row.payload,
          score,
          queryText: row.query_text,
        };
      }
    }

    if (best) {
      this.db
        .prepare(
          `UPDATE entries SET hit_count = hit_count + 1 WHERE id = ?`,
        )
        .run(best.id);
    }
    return best;
  }

  /** Test helper: count live rows in a namespace. */
  count(namespace: string, now = Date.now()): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM entries WHERE namespace = ? AND expires_at > ?`,
      )
      .get(namespace, now) as { n: number };
    return Number(row?.n ?? 0);
  }
}

const storeByHome = new Map<string, SemanticCacheStore>();

/** Process-local store singleton per resolved agent home. */
export function getOrCreateSemanticCacheStore(
  agentHome: string,
): SemanticCacheStore {
  const key = path.resolve(agentHome);
  let store = storeByHome.get(key);
  if (!store) {
    store = new SemanticCacheStore(key);
    storeByHome.set(key, store);
  }
  return store;
}

/** Test helper: drop cached store instances (does not delete DB files). */
export function clearSemanticCacheStoreCache(): void {
  for (const store of storeByHome.values()) {
    try {
      store.close();
    } catch {
      // ignore
    }
  }
  storeByHome.clear();
}
