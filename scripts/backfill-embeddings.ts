#!/usr/bin/env node
/**
 * Backfill missing embedding blobs in .agent/memory/persistent.sqlite
 * using the current EMBEDDING_MODEL via 9router.
 *
 * Usage: npx tsx scripts/backfill-embeddings.ts
 */
import "dotenv/config";
import path from "node:path";
import { PersistentMemoryStore } from "../src/memory/persistent-store.js";
import { createEmbeddingClientOrFallback } from "../src/memory/embeddings.js";

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
  const store = new PersistentMemoryStore(workspaceRoot);
  const embedder = createEmbeddingClientOrFallback();

  if (embedder.model === "lexical-only") {
    throw new Error("ROUTER_API_KEY missing — cannot backfill embeddings");
  }

  const all = store.listWithEmbeddings({ limit: 10_000 });
  const missing = all.filter((m) => !m.embedding || m.embedding.length === 0);

  process.stdout.write(
    `Workspace: ${workspaceRoot}\nModel: ${embedder.model}\nTotal: ${all.length} · missing: ${missing.length}\n`,
  );

  let ok = 0;
  let fail = 0;
  for (const memory of missing) {
    const text = `${memory.title}\n${memory.content}\n${memory.tags.join(" ")}`;
    try {
      const [vec] = await embedder.embed([text]);
      if (!vec?.length) {
        fail += 1;
        process.stderr.write(`fail ${memory.id}: empty vector\n`);
        continue;
      }
      store.setEmbedding(memory.id, vec);
      ok += 1;
      process.stdout.write(
        `ok ${ok}/${missing.length} ${memory.kind} ${memory.title.slice(0, 48)} (dim=${vec.length})\n`,
      );
    } catch (err) {
      fail += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fail ${memory.id}: ${msg.slice(0, 200)}\n`);
    }
  }

  const after = store.listWithEmbeddings({ limit: 10_000 });
  const withEmb = after.filter((m) => m.embedding && m.embedding.length > 0).length;
  store.close();

  process.stdout.write(
    `\nDone. embedded=${ok} failed=${fail} now_with_embedding=${withEmb}/${after.length}\n`,
  );
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
