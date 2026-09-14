/**
 * Sanitize model / reflection text from OpenAI-compatible routers that leak
 * chain-of-thought or unclosed <think> blocks into content.
 */

import { isJunkGuideline as isJunkStandardGuideline } from "../memory/guideline.js";

const COT_OPENERS =
  /^(okay[,.]?\s+)?let'?s\s+(break\s+down|think|analyze|reason|start)|^(first|now)[,.]?\s+i\s+need\s+to\b|^the\s+user\s+(provided|asked|wants)\b/i;

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
  return isJunkStandardGuideline(t);
}

/**
 * Heuristic: model dumped unfinished reasoning instead of a user-facing answer.
 */
export function looksLikeIncompleteReasoning(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t) return true;
  if (COT_OPENERS.test(t)) {
    if (/[,:;]\s*$/.test(t)) return true;
    if (/\b(however|but|so|therefore|next)\s*,?\s*$/i.test(t)) return true;
    if (!/\n/.test(t) && t.length > 200 && !/[.!?]"?\s*$/.test(t)) return true;
    const hasStructure =
      /^#{1,3}\s|^\s*[-*]\s|`[^`]+`|\/[\w./-]+|\.ts\b|\.md\b/m.test(t);
    if (!hasStructure && t.length > 280) return true;
  }
  return false;
}

/** Router/provider notices (model sunset, switch model, Antigravity, etc.). */
export function looksLikeProviderNotice(text: string): boolean {
  const t = stripThinkBlocks(text).trim();
  if (!t || t.length > 1200) return false;
  return /\b(no longer available|model.*deactivated|model.*not found|switch to.*model|please switch|upgraded version|sunset|retired|antigravity)\b/i.test(
    t,
  );
}

/** Prefer reasoning-panel styling over a chat bubble. */
export function shouldRenderAsReasoning(text: string): boolean {
  return looksLikeProviderNotice(text) || looksLikeIncompleteReasoning(text);
}

export function sanitizeAssistantText(text: string): string {
  return stripThinkBlocks(text);
}
