/**
 * Standard guideline format for long-term rules.
 * Keeps rotating / weak models from polluting AGENTS.md with prose junk.
 *
 * Canonical form:
 *   WHEN <condition> → DO <action>
 */

const WHEN_DO_RE =
  /^WHEN\s+(.+?)\s*(?:→|->|=>)\s*DO\s+(.+)$/i;

const BANNED_SUBSTRINGS = [
  /okay,?\s+let'?s/i,
  /the user (task|wants|asked|provided)/i,
  /assistant (was|provided|result)/i,
  /<think>/i,
  /arsitektur sistem/i,
  /consists of \d+ layer/i,
  /gemini \d/i,
  /no longer available/i,
  /switch to gemini/i,
  /antigravity/i,
  /yagni/i,
  /first rule is always/i,
  /\[0\.0:\]/i,
  /decline requests that require exceeding/i,
  /propose compliant alternatives/i,
  /cannot open (chrome|urls?|applications?)/i,
  /ask (them|the user) to (copy|paste|open).*(link|url|chrome)/i,
];

const ACTION_VERBS =
  /^(use|never|always|prefer|pin|call|ask|reject|keep|avoid|do|don't|store|delete|run|check|confirm|grant|block|require|read|write|limit|switch|set|update|install|retry|fall\s*back)\b/i;

export type StandardGuideline = {
  /** Canonical "WHEN … → DO …" text */
  text: string;
  when: string;
  do: string;
};

export function formatStandardGuideline(when: string, action: string): string {
  const w = cleanClause(when);
  const d = cleanClause(action);
  return `WHEN ${w} → DO ${d}`;
}

/**
 * Parse model output into the standard form, or null if unusable.
 * Accepts:
 * - WHEN x → DO y
 * - WHEN: x | DO: y
 * - a single imperative sentence (wrapped as WHEN this situation recurs → DO …)
 */
export function normalizeGuideline(raw: string): StandardGuideline | null {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^"+|"+$/g, "")
    .trim();

  if (!text || /^none\b/i.test(text)) return null;

  // Prefer first non-empty line
  text = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";
  if (!text) return null;

  // WHEN: … | DO: …
  const pipe = text.match(
    /^WHEN:\s*(.+?)\s*\|\s*DO:\s*(.+)$/i,
  );
  if (pipe) {
    return build(pipe[1]!, pipe[2]!);
  }

  const arrow = text.match(WHEN_DO_RE);
  if (arrow) {
    return build(arrow[1]!, arrow[2]!);
  }

  // Bare imperative → wrap in standard envelope only if it looks actionable
  const imperative = cleanClause(text);
  if (!isPlausibleAction(imperative)) return null;
  if (looksLikeBannedProse(imperative)) return null;
  return build("this situation recurs", imperative);
}

export function isValidStandardGuideline(text: string): boolean {
  return normalizeGuideline(text) !== null;
}

/** Stricter junk detector used by reflection + remember_rule. */
export function isJunkGuideline(text: string): boolean {
  return normalizeGuideline(text) === null;
}

function build(when: string, action: string): StandardGuideline | null {
  const w = cleanClause(when);
  const d = cleanClause(action);
  if (w.length < 4 || d.length < 8) return null;
  if (w.length > 120 || d.length > 160) return null;
  if (looksLikeBannedProse(w) || looksLikeBannedProse(d)) return null;
  if (!isPlausibleAction(d) && !ACTION_VERBS.test(d)) return null;
  const formatted = formatStandardGuideline(w, d);
  if (formatted.length > 220) return null;
  return { text: formatted, when: w, do: d };
}

function cleanClause(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/g, "")
    .replace(/[.]+$/g, "")
    .trim();
}

function isPlausibleAction(s: string): boolean {
  if (s.length < 8) return false;
  if (/^[\[\d\.\:\s]+/.test(s) && s.length < 40) return false;
  // Must contain at least one verb-ish token or start with known verb
  if (ACTION_VERBS.test(s)) return true;
  // Allow "call X", "ask for Y" mid-ish
  if (/\b(call|ask|use|avoid|never|always|require|confirm|switch|pin|set)\b/i.test(s)) {
    return true;
  }
  return false;
}

function looksLikeBannedProse(s: string): boolean {
  for (const re of BANNED_SUBSTRINGS) {
    if (re.test(s)) return true;
  }
  // Multi-clause narration
  if ((s.match(/,/g) ?? []).length >= 3 && s.length > 100) return true;
  if (/\b(translates to|outlining|explaining)\b/i.test(s)) return true;
  return false;
}

/**
 * Deterministic rules for common failure modes — no LLM needed.
 */
export function deterministicGuideline(
  input: {
    userPrompt: string;
    assistantResponse: string;
    hadError?: boolean;
    errorMessage?: string;
  },
): StandardGuideline | null {
  const blob = [
    input.userPrompt,
    input.assistantResponse,
    input.errorMessage ?? "",
  ]
    .join("\n")
    .toLowerCase();

  if (
    /outside allowed|request_folder_access|workspace confinement|permission_denied/.test(
      blob,
    )
  ) {
    return build(
      "the user names a folder outside the current allowlist",
      "call request_folder_access immediately (opens Approve/Deny UI) — never rely on chat-only permission",
    );
  }

  if (input.hadError && /embed|embedding/.test(blob)) {
    return build(
      "embeddings requests fail via the router",
      "switch EMBEDDING_MODEL to a working provider id from /models/embedding and backfill",
    );
  }

  if (
    input.hadError &&
    /langsmith|experimental\/sandbox/.test(blob)
  ) {
    return build(
      "langsmith misses ./experimental/sandbox",
      "pin langsmith to ^0.9.0 in package.json",
    );
  }

  if (
    /api[_-]?key|token|password|credential/.test(blob) &&
    /memory|store|remember/.test(blob)
  ) {
    return build(
      "handling secrets or credentials",
      "never store API keys tokens or passwords in memory transcripts or AGENTS.md",
    );
  }

  return null;
}

/** Only spend an LLM call when a durable lesson is likely. */
export function shouldAttemptLlmRule(input: {
  hadError?: boolean;
  skipEpisode?: boolean;
  userPrompt: string;
  assistantResponse: string;
}): boolean {
  if (input.skipEpisode) return false;
  if (input.hadError) return true;
  const text = `${input.userPrompt}\n${input.assistantResponse}`.toLowerCase();
  // Skip pure Q&A / summarization turns — they produce junk guidelines.
  if (
    /^(ringkas|jelaskan|apa|what|why|how|explain|summar)/i.test(
      input.userPrompt.trim(),
    )
  ) {
    return false;
  }
  if (/fixed|pin |workaround|root cause|guardrail|allowlist/.test(text)) {
    return true;
  }
  return false;
}
