import { CONTEXT_SUMMARY_PROMPT } from "../prompts/system.js";

export const CONTEXT_WINDOW_TOKENS = Number(
  process.env.CONTEXT_WINDOW_TOKENS ?? 256_000,
);

/** Trigger before hard limit so there is room for summary + response. */
export const SUMMARIZE_TRIGGER_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * 0.85);

/** Recent messages retained intact in the next window. */
export const KEEP_RECENT_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * 0.15);

export const HISTORY_PATH_PREFIX = ".agent/context/history";

export { CONTEXT_SUMMARY_PROMPT };

export function describeContextPolicy(): string {
  return [
    `context_window=${CONTEXT_WINDOW_TOKENS}`,
    `summarize_trigger=${SUMMARIZE_TRIGGER_TOKENS}`,
    `keep_recent=${KEEP_RECENT_TOKENS}`,
  ].join(" ");
}
