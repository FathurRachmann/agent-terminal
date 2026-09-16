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
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String((part as { text: unknown }).text);
          }
          return "";
        })
        .join(" ");
    }
  }
  return "";
}

/**
 * Cognitive layer: retrieve relevant durable memories (semantic + lexical)
 * and inject top-K into the system prompt. Never dumps raw session logs.
 */
export function createLongTermMemoryMiddleware(
  store: PersistentMemoryStore,
  options?: { limit?: number; embedder?: EmbeddingClient },
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

      // Prefer AGENTS.md for always-on rules/prefs (avoids double injection).
      // Long-term RAG is for episodes/facts/errors.
      const candidates = store
        .listWithEmbeddings({ limit: 400 })
        .filter((m) => m.kind !== "preference" && m.kind !== "rule");
      // Chat-context facts are durable corrections / "ingat…" — keep them eligible
      // for RAG (they are kind=fact with tag chat-context).
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
