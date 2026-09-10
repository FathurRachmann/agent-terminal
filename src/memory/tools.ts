import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import type { PersistentMemoryStore } from "./persistent-store.js";
import type { EmbeddingClient } from "./embeddings.js";
import { rankRelevantMemories } from "./relevance.js";
import { normalizeGuideline } from "./guideline.js";
import { normalizeUserPreference } from "./user-profile.js";
import type { MemoryKind } from "./types.js";

export function createMemoryTools(
  store: PersistentMemoryStore,
  workspaceRoot: string,
  embedder?: EmbeddingClient,
) {
  const agentsMdPath = path.join(workspaceRoot, ".agent", "AGENTS.md");

  const memoryStore = tool(
    async ({
      kind,
      title,
      content,
      tags,
      importance,
    }: {
      kind: MemoryKind;
      title: string;
      content: string;
      tags?: string[];
      importance?: number;
    }) => {
      let finalContent = content;
      let finalTags = tags;
      if (kind === "rule") {
        const normalized = normalizeGuideline(content);
        if (!normalized) {
          return (
            "Rejected rule: must fit standard form " +
            "`WHEN <condition> → DO <action>` (or a clear imperative)."
          );
        }
        finalContent = normalized.text;
        finalTags = [...(tags ?? []), "when-do"];
      } else if (kind === "preference") {
        const normalized = normalizeUserPreference(content);
        if (!normalized) {
          return (
            "Rejected preference: must fit `USER prefers|writes|asks <value>`."
          );
        }
        finalContent = normalized.text;
        finalTags = [...(tags ?? []), "user-style", normalized.kind];
      }
      const record = embedder
        ? await store.upsertWithEmbedding(
            {
              kind,
              title,
              content: finalContent,
              tags: finalTags,
              importance,
            },
            embedder,
          )
        : store.upsert({
            kind,
            title,
            content: finalContent,
            tags: finalTags,
            importance,
          });
      if (kind === "rule" || kind === "preference") {
        store.syncRulesToAgentsMd(agentsMdPath);
      }
      return `Stored ${record.kind} memory ${record.id}: ${record.content}`;
    },
    {
      name: "memory_store",
      description:
        "Persist a long-term memory (rule/fact/episode/error/preference). For kind=rule, content MUST be `WHEN <condition> → DO <action>`. For kind=preference, use `USER prefers|writes|asks …`.",
      schema: z.object({
        kind: z.enum(["rule", "fact", "episode", "error", "preference"]),
        title: z.string().describe("Short title for retrieval"),
        content: z
          .string()
          .describe(
            'For rules use: WHEN <condition> → DO <action>. Otherwise durable memory content.',
          ),
        tags: z.array(z.string()).optional(),
        importance: z.number().min(0).max(1).optional(),
      }),
    },
  );

  const memoryRecall = tool(
    async ({
      query,
      kind,
      limit,
    }: {
      query: string;
      kind?: MemoryKind;
      limit?: number;
    }) => {
      const candidates = kind
        ? store.listWithEmbeddings({ kind, limit: 400 })
        : store.listWithEmbeddings({ limit: 400 });

      let queryEmbedding: number[] | null = null;
      if (embedder) {
        try {
          const [vec] = await embedder.embed([query]);
          queryEmbedding = vec ?? null;
        } catch {
          queryEmbedding = null;
        }
      }

      const hits = rankRelevantMemories(
        query,
        candidates,
        limit ?? 8,
        queryEmbedding,
      );
      store.touch(hits.map((h) => h.id));
      if (hits.length === 0) {
        return "No relevant memories found.";
      }
      return hits
        .map(
          (h, i) =>
            `${i + 1}. [${h.kind}] (${h.score.toFixed(2)}) ${h.title}\n${h.content}`,
        )
        .join("\n\n");
    },
    {
      name: "memory_recall",
      description:
        "Search durable long-term memories by semantic + lexical relevance. Prefer this before repeating past debugging work.",
      schema: z.object({
        query: z.string(),
        kind: z.enum(["rule", "fact", "episode", "error", "preference"]).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
    },
  );

  /** Backward-compatible helper that writes a rule into persistent + AGENTS.md. */
  const rememberRule = tool(
    async ({ rule, section }: { rule: string; section?: string }) => {
      const normalized = normalizeGuideline(rule);
      if (!normalized) {
        return (
          "Rejected rule: use `WHEN <condition> → DO <action>` " +
          "(or a clear imperative like 'Never store API keys in memory')."
        );
      }
      const title = section?.trim() || "Known Pitfalls";
      const input = {
        kind: "rule" as const,
        title,
        content: normalized.text,
        tags: [
          "guideline",
          "when-do",
          title.toLowerCase().replace(/\s+/g, "-"),
        ],
        importance: 0.8,
      };
      const record = embedder
        ? await store.upsertWithEmbedding(input, embedder)
        : store.upsert(input);
      store.syncRulesToAgentsMd(agentsMdPath);
      return `Saved rule ${record.id}: ${normalized.text}`;
    },
    {
      name: "remember_rule",
      description:
        "Persist a guideline as `WHEN <condition> → DO <action>` into durable memory and .agent/AGENTS.md.",
      schema: z.object({
        rule: z
          .string()
          .describe("WHEN <condition> → DO <action> (or clear imperative)"),
        section: z
          .string()
          .optional()
          .describe('Section/title, default "Known Pitfalls".'),
      }),
    },
  );

  return [memoryStore, memoryRecall, rememberRule];
}
