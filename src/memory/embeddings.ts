/**
 * OpenAI-compatible embeddings via Model Hub (semantic long-term memory).
 */
export type EmbeddingClient = {
  embed(texts: string[]): Promise<number[][]>;
  model: string;
};

/** Lexical-only stub when ROUTER_API_KEY / embeddings are unavailable. */
export function createNoopEmbeddingClient(): EmbeddingClient {
  return {
    model: "lexical-only",
    async embed(_texts: string[]): Promise<number[][]> {
      return [];
    },
  };
}

export function createEmbeddingClient(): EmbeddingClient {
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("ROUTER_API_KEY is not set");
  }
  const baseURL = (
    process.env.ROUTER_BASE_URL ?? "http://127.0.0.1:27128/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const timeoutMs = Number(process.env.EMBEDDING_TIMEOUT_MS ?? 20_000);

  return {
    model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${baseURL}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: texts.length === 1 ? texts[0] : texts,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `Embeddings request failed (${response.status}): ${body.slice(0, 300)}`,
          );
        }
        const json = (await response.json()) as {
          data?: Array<{ embedding: number[]; index: number }>;
        };
        const data = json.data ?? [];
        return data
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
      } catch (err) {
        // undici often throws TypeError("terminated") on abort/TLS drop.
        const name = err instanceof Error ? err.name : "";
        const msg = err instanceof Error ? err.message : String(err);
        if (
          name === "AbortError" ||
          /aborted|terminated|econnreset|socket hang up|fetch failed/i.test(msg)
        ) {
          throw new Error(
            `Embeddings request aborted or network dropped (${timeoutMs}ms): ${msg}`,
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Prefer real embeddings; fall back to lexical-only when key missing. */
export function createEmbeddingClientOrFallback(): EmbeddingClient {
  if (!process.env.ROUTER_API_KEY) return createNoopEmbeddingClient();
  return createEmbeddingClient();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function serializeEmbedding(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i += 1) {
    buf.writeFloatLE(vec[i] ?? 0, i * 4);
  }
  return buf;
}

export function deserializeEmbedding(buf: Buffer | Uint8Array | null): number[] | null {
  if (!buf || buf.byteLength === 0) return null;
  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (view.byteLength % 4 !== 0) return null;
  const out: number[] = [];
  for (let i = 0; i < view.byteLength; i += 4) {
    out.push(view.readFloatLE(i));
  }
  return out;
}
