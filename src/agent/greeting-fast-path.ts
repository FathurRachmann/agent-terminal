/**
 * Local greeting / small-talk fast-path — no LLM, no tools, no reflection.
 * Stops "halo" from burning tens of thousands of tokens on a full agent turn.
 */

const GREETING_RE =
  /^(?:hi+|hii+|hai+|halo+|hallo+|hello+|hey+|yo+|sup|test|ping|pong|pagi|siang|sore|malam|good\s+(?:morning|afternoon|evening)|selamat\s+(?:pagi|siang|sore|malam))(?:\s*[!?.…]*)?$/i;

/** True for standalone greetings / pings with no real task. */
export function isTrivialGreeting(prompt: string): boolean {
  const trimmed = String(prompt || "").trim();
  if (!trimmed || trimmed.length > 64) return false;
  // Reject if it looks like a task glued to a hello.
  if (/[?\n]/.test(trimmed) && !GREETING_RE.test(trimmed)) return false;
  if (
    /\b(tolong|please|bantu|help|buat|make|fix|cek|check|buka|open|cari|search)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return GREETING_RE.test(trimmed);
}

/** Short reply in the user's language — zero model tokens. */
export function greetingFastReply(prompt: string): string {
  const t = String(prompt || "").trim();
  const indonesian =
    /halo|hai|pagi|siang|sore|malam|selamat/i.test(t) ||
    !/^(hi+|hello+|hey+|yo+|sup|good\s+)/i.test(t);
  if (/pagi|morning/i.test(t)) {
    return indonesian
      ? "Selamat pagi! Ada yang bisa saya bantu?"
      : "Good morning! How can I help?";
  }
  if (/siang|afternoon/i.test(t)) {
    return indonesian
      ? "Selamat siang! Ada yang bisa saya bantu?"
      : "Good afternoon! How can I help?";
  }
  if (/sore|malam|evening/i.test(t)) {
    return indonesian
      ? "Halo! Ada yang bisa saya bantu?"
      : "Hi! How can I help?";
  }
  return indonesian
    ? "Halo! Ada yang bisa saya bantu?"
    : "Hi! How can I help?";
}
