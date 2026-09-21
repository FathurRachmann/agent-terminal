import { createMiddleware } from "langchain";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { PersistentMemoryStore } from "./persistent-store.js";
import type { EmbeddingClient } from "./embeddings.js";
import {
  formatMemoriesForPrompt,
  rankRelevantMemories,
} from "./relevance.js";

function extractLastUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as {
      content?: unknown;
      type?: string;
      getType?: () => string;
    };
    const type = msg?.getType?.() ?? msg?.type;
    const isHuman =
      type === "human" ||
      HumanMessage.isInstance(msg) ||
      (msg &&
        typeof msg === "object" &&
        "role" in msg &&
        (msg as { role: string }).role === "user");
    if (!isHuman) continue;
    const content = msg.content;
    let raw = "";
    if (typeof content === "string") raw = content;
    else if (Array.isArray(content)) {
      raw = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String((part as { text: unknown }).text);
          }
          return "";
        })
        .join(" ");
    }
    return stripTurnPrefixes(raw);
  }
  return "";
}

/** Drop injected working-scope / bot instruction wrappers for RAG query. */
function stripTurnPrefixes(text: string): string {
  const t = String(text || "");
  const userMarker = t.lastIndexOf("\n[USER]\n");
  if (userMarker >= 0) return t.slice(userMarker + "\n[USER]\n".length).trim();
  if (t.startsWith("[USER]\n")) return t.slice("[USER]\n".length).trim();
  return t.trim();
}

/**
 * Cognitive layer: retrieve relevant durable memories (semantic + lexical)
 * and inject top-K into the system prompt. Never dumps raw session logs.
 */
export function createLongTermMemoryMiddleware(
  store: PersistentMemoryStore,
  options?: {
    limit?: number;
    embedder?: EmbeddingClient;
    /** When set, only memories matching these tags (all must match) are retrieved. */
    requiredTags?: string[];
    /** Mutable getter so desktop can switch workspace bot scope per turn. */
    getRequiredTags?: () => string[] | undefined;
  },
) {
  const limit = options?.limit ?? 8;
  const embedder = options?.embedder;

  return createMiddleware({
    name: "LongTermMemoryMiddleware",
    wrapModelCall: async (request, handler) => {
      const messages = request.state?.messages ?? request.messages ?? [];
      const query = extractLastUserText(messages as unknown[]);
      if (!query.trim()) {
        return handler(request);
      }

      const required =
        options?.getRequiredTags?.() ?? options?.requiredTags ?? undefined;

      // Prefer AGENTS.md for always-on rules/prefs (avoids double injection).
      // Long-term RAG is for episodes/facts/errors.
      const candidates = store
        .listWithEmbeddings({ limit: 400 })
        .filter((m) => m.kind !== "preference" && m.kind !== "rule")
        .filter((m) => {
          if (!required || required.length === 0) {
            // Unscoped turns: exclude workspace/bot-private memories
            return !m.tags.some(
              (t) => t.startsWith("workspace:") || t.startsWith("bot:"),
            );
          }
          return required.every((tag) => m.tags.includes(tag));
        });
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
        limit,
        queryEmbedding,
      );
      if (hits.length === 0) {
        return handler(request);
      }

      store.touch(hits.map((h) => h.id));
      const section = formatMemoriesForPrompt(hits);

      const existingContent = request.systemMessage?.content;
      const existingBlocks =
        typeof existingContent === "string"
          ? [{ type: "text" as const, text: existingContent }]
          : Array.isArray(existingContent)
            ? existingContent
            : [];

      const systemMessage = new SystemMessage({
        content: [
          ...existingBlocks,
          {
            type: "text",
            text: section,
          },
        ],
      });

      return handler({
        ...request,
        systemMessage,
      });
    },
  });
}
