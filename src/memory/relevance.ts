import type { MemoryRecord, MemorySearchHit } from "./types.js";
import { cosineSimilarity } from "./embeddings.js";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "with",
  "this",
  "that",
  "it",
  "as",
  "at",
  "by",
  "from",
  "use",
  "using",
  "used",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./+-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function lexicalScore(queryTokens: Set<string>, memory: MemoryRecord): number {
  if (queryTokens.size === 0) return memory.importance;
  const corpus = tokenize(
    `${memory.title} ${memory.content} ${memory.tags.join(" ")} ${memory.kind}`,
  );
  const corpusSet = new Set(corpus);
  let overlap = 0;
  for (const token of queryTokens) {
    if (corpusSet.has(token)) overlap += 1;
  }
  const coverage = overlap / queryTokens.size;
  const density = corpus.length === 0 ? 0 : overlap / Math.sqrt(corpus.length);
  return coverage * 0.7 + density * 0.3;
}

function recencyBoost(memory: MemoryRecord): number {
  const now = Date.now();
  const ageDays = Math.max(0, (now - memory.updatedAt) / (1000 * 60 * 60 * 24));
  return 1 / (1 + ageDays / 14);
}

/**
 * Long-term Memory ranking — hybrid semantic (cosine) + lexical fallback.
 */
export function rankRelevantMemories(
  query: string,
  candidates: Array<MemoryRecord & { embedding?: number[] | null }>,
  limit = 8,
  queryEmbedding?: number[] | null,
): MemorySearchHit[] {
  const queryTokens = new Set(tokenize(query));

  const scored: MemorySearchHit[] = candidates.map((memory) => {
    const lexical = lexicalScore(queryTokens, memory);
    let semantic = 0;
    if (queryEmbedding && memory.embedding && memory.embedding.length > 0) {
      semantic = Math.max(0, cosineSimilarity(queryEmbedding, memory.embedding));
    }
    const accessBoost = Math.min(0.15, memory.accessCount * 0.01);
    const kindBoost = memory.kind === "preference" ? 0.08 : 0;
    const score =
      (queryEmbedding ? semantic * 0.65 + lexical * 0.2 : lexical * 0.75) +
      memory.importance * 0.1 +
      recencyBoost(memory) * 0.05 +
      accessBoost +
      kindBoost;

    return { ...memory, score };
  });

  return scored
    .filter((m) => m.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatMemoriesForPrompt(hits: MemorySearchHit[]): string {
  if (hits.length === 0) return "";
  const prefs = hits.filter((h) => h.kind === "preference");
  const other = hits.filter((h) => h.kind !== "preference");
  const lines = [
    "",
    "# Relevant long-term memories",
    "Honor user preferences for tone/language/style. Prefer fresh tool evidence for factual conflicts.",
    "",
  ];
  if (prefs.length > 0) {
    lines.push("## User personalization");
    for (const hit of prefs) {
      lines.push(`- ${hit.content}`);
    }
    lines.push("");
  }
  if (other.length > 0) {
    lines.push("## Task memories");
    for (const hit of other) {
      const tags = hit.tags.length ? ` [${hit.tags.join(", ")}]` : "";
      lines.push(
        `- (${hit.kind}, score=${hit.score.toFixed(2)}${tags}) ${hit.title}: ${hit.content}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
