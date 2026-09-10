/**
 * User personalization memories learned from ordinary chat.
 * Separate from engineering WHEN→DO rules.
 *
 * Canonical forms:
 *   USER prefers <preference>
 *   USER writes <style observation>
 *   USER asks <behavior pattern>
 */

export type UserPrefKind = "prefers" | "writes" | "asks";

export type StandardUserPreference = {
  text: string;
  kind: UserPrefKind;
  value: string;
};

const LINE_RE =
  /^USER\s+(prefers|writes|asks)\s+(.+)$/i;

const BANNED = [
  /okay,?\s+let'?s/i,
  /the user (task|wants|asked)/i,
  /<think>/i,
  /when\s+.+\s+→\s*do\s+/i,
  /gemini \d/i,
];

export function formatUserPreference(
  kind: UserPrefKind,
  value: string,
): string {
  return `USER ${kind} ${clean(value)}`;
}

export function normalizeUserPreference(
  raw: string,
): StandardUserPreference | null {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^[-*•]\s*/, "")
    .trim();
  if (!text || /^none\b/i.test(text)) return null;
  text =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (!text) return null;

  const m = text.match(LINE_RE);
  if (!m) return null;
  const kind = m[1]!.toLowerCase() as UserPrefKind;
  const value = clean(m[2]!);
  if (value.length < 4 || value.length > 140) return null;
  if (BANNED.some((re) => re.test(value))) return null;
  return {
    kind,
    value,
    text: formatUserPreference(kind, value),
  };
}

/**
 * Deterministic signals from a single user message — works without LLM.
 */
export function extractUserPreferencesFromChat(userPrompt: string): StandardUserPreference[] {
  const t = userPrompt.trim();
  if (t.length < 2) return [];
  const out: StandardUserPreference[] = [];
  const lower = t.toLowerCase();

  const idHits =
    (lower.match(
      /\b(yang|dengan|untuk|bisa|tolong|dong|banget|kaga|ga|gak|udah|aja|kok|lah|buset|gue|lo|lu|nih|sih|dong)\b/g,
    ) ?? []).length;
  const enHits =
    (lower.match(/\b(the|and|please|could|would|what|how|why|fix|show)\b/g) ??
      []).length;

  if (idHits >= 3 && idHits > enHits + 1) {
    out.push(
      pref(
        "prefers",
        "Indonesian replies with a natural conversational tone",
      ),
    );
  } else if (
    enHits >= 4 &&
    enHits > idHits + 1 &&
    !/\b(fix|build|npm|git|error|bug|implement|refactor)\b/i.test(t)
  ) {
    out.push(pref("prefers", "English replies"));
  }

  if (
    /\b(buset|wkwk|wkwkwk|lol|anjir|gila)\b/i.test(t) ||
    (/\b(gue|lo|lu)\b/i.test(t) && idHits >= 2)
  ) {
    out.push(
      pref("writes", "informal / slangy Indonesian (match the casual tone)"),
    );
  }

  if (t.length <= 40 && !/[?]/.test(t) && idHits + enHits >= 1) {
    out.push(pref("writes", "short direct messages; reply concisely first"));
  }

  if (
    /^(ringkas|jelaskan|apa|bagaimana|kenapa|how|what|why|explain|summar)/i.test(
      t,
    )
  ) {
    out.push(
      pref("asks", "explanatory / summary questions; lead with a clear structure"),
    );
  }

  if (/\/Users\/|~\/|Desktop\/|Documents\//.test(t)) {
    out.push(
      pref(
        "asks",
        "to work on local folders by path; use request_folder_access and wait for approval",
      ),
    );
  }

  if (/\b(lebih rapi|rapihin|format|bikin.*jelas)\b/i.test(t)) {
    out.push(pref("prefers", "clean readable formatting over dense walls of text"));
  }

  if (/\b(personal|kebiasaan|gaya|tone)\b/i.test(t)) {
    out.push(pref("prefers", "personalized behavior based on past chats"));
  }

  // Dedup + cap burst so one message does not flood the profile.
  const seen = new Set<string>();
  const ranked = out.filter((p) => {
    if (seen.has(p.text)) return false;
    seen.add(p.text);
    return true;
  });
  const priority = (p: StandardUserPreference) =>
    p.kind === "prefers" ? 0 : p.kind === "writes" ? 1 : 2;
  return ranked.sort((a, b) => priority(a) - priority(b)).slice(0, 2);
}

function pref(kind: UserPrefKind, value: string): StandardUserPreference {
  return {
    kind,
    value,
    text: formatUserPreference(kind, value),
  };
}

function clean(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
}

/** Casual chat should still teach user style (not engineering rules). */
export function shouldLearnUserStyle(input: {
  skipEpisode?: boolean;
  userPrompt: string;
}): boolean {
  if (input.skipEpisode) return false;
  return input.userPrompt.trim().length >= 2;
}
