/**
 * Sanitize model / reflection text from OpenAI-compatible routers that leak
 * chain-of-thought or unclosed <think> blocks into content.
 */

import { isJunkGuideline as isJunkStandardGuideline } from "../memory/guideline.js";
import { looksLikeTextToolCallDump } from "./parse-text-tool-calls.js";

const COT_OPENERS =
  /^(okay[,.]?\s+)?let'?s\s+(break\s+down|think|analyze|reason|start)|^(first|now)[,.]?\s+i\s+(need\s+to|should|can|will|am\s+going\s+to)\b|^the\s+user\s+(provided|asked|wants|greeted|said|wrote|sent|messaged)\b|^(first|okay|so)[,.]?\s+the\s+user\b|^i\s+(should|can|will|need\s+to)\s+(start\s+by\s+)?(explore|exploring|check|checking|list|listing|look|looking|use|using|run|running)\b/i;

/** Model narrates how it will reply instead of actually replying. */
const RESPONSE_PLANNING =
  /\b(my response should|i('ll| will) (respond|go with|make sure|keep it)|i\s+need\s+to\s+remember\s+to\s+keep\s+my\s+response|respond in (english|indonesian|bahasa)|avoiding any lengthy|match the user'?s language|the response should be|keep (my response|it) (friendly|concise|short|natural)|adheres? to (the )?(guidelines|system prompt|soul)|from (past interactions|memory and guidelines)|looking back[,.]?\s+the guidelines|typically for .+ users)\b/i;

/** Model narrates intended tool use instead of calling tools / answering. */
const TOOL_PLAN_NARRATION =
  /\b(i\s+(can|should|will|need\s+to)\s+use\s+(the\s+)?(available\s+)?(tools?|[`']?(ls|read_file|execute|glob|grep|eslint|tslint))|i('ll| will)\s+start\s+by\s+(listing|exploring|checking|using)|use\s+the\s+[`']?ls[`']?\s+command|start\s+by\s+(listing|exploring)\b|first[,.]?\s+i\s+should\s+start\s+by|check\s+if\s+there'?s\s+a\s+[`']?readme|using\s+[`']?(ls|read_file|glob|grep|execute)[`']?)\b/i;

export function stripThinkBlocks(text: string): string {
  let out = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/think>/gi, "");
  const open = out.search(/<think>/i);
  if (open >= 0) {
    const after = out.slice(open).replace(/^<think>/i, "");
    const split = after.split(/\n\s*\n/);
    out =
      open > 0
        ? `${out.slice(0, open)}${split.length > 1 ? split.slice(1).join("\n\n") : ""}`
        : split.length > 1
          ? split.slice(1).join("\n\n")
          : "";
  }
  return out.trim();
}

/** Reject guidelines that fail the standard WHEN → DO format. */
export function isJunkGuideline(text: string): boolean {
  const t = stripThinkBlocks(text).replace(/^[-*]\s*/, "").trim();
  if (!t || /^none\b/i.test(t)) return true;
  if (/^<\/?think>$/i.test(t)) return true;
  if (COT_OPENERS.test(t)) return true;
  if (RESPONSE_PLANNING.test(t) && t.length > 120) return true;
  return isJunkStandardGuideline(t);
}

/** True when the model is drafting how to answer instead of answering. */
export function looksLikeResponsePlanning(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t || t.length < 80) return false;
  const opens =
    COT_OPENERS.test(t) ||
    /^(first|okay|so)[,.]?\s+the\s+user\b/i.test(t);
  const plans = RESPONSE_PLANNING.test(t);
  if (!(opens || plans)) return false;
  // Short real replies that happen to mention "response" are OK.
  if (t.length < 160 && /^(halo|hai|hi|hello|hey|ya|iya|oke|siap)\b/i.test(t)) {
    return false;
  }
  // Planning monologues are usually long and self-referential.
  const metaHits = (
    t.match(
      /\b(my response|i('ll| will| should)|guidelines|system prompt|soul\.md|keep it (friendly|concise)|respond in)\b/gi,
    ) ?? []
  ).length;
  return plans || (opens && metaHits >= 2 && t.length > 180);
}

/**
 * Pull a short quoted reply the model planned but never delivered.
 * e.g. … Something like "Halo! Ada yang bisa saya bantu?" would be perfect …
 */
export function salvageUserFacingAnswer(text: string): string | null {
  const t = stripThinkBlocks(text).trim();
  if (!t || !looksLikeResponsePlanning(t)) return null;

  const quotes = [
    ...t.matchAll(/["“]([^"”\n]{3,160})["”]/g),
    ...t.matchAll(/'([^'\n]{3,120})'/g),
  ]
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);

  const score = (q: string): number => {
    let s = 0;
    if (/^(halo|hai|hi|hello|hey|pagi|siang|sore)\b/i.test(q)) s += 5;
    if (/[!?]$/.test(q)) s += 2;
    if (q.length <= 100) s += 2;
    if (/\b(should|guidelines|response|typically|english|indonesian)\b/i.test(q))
      s -= 4;
    if (/^(okay|first|the user)\b/i.test(q)) s -= 5;
    return s;
  };

  let best: string | null = null;
  let bestScore = 0;
  for (const q of quotes) {
    let sc = score(q);
    // Prefer replies matching the user's language when the monologue mentions it.
    if (
      /\bindonesian|bahasa\b/i.test(t) &&
      /[àáâãäåèéêëìíîïòóôõöùúûüńç]|halo|hai|pagi|siang|sore|bantu/i.test(q)
    ) {
      sc += 3;
    }
    if (sc >= bestScore && sc >= 4) {
      bestScore = sc;
      best = q;
    }
  }
  return best;
}

/**
 * Heuristic: model dumped unfinished reasoning instead of a user-facing answer.
 */
export function looksLikeIncompleteReasoning(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t) return true;
  if (looksLikeToolPlanNarration(t)) return true;
  if (looksLikeResponsePlanning(t)) return true;
  if (COT_OPENERS.test(t)) {
    if (/[,:;]\s*$/.test(t)) return true;
    if (/\b(however|but|so|therefore|next)\s*,?\s*$/i.test(t)) return true;
    if (!/\n/.test(t) && t.length > 200 && !/[.!?]"?\s*$/.test(t)) return true;
    const hasStructure =
      /^#{1,3}\s|^\s*[-*]\s|`[^`]+`|\/[\w./-]+|\.ts\b|\.md\b/m.test(t);
    if (!hasStructure && t.length > 280) return true;
    // Long first-person planning monologue without a clear answer.
    if (
      /\bi\s+(should|can|will|need to)\b/i.test(t) &&
      t.length > 220 &&
      !/^(ya|iya|bisa|sudah|oke|siap|berikut|hasil|halo|hai|hi|hello)\b/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

/** Narrates ls/read_file plans instead of returning evidence-based answers. */
export function looksLikeToolPlanNarration(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t || t.length < 40) return false;
  const firstShould = /first[,.]?\s+i\s+should\b/i.test(t);
  const futureToolPlan =
    TOOL_PLAN_NARRATION.test(t) ||
    firstShould ||
    (/\b(i\s+(can|should|will|need\s+to)|i('ll| will))\b/i.test(t) &&
      /[`'](ls|read_file|execute|glob|grep|eslint|tslint)[`']/i.test(t));
  if (!futureToolPlan && !COT_OPENERS.test(t)) return false;
  // Real answers that mention tools in past tense / with results are OK.
  if (
    /\b(i\s+(ran|listed|found|read|checked)|saya\s+(sudah|melihat|menemukan|cek)|hasil\s+ls|isi\s+(folder|project)|berikut\s+(struktur|isi))\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return futureToolPlan;
}

/** Router/provider notices (model sunset, switch model, Antigravity, etc.). */
export function looksLikeProviderNotice(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t || t.length > 1200) return false;
  return /\b(no longer available|model.*deactivated|model.*not found|switch to.*model|please switch|upgraded version|sunset|retired|antigravity|upstream error|service temporarily overloaded|overloaded)\b/i.test(
    t,
  );
}

/**
 * Best-effort extract of a suggested replacement model id from a provider notice.
 * e.g. "switch to Gemini 3.7 Flash" → "Gemini 3.7 Flash"
 */
export function extractSuggestedModel(text: string): string | null {
  const t = stripThinkBlocks(text).trim();
  if (!t) return null;
  // Do not treat "." as a terminator — model ids often include versions (3.7).
  const patterns = [
    /switch to\s+([A-Za-z0-9][A-Za-z0-9 ._+/-]{2,64}?)(?:\s+in\b|\s+on\b|\s+instead\b|[!,;]|$)/i,
    /use\s+([A-Za-z0-9][A-Za-z0-9 ._+/-]{2,64}?)\s+instead\b/i,
    /upgrade(?:d)?\s+to\s+([A-Za-z0-9][A-Za-z0-9 ._+/-]{2,64}?)(?:\s+in\b|\s+on\b|[!,;]|$)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = m[1]
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[.,;:]+$/, "");
      if (name.length >= 3 && name.length <= 80) return name;
    }
  }
  return null;
}

/** Prefer reasoning-panel styling over a chat bubble. */
export function shouldRenderAsReasoning(text: string): boolean {
  if (looksLikeTextToolCallDump(text)) return false;
  if (salvageUserFacingAnswer(text)) return false;
  return looksLikeProviderNotice(text) || looksLikeIncompleteReasoning(text);
}

export function sanitizeAssistantText(text: string): string {
  const stripped = stripThinkBlocks(text);
  if (looksLikeTextToolCallDump(stripped)) return "";
  const salvaged = salvageUserFacingAnswer(stripped);
  return salvaged ?? stripped;
}

/**
 * Merge streamed draft vs done payload.
 * Prefer a complete answer over incomplete CoT; otherwise keep the longer text
 * (helps when the done payload was truncated).
 * Drops JSON tool-call dumps (complete or truncated) so they never become the bubble.
 */
export function resolveFinalAssistantText(
  eventText: string | undefined,
  draft: string,
): string {
  const scrub = (raw: string): string => {
    const t = stripThinkBlocks(raw).trim();
    if (!t || looksLikeTextToolCallDump(t)) return "";
    return t;
  };
  const rawEvent = scrub(String(eventText ?? ""));
  const rawDraft = scrub(draft);
  const salvaged =
    salvageUserFacingAnswer(rawEvent) || salvageUserFacingAnswer(rawDraft);
  if (salvaged) return salvaged;

  const fromEvent = rawEvent;
  const fromDraft = rawDraft;
  if (!fromEvent && !fromDraft) return "";
  if (!fromEvent) return fromDraft;
  if (!fromDraft) return fromEvent;
  const eventBad = looksLikeIncompleteReasoning(fromEvent);
  const draftBad = looksLikeIncompleteReasoning(fromDraft);
  if (draftBad && !eventBad) return fromEvent;
  if (eventBad && !draftBad) return fromDraft;
  return fromDraft.length > fromEvent.length ? fromDraft : fromEvent;
}
