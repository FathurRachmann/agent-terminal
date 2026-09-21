import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PersistentMemoryStore } from "./persistent-store.js";
import type { EmbeddingClient } from "./embeddings.js";
import type { SessionStore } from "./session-store.js";
import { tokenize } from "./relevance.js";
import { stripThinkBlocks } from "../agent/sanitize-output.js";
import {
  deterministicGuideline,
  normalizeGuideline,
  shouldAttemptLlmRule,
  type StandardGuideline,
} from "./guideline.js";
import {
  extractUserPreferencesFromChat,
  normalizeUserPreference,
  shouldLearnUserStyle,
  type StandardUserPreference,
} from "./user-profile.js";
import {
  extractChatContextFromTurn,
} from "./chat-context.js";
import path from "node:path";

export type ReflectionInput = {
  threadId: string;
  userPrompt: string;
  assistantResponse: string;
  hadError?: boolean;
  errorMessage?: string;
  /** Skip episode when the turn had no usable answer (e.g. leaked CoT). */
  skipEpisode?: boolean;
  /** Extra tags for workspace/bot isolation (e.g. workspace:it, bot:cto). */
  scopeTags?: string[];
};

/**
 * Cognitive compression:
 * - episodes/errors from the turn
 * - engineering rules (WHEN → DO) when a durable lesson exists
 * - user preferences from ordinary chat (USER prefers/writes/asks)
 * - chat context from corrections / "ingat…" / standing instructions
 */
export async function reflectAndStore(options: {
  store: PersistentMemoryStore;
  sessionStore: SessionStore;
  embedder: EmbeddingClient;
  model?: BaseChatModel;
  input: ReflectionInput;
  agentsMdPath: string;
}): Promise<{ storedIds: string[] }> {
  const { store, sessionStore, embedder, model, input, agentsMdPath } = options;
  const storedIds: string[] = [];
  let synced = false;

  if (!input.skipEpisode) {
    const episode = await store.upsertWithEmbedding(
      {
        kind: input.hadError ? "error" : "episode",
        title: truncate(input.userPrompt, 80),
        content: buildEpisodeContent(input),
        tags: [
          "auto-reflection",
          input.hadError ? "failure" : "success",
          ...(input.scopeTags ?? []),
          ...extractTags(input.userPrompt),
        ],
        importance: input.hadError ? 0.85 : 0.55,
      },
      embedder,
    );
    storedIds.push(episode.id);

    sessionStore.appendTranscript({
      threadId: input.threadId,
      role: "reflection",
      content: episode.content,
      meta: { memoryId: episode.id, kind: episode.kind },
    });
  }

  const guideline = await resolveGuideline(model, input);
  if (guideline && !isDuplicateContent(store, "rule", guideline.text)) {
    const saved = await store.upsertWithEmbedding(
      {
        kind: "rule",
        title: "Known Pitfalls",
        content: guideline.text,
        tags: ["auto-reflection", "guideline", "when-do", ...(input.scopeTags ?? [])],
        importance: 0.8,
      },
      embedder,
    );
    storedIds.push(saved.id);
    sessionStore.appendTranscript({
      threadId: input.threadId,
      role: "reflection",
      content: `rule: ${guideline.text}`,
      meta: { memoryId: saved.id, kind: "rule" },
    });
    synced = true;
  }

  // Ordinary chat → learn user style / wording / behavior (personalization).
  if (shouldLearnUserStyle(input)) {
    const prefs = await resolveUserPreferences(model, input);
    for (const pref of prefs) {
      if (isDuplicateContent(store, "preference", pref.text)) continue;
      const saved = await store.upsertWithEmbedding(
        {
          kind: "preference",
          title: "User preferences",
          content: pref.text,
          tags: ["auto-reflection", "user-style", pref.kind, ...(input.scopeTags ?? [])],
          importance: 0.7,
        },
        embedder,
      );
      storedIds.push(saved.id);
      sessionStore.appendTranscript({
        threadId: input.threadId,
        role: "reflection",
        content: `preference: ${pref.text}`,
        meta: { memoryId: saved.id, kind: "preference" },
      });
      synced = true;
    }
  }

  // Chat context → corrections, "ingat …", standing instructions from conversation.
  const chatItems = extractChatContextFromTurn({
    userPrompt: input.userPrompt,
    assistantResponse: input.assistantResponse,
  });
  for (const item of chatItems) {
    if (isDuplicateChatContext(store, item.text)) continue;
    const saved = await store.upsertWithEmbedding(
      {
        kind: "fact",
        title: item.title,
        content: item.text,
        tags: ["auto-reflection", "chat-context", item.kind, ...(input.scopeTags ?? [])],
        importance: item.importance,
      },
      embedder,
    );
    storedIds.push(saved.id);
    sessionStore.appendTranscript({
      threadId: input.threadId,
      role: "reflection",
      content: `chat-context: ${item.text}`,
      meta: { memoryId: saved.id, kind: "fact", chatKind: item.kind },
    });
    synced = true;
  }

  if (synced) {
    store.syncRulesToAgentsMd(agentsMdPath);
  }

  await compressOldEpisodes(store, embedder);
  return { storedIds };
}

async function resolveGuideline(
  model: BaseChatModel | undefined,
  input: ReflectionInput,
): Promise<StandardGuideline | null> {
  if (input.skipEpisode) return null;

  const deterministic = deterministicGuideline(input);
  if (deterministic) return deterministic;

  if (!model || !shouldAttemptLlmRule(input)) return null;

  try {
    return await extractRuleWithModel(model, input);
  } catch {
    return null;
  }
}

async function extractRuleWithModel(
  model: BaseChatModel,
  input: ReflectionInput,
): Promise<StandardGuideline | null> {
  const prompt = `Extract at most ONE durable coding-agent guideline.
If nothing non-obvious was learned, reply with exactly: NONE

You MUST reply in EXACTLY this format (one line, no markdown, no quotes):
WHEN <short condition> → DO <short imperative action>

Bad (rejected):
- explanations, essays, architecture summaries
- "Okay let's…", YAGNI, model availability notes
- anything not WHEN…→ DO…

User task: ${input.userPrompt}
Assistant result: ${truncate(input.assistantResponse, 800)}
Error: ${input.hadError ? input.errorMessage ?? "yes" : "no"}`;

  const result = await model.invoke([
    new SystemMessage(
      "You only emit standard WHEN → DO guidelines or NONE. Never explain.",
    ),
    new HumanMessage(prompt),
  ]);
  const text =
    typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content
            .map((p) =>
              typeof p === "string"
                ? p
                : p && typeof p === "object" && "text" in p
                  ? String((p as { text: unknown }).text)
                  : "",
            )
            .join("")
        : String(result.content ?? "");
  return normalizeGuideline(stripThinkBlocks(text));
}

async function resolveUserPreferences(
  model: BaseChatModel | undefined,
  input: ReflectionInput,
): Promise<StandardUserPreference[]> {
  const fromChat = extractUserPreferencesFromChat(input.userPrompt);
  const out: StandardUserPreference[] = [...fromChat];

  // Optional LLM refinement — only when deterministic signals were weak.
  if (
    model &&
    fromChat.length === 0 &&
    input.userPrompt.trim().length >= 12 &&
    input.userPrompt.trim().length <= 280
  ) {
    try {
      const extra = await extractUserPrefWithModel(model, input);
      if (extra) out.push(extra);
    } catch {
      /* ignore */
    }
  }

  const seen = new Set<string>();
  return out.filter((p) => {
    if (seen.has(p.text.toLowerCase())) return false;
    seen.add(p.text.toLowerCase());
    return true;
  });
}

async function extractUserPrefWithModel(
  model: BaseChatModel,
  input: ReflectionInput,
): Promise<StandardUserPreference | null> {
  const prompt = `Observe ONLY the user's wording/behavior (not engineering lessons).
If nothing personalization-worthy, reply NONE.

Reply with EXACTLY one line in one of these forms:
USER prefers <preference>
USER writes <style>
USER asks <pattern>

User message: ${truncate(input.userPrompt, 400)}
Assistant reply (context only): ${truncate(input.assistantResponse, 300)}`;

  const result = await model.invoke([
    new SystemMessage(
      "You emit a single USER prefers/writes/asks line or NONE. No essays.",
    ),
    new HumanMessage(prompt),
  ]);
  const text =
    typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content
            .map((p) =>
              typeof p === "string"
                ? p
                : p && typeof p === "object" && "text" in p
                  ? String((p as { text: unknown }).text)
                  : "",
            )
            .join("")
        : String(result.content ?? "");
  return normalizeUserPreference(stripThinkBlocks(text));
}

function isDuplicateContent(
  store: PersistentMemoryStore,
  kind: "rule" | "preference",
  text: string,
): boolean {
  const existing = store.list({ kind, limit: 200 });
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const valueKey =
    kind === "preference"
      ? norm.replace(/^user\s+(prefers|writes|asks)\s+/, "")
      : norm;
  return existing.some((r) => {
    const other = r.content.toLowerCase().replace(/\s+/g, " ").trim();
    const otherKey =
      kind === "preference"
        ? other.replace(/^user\s+(prefers|writes|asks)\s+/, "")
        : other;
    if (other === norm || other.includes(norm) || norm.includes(other)) {
      return true;
    }
    // Near-dup preferences: same kind prefix + highly overlapping value.
    if (kind === "preference" && valueKey.length >= 12 && otherKey.length >= 12) {
      if (otherKey.includes(valueKey) || valueKey.includes(otherKey)) return true;
      const a = new Set(valueKey.split(" ").filter((w) => w.length > 3));
      const b = new Set(otherKey.split(" ").filter((w) => w.length > 3));
      if (a.size === 0 || b.size === 0) return false;
      let overlap = 0;
      for (const w of a) if (b.has(w)) overlap += 1;
      return overlap / Math.min(a.size, b.size) >= 0.7;
    }
    return false;
  });
}

function isDuplicateChatContext(
  store: PersistentMemoryStore,
  text: string,
): boolean {
  const existing = store
    .list({ kind: "fact", limit: 200 })
    .filter((r) => r.tags.includes("chat-context"));
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  const kindMatch = norm.match(/^chat\s+(remember|correction|context):\s*/);
  const kind = kindMatch?.[1] ?? "";
  const body = norm.replace(/^chat\s+(remember|correction|context):\s*/, "");
  return existing.some((r) => {
    const other = r.content.toLowerCase().replace(/\s+/g, " ").trim();
    const otherKind =
      other.match(/^chat\s+(remember|correction|context):\s*/)?.[1] ?? "";
    // Only dedupe within the same chat-context kind
    if (kind && otherKind && kind !== otherKind) return false;
    if (other === norm) return true;
    const otherBody = other.replace(
      /^chat\s+(remember|correction|context):\s*/,
      "",
    );
    if (body.length >= 12 && otherBody.length >= 12) {
      if (otherBody.includes(body) || body.includes(otherBody)) return true;
    }
    return false;
  });
}

async function compressOldEpisodes(
  store: PersistentMemoryStore,
  embedder: EmbeddingClient,
): Promise<void> {
  const episodes = store.list({ kind: "episode", limit: 200 });
  if (episodes.length < 40) return;

  const old = episodes.slice(25);
  const summary = old
    .slice(0, 20)
    .map((e) => `- ${e.title}: ${truncate(e.content, 120)}`)
    .join("\n");
  await store.upsertWithEmbedding(
    {
      kind: "fact",
      title: "Compressed episode history",
      content: `Older episodes compressed:\n${summary}`,
      tags: ["compression", "auto-reflection"],
      importance: 0.4,
    },
    embedder,
  );
  for (const e of old) {
    store.delete(e.id);
  }
}

function buildEpisodeContent(input: ReflectionInput): string {
  const parts = [
    `Task: ${input.userPrompt}`,
    `Outcome: ${truncate(input.assistantResponse, 1500)}`,
  ];
  if (input.hadError) {
    parts.push(`Error: ${input.errorMessage ?? "unknown"}`);
  }
  return parts.join("\n");
}

function extractTags(text: string): string[] {
  return tokenize(text).slice(0, 6);
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function agentsMdPathFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "AGENTS.md");
}
