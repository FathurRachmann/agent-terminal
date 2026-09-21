import type { WorkspaceBot } from "./bots.js";

export type MentionMatch = {
  botId: string;
  raw: string;
  start: number;
  end: number;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse @mentions against workspace bots.
 * Matches @id, @Name (including multi-word names), @role, and compact @NameWithoutSpaces.
 */
export function parseMentions(
  text: string,
  bots: WorkspaceBot[],
): MentionMatch[] {
  if (!text || bots.length === 0) return [];

  type Candidate = { pattern: string; botId: string; displayLen: number };
  const candidates: Candidate[] = [];
  for (const bot of bots) {
    candidates.push({
      pattern: escapeRegExp(bot.id),
      botId: bot.id,
      displayLen: bot.id.length,
    });
    candidates.push({
      pattern: escapeRegExp(bot.name).replace(/\s+/g, "\\s+"),
      botId: bot.id,
      displayLen: bot.name.length,
    });
    if (bot.role) {
      candidates.push({
        pattern: escapeRegExp(bot.role).replace(/\s+/g, "\\s+"),
        botId: bot.id,
        displayLen: bot.role.length,
      });
    }
    const compact = bot.name.replace(/\s+/g, "");
    if (compact && compact.toLowerCase() !== bot.name.toLowerCase()) {
      candidates.push({
        pattern: escapeRegExp(compact),
        botId: bot.id,
        displayLen: compact.length,
      });
    }
  }
  candidates.sort((a, b) => b.displayLen - a.displayLen);

  const matches: MentionMatch[] = [];
  const seen = new Set<string>();
  const claimed = new Set<number>();

  for (const c of candidates) {
    if (seen.has(c.botId)) continue;
    const re = new RegExp(`@(${c.pattern})(?![\\w.-])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0]!.length;
      let overlap = false;
      for (let i = start; i < end; i += 1) {
        if (claimed.has(i)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      seen.add(c.botId);
      for (let i = start; i < end; i += 1) claimed.add(i);
      matches.push({
        botId: c.botId,
        raw: m[0]!,
        start,
        end,
      });
      break;
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}

export function stripMentions(text: string): string {
  // Remove @tokens including multi-word names (best-effort: @ then non-@ until boundary).
  return text
    .replace(/@[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\s+[A-Z][a-zA-Z0-9._-]*)*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Autocomplete candidates for composer `@` prefix. */
export function mentionSuggestions(
  query: string,
  bots: WorkspaceBot[],
  limit = 8,
): WorkspaceBot[] {
  const q = query.trim().toLowerCase();
  const scored = bots.map((bot) => {
    const hay = `${bot.id} ${bot.name} ${bot.role ?? ""}`.toLowerCase();
    let score = 0;
    if (!q) score = 1;
    else if (bot.id.startsWith(q) || bot.name.toLowerCase().startsWith(q))
      score = 3;
    else if (hay.includes(q)) score = 2;
    return { bot, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.bot.name.localeCompare(b.bot.name))
    .slice(0, limit)
    .map((s) => s.bot);
}
