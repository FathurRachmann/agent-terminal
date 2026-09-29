import type { EmbeddingClient } from "../../memory/embeddings.js";
import {
  isSemanticCacheRoutingEnabled,
  routingCacheNamespace,
  withSemanticCache,
} from "../../memory/semantic-cache.js";
import type { SemanticCacheStore } from "../../memory/semantic-cache-store.js";
import type { WorkspaceBot } from "./bots.js";
import type { GroupChatReplyMode } from "./chats.js";
import { parseMentions } from "./mentions.js";

export type ReplyQueueResult = {
  botIds: string[];
  source: "mention" | "router" | "broadcast" | "none";
  reason: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Messages that address the whole team — every workspace bot should reply.
 * e.g. "halo semuanya", "hi everyone", "suruh semua anggota…"
 */
export function isAddressAllMessage(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  if (
    /semuanya+|semua\s*(orang|anggota|member|bot|tim)|seluruh\s*(tim|anggota|member)|everyone|everybody|all\s+of\s+you|the\s+whole\s+team/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /(suruh|minta|ajak|panggil)\s+semua/.test(t) ||
    /masing[-\s]?masing\s+(anggota|member|bot|orang)/.test(t) ||
    /tiap\s+(anggota|member|bot)/.test(t)
  ) {
    return true;
  }
  if (
    /\b(hi|hey|hello|halo|hai)\s+(team|guys|all|tim)\b/.test(t) ||
    /\b(pagi|siang|sore|malam)\s+(semua|tim|guys)\b/.test(t)
  ) {
    return true;
  }
  if (/^(halo|hai|hi|hey|hello)[\s,!]*(guys|team|tim)[\s!?.]*$/i.test(t)) {
    return true;
  }
  return false;
}

/** Leadership-first roster order for broadcasts (CTO → PM → SA → …). */
const BROADCAST_PRIORITY: Record<string, number> = {
  cto: 0,
  pm: 1,
  "product-manager": 1,
  "system-analyst": 2,
  sa: 2,
  fe: 3,
  be: 4,
  "tech-writer": 5,
  devops: 6,
  qa: 7,
};

export function sortBotsForBroadcast(bots: WorkspaceBot[]): WorkspaceBot[] {
  return [...bots].sort((a, b) => {
    const pa = BROADCAST_PRIORITY[a.id] ?? 50;
    const pb = BROADCAST_PRIORITY[b.id] ?? 50;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Heuristic router: score bots by keyword overlap with name/role/description/
 * skills/tools. Used when no @mentions and replyMode is auto. Falls back to first bot.
 */
export function heuristicRouteBots(
  message: string,
  bots: WorkspaceBot[],
  maxResponders: number,
): string[] {
  if (bots.length === 0) return [];
  const tokens = new Set(tokenize(message));
  if (tokens.size === 0) {
    return bots.slice(0, Math.min(maxResponders, 1)).map((b) => b.id);
  }

  const scored = bots.map((bot) => {
    const capabilityBlob = [
      bot.id,
      bot.name,
      bot.role ?? "",
      bot.description,
      bot.systemPrompt ?? "",
      ...(bot.skills ?? []),
      ...(bot.tools ?? []),
    ].join(" ");
    const hay = tokenize(capabilityBlob);
    let score = 0;
    for (const t of hay) {
      if (tokens.has(t)) score += 1;
    }
    // Strong boost when message tokens hit declared skills/tools directly.
    for (const skill of bot.skills ?? []) {
      for (const t of tokenize(skill)) {
        if (tokens.has(t)) score += 2;
      }
    }
    for (const tool of bot.tools ?? []) {
      for (const t of tokenize(tool)) {
        if (tokens.has(t)) score += 2;
      }
    }
    const blob = `${bot.role ?? ""} ${bot.description} ${(bot.skills ?? []).join(" ")}`.toLowerCase();
    if (/front|ui|react|css/.test(message.toLowerCase()) && /front|fe|ui|react/.test(blob))
      score += 3;
    if (/back|api|database|server/.test(message.toLowerCase()) && /back|be|api/.test(blob))
      score += 3;
    if (/test|qa|bug|regres/.test(message.toLowerCase()) && /qa|test/.test(blob))
      score += 3;
    if (/deploy|ci|docker|infra|ops/.test(message.toLowerCase()) && /devops|ops/.test(blob))
      score += 3;
    if (/doc|readme|tulis/.test(message.toLowerCase()) && /writer|doc/.test(blob))
      score += 3;
    if (
      /arsitektur|arsitecture|prioritas|roadmap/.test(message.toLowerCase()) &&
      /cto|pm|product/.test(blob)
    ) {
      score += 2;
    }
    return { id: bot.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const positive = scored.filter((s) => s.score > 0);
  const picked =
    positive.length > 0
      ? positive.slice(0, maxResponders)
      : scored.slice(0, 1);
  return picked.map((p) => p.id);
}

/**
 * Build ordered reply queue for a group-chat message.
 * Mentions win; address-all → every bot; otherwise router when mode is auto.
 */
export function buildReplyQueue(options: {
  message: string;
  bots: WorkspaceBot[];
  replyMode: GroupChatReplyMode;
  maxResponders: number;
}): ReplyQueueResult {
  const { message, bots, replyMode, maxResponders } = options;
  const mentions = parseMentions(message, bots);
  if (mentions.length > 0) {
    const botIds = mentions
      .map((m) => m.botId)
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .slice(0, Math.max(1, maxResponders));
    return {
      botIds,
      source: "mention",
      reason: `Mentioned: ${botIds.join(", ")}`,
    };
  }
  if (replyMode === "mention_only") {
    return {
      botIds: [],
      source: "none",
      reason: "mention_only: no @mention — no bot will reply",
    };
  }
  if (isAddressAllMessage(message) && bots.length > 0) {
    const botIds = sortBotsForBroadcast(bots)
      .map((b) => b.id)
      .slice(0, Math.max(1, maxResponders));
    return {
      botIds,
      source: "broadcast",
      reason: `Broadcast to all members: ${botIds.join(", ")}`,
    };
  }
  const botIds = heuristicRouteBots(message, bots, maxResponders);
  return {
    botIds,
    source: botIds.length ? "router" : "none",
    reason: botIds.length
      ? `Router selected: ${botIds.join(", ")}`
      : "No bots available",
  };
}

export type LlmRouteSemanticCache = {
  store: SemanticCacheStore;
  embedder: EmbeddingClient;
};

function parseRoutedBotIds(
  raw: string,
  bots: WorkspaceBot[],
  maxResponders: number,
): string[] | null {
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]!) as unknown;
    if (!Array.isArray(parsed)) return null;
    const valid = new Set(bots.map((b) => b.id));
    const ids = parsed
      .map((x) => String(x).trim())
      .filter((id) => valid.has(id))
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .slice(0, maxResponders);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/** Drop cached ids that are no longer in the roster. */
function filterValidBotIds(
  ids: string[],
  bots: WorkspaceBot[],
  maxResponders: number,
): string[] {
  const valid = new Set(bots.map((b) => b.id));
  return ids
    .filter((id) => valid.has(id))
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .slice(0, maxResponders);
}

export async function llmRouteBots(options: {
  message: string;
  bots: WorkspaceBot[];
  maxResponders: number;
  invoke: (system: string, user: string) => Promise<string>;
  /** Opt-in semantic cache; only used when SEMANTIC_CACHE_ROUTING is enabled. */
  semanticCache?: LlmRouteSemanticCache;
}): Promise<string[]> {
  const { message, bots, maxResponders, invoke, semanticCache } = options;
  if (bots.length === 0) return [];
  const catalog = bots
    .map((b) => {
      const skills = (b.skills ?? []).join(",") || "-";
      const tools = (b.tools ?? []).join(",") || "-";
      return `- id=${b.id} name=${b.name} role=${b.role ?? ""} desc=${b.description} skills=${skills} tools=${tools}`;
    })
    .join("\n");
  const system = `You route messages in a company division group chat to the best teammate bots by role, skills, and tools.
Return ONLY a JSON array of bot ids (max ${maxResponders}), e.g. ["fe","qa"].
Prefer the fewest bots that cover the request. Valid ids: ${bots.map((b) => b.id).join(", ")}`;
  const user = `Bots:\n${catalog}\n\nMessage:\n${message}`;

  const compute = async (): Promise<string[]> => {
    try {
      const raw = await invoke(system, user);
      const ids = parseRoutedBotIds(raw, bots, maxResponders);
      return ids ?? heuristicRouteBots(message, bots, maxResponders);
    } catch {
      return heuristicRouteBots(message, bots, maxResponders);
    }
  };

  const useCache =
    isSemanticCacheRoutingEnabled() &&
    semanticCache != null &&
    semanticCache.embedder.model !== "lexical-only";

  if (!useCache || !semanticCache) {
    return compute();
  }

  try {
    const cached = await withSemanticCache({
      store: semanticCache.store,
      embedder: semanticCache.embedder,
      namespace: routingCacheNamespace(bots, maxResponders),
      query: message,
      compute,
    });
    const filtered = filterValidBotIds(cached, bots, maxResponders);
    return filtered.length > 0
      ? filtered
      : heuristicRouteBots(message, bots, maxResponders);
  } catch {
    // Fail open: never block routing on cache errors.
    return compute();
  }
}

export async function buildReplyQueueWithOptionalLlm(options: {
  message: string;
  bots: WorkspaceBot[];
  replyMode: GroupChatReplyMode;
  maxResponders: number;
  llmInvoke?: (system: string, user: string) => Promise<string>;
  semanticCache?: LlmRouteSemanticCache;
}): Promise<ReplyQueueResult> {
  const base = buildReplyQueue(options);
  if (base.source !== "router") return base;

  // Prefer decision engine (Laya / heuristic) before burning an LLM call.
  try {
    const { routeBotsWithDecisionEngine } = await import(
      "../../decision/route-bots.js"
    );
    const decided = await routeBotsWithDecisionEngine({
      message: options.message,
      bots: options.bots,
      maxResponders: options.maxResponders,
    });
    if (decided?.botIds.length) {
      return {
        botIds: decided.botIds,
        source: "router",
        reason: decided.reason,
      };
    }
  } catch {
    /* fail open to LLM / heuristic */
  }

  if (!options.llmInvoke) return base;
  const botIds = await llmRouteBots({
    message: options.message,
    bots: options.bots,
    maxResponders: options.maxResponders,
    invoke: options.llmInvoke,
    semanticCache: options.semanticCache,
  });
  return {
    botIds,
    source: botIds.length ? "router" : "none",
    reason: botIds.length
      ? `LLM router selected: ${botIds.join(", ")}`
      : "No bots available",
  };
}
