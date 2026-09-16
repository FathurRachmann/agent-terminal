/**
 * Chat-context memories learned from ordinary conversation.
 * Complements engineering WHEN→DO rules and USER prefers/writes/asks style prefs.
 *
 * Canonical forms:
 *   CHAT remember: <durable instruction from the user>
 *   CHAT correction: <what went wrong → what to do instead>
 *   CHAT context: <standing fact / preference from chat>
 */

export type ChatContextKind = "remember" | "correction" | "context";

export type ChatContextItem = {
  kind: ChatContextKind;
  text: string;
  /** Short title for the memory store */
  title: string;
  importance: number;
};

const MAX_LEN = 220;

const REMEMBER_RE =
  /(?:^|\b)(?:ingat(?:lah)?|remember(?:\s+that)?|tolong\s+ingat|jangan\s+lupa)\s*[:\-]?\s+(.+)$/i;

const CORRECTION_RE =
  /\b(salah|keliru|bukan\s+begitu|bukan\s+itu|yang\s+benar|harusnya|seharusnya|jangan|don't|do\s+not|instead|actually|koreksi|salah\s+lagi|bukan\s+kayak\s+gini|fix\s+(?:ini|itu|dulu))\b/i;

/**
 * Deterministic extraction — no LLM required.
 * Looks at the user message (and lightly at the assistant reply for contrast).
 */
export function extractChatContextFromTurn(input: {
  userPrompt: string;
  assistantResponse?: string;
}): ChatContextItem[] {
  const prompt = String(input.userPrompt || "").trim();
  if (prompt.length < 3) return [];

  const out: ChatContextItem[] = [];
  const seen = new Set<string>();

  const push = (item: ChatContextItem | null) => {
    if (!item) return;
    const key = item.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  // 1) Explicit "ingat …" / "remember …"
  const rememberLine = prompt
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => REMEMBER_RE.test(l));
  if (rememberLine) {
    const m = rememberLine.match(REMEMBER_RE);
    const body = clean(m?.[1] || rememberLine);
    if (body.length >= 8) {
      push({
        kind: "remember",
        title: "Chat remember",
        text: `CHAT remember: ${truncate(body, MAX_LEN - 16)}`,
        importance: 0.88,
      });
    }
  }

  // 2) Corrections / pushback on the previous answer
  if (CORRECTION_RE.test(prompt) && prompt.length >= 8) {
    const corrected = summarizeCorrection(prompt);
    if (corrected) {
      push({
        kind: "correction",
        title: "Chat correction",
        text: `CHAT correction: ${corrected}`,
        importance: 0.9,
      });
    }
  }

  // 3) Standing context: "dari sekarang…", "selalu…", "next time…"
  const standing = extractStandingContext(prompt);
  if (standing) push(standing);

  return out.slice(0, 3);
}

function summarizeCorrection(prompt: string): string | null {
  let t = clean(prompt);
  // Prefer the clause after "harusnya/yang benar/instead"
  const after =
    t.match(
      /(?:yang\s+benar|harusnya|seharusnya|instead|actually|tolong)\s*[:\-]?\s*(.+)$/i,
    )?.[1] || t;
  const body = truncate(clean(after), MAX_LEN - 18);
  if (body.length < 8) return null;
  // Avoid storing pure venting without instruction
  if (/^(salah|no|salah\s+lagi)[.!]*$/i.test(body)) return null;
  return body;
}

function extractStandingContext(prompt: string): ChatContextItem | null {
  const t = clean(prompt);
  const m = t.match(
    /(?:^|\b)(?:dari\s+sekarang|mulai\s+sekarang|selalu|always|next\s+time|ke\s+depannya|kedepannya)\s*[,:]?\s*(.+)$/i,
  );
  if (!m?.[1]) return null;
  const body = truncate(clean(m[1]), MAX_LEN - 15);
  if (body.length < 8) return null;
  return {
    kind: "context",
    title: "Chat context",
    text: `CHAT context: ${body}`,
    importance: 0.75,
  };
}

export function isChatContextContent(text: string): boolean {
  return /^CHAT\s+(remember|correction|context):/i.test(text.trim());
}

function clean(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/g, "")
    .trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
