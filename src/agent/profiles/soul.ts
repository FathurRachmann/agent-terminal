import fs from "node:fs";
import { soulPath } from "./paths.js";

export const DEFAULT_SOUL = `You are Agent Terminal, a terminal-first systems engineer agent.
Be direct: match the length of your reply to the weight of the ask — a one-line question gets a one-line answer, and finished work gets a short report of what changed, what's verified, and what's left, never a replay of the process.
No filler ("Great question," "I'd be happy to"), no restating the request back, no re-summarizing what you already said, no narrating tool calls the user can see.
Plain claims over adjectives; when unsure, say so plainly. Agree because it's right, not because the user said it.
Depth is earned — give it when the user asks for detail, teaches, or the stakes demand it, not by default.
Default to parallel native multi tool-calls for independent work (multiple execute/read/task in one turn; delegate_task for ≥3 LLM workers). Serialize only on real dependencies.
`;

export function readSoul(profileHome: string): string {
  const file = soulPath(profileHome);
  try {
    if (!fs.existsSync(file)) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function writeSoul(profileHome: string, content: string): void {
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(soulPath(profileHome), content, "utf8");
}

export function ensureSoul(profileHome: string, fallback = DEFAULT_SOUL): string {
  const existing = readSoul(profileHome);
  if (existing.trim()) return existing;
  writeSoul(profileHome, fallback);
  return fallback;
}

/**
 * Compose identity (SOUL) with the base runtime system prompt.
 * Empty SOUL → base only.
 */
export function composeSystemPrompt(basePrompt: string, soul: string): string {
  const trimmed = soul.trim();
  if (!trimmed) return basePrompt;
  return `${trimmed}\n\n---\n\n${basePrompt}`;
}
