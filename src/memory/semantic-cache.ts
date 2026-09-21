import type { EmbeddingClient } from "./embeddings.js";
import type { SemanticCacheStore } from "./semantic-cache-store.js";

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** In-process single-flight: one compute per namespace+vector key; others wait. */
const inflight = new Map<string, Promise<unknown>>();

export function isSemanticCacheRoutingEnabled(): boolean {
  const v = (process.env.SEMANTIC_CACHE_ROUTING ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function semanticCacheThreshold(): number {
  const raw = Number(process.env.SEMANTIC_CACHE_THRESHOLD);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return DEFAULT_THRESHOLD;
}

export function semanticCacheTtlMs(): number {
  const raw = Number(process.env.SEMANTIC_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_TTL_MS;
}

/**
 * Coarse hash of an embedding for single-flight keys.
 * Rounds components so near-identical vectors coalesce.
 */
export function coarseEmbeddingHash(embedding: number[]): string {
  const parts: string[] = [];
  const step = Math.max(1, Math.floor(embedding.length / 32));
  for (let i = 0; i < embedding.length; i += step) {
    parts.push((embedding[i] ?? 0).toFixed(3));
  }
  return parts.join(",");
}

export type WithSemanticCacheOptions<T> = {
  store: SemanticCacheStore;
  embedder: EmbeddingClient;
  namespace: string;
  query: string;
  /** Produce payload on miss; result is JSON-serialized into the cache. */
  compute: () => Promise<T>;
  serialize?: (value: T) => string;
  deserialize?: (payload: string) => T;
  threshold?: number;
  ttlMs?: number;
};

/**
 * Lookup → single-flight miss fill → store.
 * Fail open: any embed/store error runs `compute` without caching.
 */
export async function withSemanticCache<T>(
  options: WithSemanticCacheOptions<T>,
): Promise<T> {
  const serialize = options.serialize ?? ((v: T) => JSON.stringify(v));
  const deserialize =
    options.deserialize ?? ((payload: string) => JSON.parse(payload) as T);
  const threshold = options.threshold ?? semanticCacheThreshold();
  const ttlMs = options.ttlMs ?? semanticCacheTtlMs();

  // Noop / lexical-only embedder → skip cache (fail open to compute).
  if (options.embedder.model === "lexical-only") {
    return options.compute();
  }

  let embedding: number[];
  try {
    const vectors = await options.embedder.embed([options.query]);
    embedding = vectors[0] ?? [];
    if (embedding.length === 0) {
      return options.compute();
    }
  } catch {
    return options.compute();
  }

  try {
    const hit = options.store.nearest({
      namespace: options.namespace,
      embedding,
      threshold,
    });
    if (hit) {
      return deserialize(hit.payload);
    }
  } catch {
    return options.compute();
  }

  const flightKey = `${options.namespace}::${coarseEmbeddingHash(embedding)}`;
  const existing = inflight.get(flightKey) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<T> => {
    // Re-check under single-flight (another waiter may have filled the store).
    try {
      const again = options.store.nearest({
        namespace: options.namespace,
        embedding,
        threshold,
      });
      if (again) {
        return deserialize(again.payload);
      }
    } catch {
      // fail open below
    }

    const value = await options.compute();

    try {
      options.store.add({
        namespace: options.namespace,
        queryText: options.query,
        embedding,
        payload: serialize(value),
        model: options.embedder.model,
        ttlMs,
      });
    } catch {
      // fail open: still return value
    }

    return value;
  })().finally(() => {
    inflight.delete(flightKey);
  });

  inflight.set(flightKey, promise);
  return promise;
}

/** Clear in-flight map (tests). */
export function clearSemanticCacheInflight(): void {
  inflight.clear();
}

/**
 * Namespace for bot routing: version + catalog fingerprint + maxResponders.
 * Catalog changes (id/role/name/description) → different namespace → no stale hits.
 */
export function routingCacheNamespace(
  bots: Array<{
    id: string;
    role?: string;
    name?: string;
    description?: string;
  }>,
  maxResponders: number,
): string {
  const fingerprint = bots
    .map((b) => {
      const role = (b.role ?? "").trim().toLowerCase();
      const name = (b.name ?? "").trim().toLowerCase();
      const desc = (b.description ?? "").trim().toLowerCase();
      return `${b.id}:${role}:${name}:${desc}`;
    })
    .sort()
    .join("|");
  return `routing:v1:${fingerprint}:mr=${maxResponders}`;
}
