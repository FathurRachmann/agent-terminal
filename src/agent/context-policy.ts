import { CONTEXT_SUMMARY_PROMPT } from "../prompts/system.js";

/**
 * Smaller default window + earlier summarization keeps per-turn input
 * from drifting into the 300k+ range on long coding sessions.
 *
 * Override via env:
 *   CONTEXT_WINDOW_TOKENS=128000
 *   SUMMARIZE_TRIGGER_RATIO=0.55   (0–1, fraction of window)
 *   KEEP_RECENT_RATIO=0.10
 */

function clampRatio(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(0.95, Math.max(0.2, n));
}

export const CONTEXT_WINDOW_TOKENS = Number(
  process.env.CONTEXT_WINDOW_TOKENS ?? 128_000,
);

export const SUMMARIZE_TRIGGER_RATIO = clampRatio(
  process.env.SUMMARIZE_TRIGGER_RATIO,
  0.55,
);

export const KEEP_RECENT_RATIO = clampRatio(
  process.env.KEEP_RECENT_RATIO,
  0.1,
);

/** Trigger before hard limit so there is room for summary + response. */
export const SUMMARIZE_TRIGGER_TOKENS = Math.floor(
  CONTEXT_WINDOW_TOKENS * SUMMARIZE_TRIGGER_RATIO,
);

/** Recent messages retained intact in the next window. */
export const KEEP_RECENT_TOKENS = Math.floor(
  CONTEXT_WINDOW_TOKENS * KEEP_RECENT_RATIO,
);

export const HISTORY_PATH_PREFIX = ".agent/context/history";

export { CONTEXT_SUMMARY_PROMPT };

export function describeContextPolicy(): string {
  return [
    `context_window=${CONTEXT_WINDOW_TOKENS}`,
    `summarize_trigger=${SUMMARIZE_TRIGGER_TOKENS} (${SUMMARIZE_TRIGGER_RATIO})`,
    `keep_recent=${KEEP_RECENT_TOKENS} (${KEEP_RECENT_RATIO})`,
  ].join(" ");
}
