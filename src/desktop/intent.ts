/**
 * Deterministic intents for desktop automation when the LLM refuses tool use.
 */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

/** Bare site names users type without https:// */
const SITE_ALIASES: Array<{ re: RegExp; url: string; label: string }> = [
  { re: /\b(you\s*tube|youtu\.?be|yt)\b/i, url: "https://www.youtube.com/", label: "youtube" },
  { re: /\b(google)\b/i, url: "https://www.google.com/", label: "google" },
  { re: /\b(gmail)\b/i, url: "https://mail.google.com/", label: "gmail" },
  { re: /\b(github)\b/i, url: "https://github.com/", label: "github" },
  { re: /\b(twitter|x\.com)\b/i, url: "https://x.com/", label: "twitter" },
  { re: /\b(instagram|ig)\b/i, url: "https://www.instagram.com/", label: "instagram" },
  { re: /\b(spotify)\b/i, url: "https://open.spotify.com/", label: "spotify" },
  { re: /\b(reddit)\b/i, url: "https://www.reddit.com/", label: "reddit" },
  { re: /\b(whatsapp)\b/i, url: "https://web.whatsapp.com/", label: "whatsapp" },
];

export type DesktopIntent =
  | { kind: "open_url"; url: string; app: string }
  | { kind: "open_app"; app: string };

/**
 * Detect "open this URL in Chrome" / "buka YouTube" / "buka Chrome" style requests.
 */
export function parseDesktopIntent(prompt: string): DesktopIntent | null {
  const text = prompt.trim();
  if (!text) return null;

  const openVerb = /\b(buka|bukain|open|launch|navigate|kunjungi|visit|go\s+to|tampilkan|setel|play|putar)\b/i.test(
    text,
  );
  const wantsChrome =
    /\b(chrome|google\s*chrome)\b/i.test(text) ||
    /\b(browser|browsernya)\b/i.test(text);

  const urlMatch = text.match(URL_RE);
  if (urlMatch && (wantsChrome || openVerb || looksLikeSiteOpen(text))) {
    const url = normalizeHttpUrl(urlMatch[0]!);
    if (!url) return null;
    return { kind: "open_url", url, app: "Google Chrome" };
  }

  // Explicit "buka Chrome" / "open Google Chrome" (app, not google.com)
  if (
    openVerb &&
    /\b(google\s*)?chrome\b/i.test(text) &&
    !urlMatch &&
    !/\b(you\s*tube|youtu\.?be|yt)\b/i.test(text)
  ) {
    return { kind: "open_app", app: "Google Chrome" };
  }

  // "buka YouTube …" / "open youtube and play …" without full URL
  if (openVerb || isPlayMusicFollowUp(text)) {
    const site = resolveSiteAlias(text);
    if (site) {
      return { kind: "open_url", url: site.url, app: "Google Chrome" };
    }
  }

  return null;
}

function resolveSiteAlias(
  text: string,
): { url: string; label: string } | null {
  for (const site of SITE_ALIASES) {
    // Don't map "Google Chrome" → google.com
    if (site.label === "google" && /\bchrome\b/i.test(text)) continue;
    if (site.re.test(text)) {
      return { url: site.url, label: site.label };
    }
  }
  return null;
}

function normalizeHttpUrl(raw: string): string | null {
  let url = raw.replace(/[.,;:!?]+$/, "");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function looksLikeSiteOpen(text: string): boolean {
  return /\b(buka|bukain|open|launch)\b/i.test(text);
}

/**
 * Text after the open-URL / open-app part that still needs doing
 * (e.g. "setel lagu yg lagi viral").
 */
export function extractDesktopFollowUp(
  prompt: string,
  intent: DesktopIntent,
): string | null {
  let rest = prompt.trim();

  if (intent.kind === "open_url") {
    rest = rest.replace(intent.url, " ");
    try {
      const host = new URL(intent.url).hostname.replace(/^www\./, "");
      rest = rest.replace(
        new RegExp(
          `https?://(www\\.)?${escapeRegExp(host)}[^\\s]*`,
          "ig",
        ),
        " ",
      );
      // Strip alias words for that host (youtube, yt, …)
      if (/youtube|youtu\.be/i.test(host)) {
        rest = rest.replace(/\b(you\s*tube|youtu\.?be|yt)\b/gi, " ");
      }
    } catch {
      /* ignore */
    }
  }

  rest = rest
    .replace(/\b(google\s*)?chrome\b/gi, " ")
    .replace(
      /\b(buka|bukain|open|launch|navigate|kunjungi|visit|go\s+to|tampilkan|di|in|the|dengan|ke)\b/gi,
      " ",
    )
    .replace(/\b(dan|lalu|terus|then|and|after\s+that)\b/gi, " ")
    // Strip site aliases left over after resolving bare names → URLs
    .replace(
      /\b(you\s*tube|youtu\.?be|yt|whatsapp|instagram|ig|spotify|github|gmail|reddit|twitter)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  rest = rest.replace(/^[\s,.;:!?/-]+|[\s,.;:!?/-]+$/g, "").trim();

  if (rest.length < 4) return null;
  if (/^(dong|ya|aja|please|pls|web)$/i.test(rest)) return null;
  return rest;
}

/**
 * If user asked to play/search music on YouTube, open a search/results URL instead of the homepage.
 */
export function enrichDesktopIntent(
  intent: DesktopIntent,
  prompt: string,
): DesktopIntent {
  if (intent.kind !== "open_url") return intent;
  let host = "";
  try {
    host = new URL(intent.url).hostname.replace(/^www\./, "");
  } catch {
    return intent;
  }
  if (!/youtube\.com|youtu\.be/i.test(host)) return intent;

  const followUp = extractDesktopFollowUp(prompt, intent) ?? prompt;
  if (
    !/\b(setel|play|putar|lagu|viral|music|musik|song|trending|cari|search)\b/i.test(
      followUp,
    )
  ) {
    return intent;
  }

  const query = extractMusicSearchQuery(followUp);
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return { kind: "open_url", url: searchUrl, app: intent.app };
}

export function extractMusicSearchQuery(followUp: string): string {
  const cleaned = followUp
    .replace(
      /\b(setel|play|putar|cari|search|tolong|dong|aja|yg|yang|lagi|saat\s+ini|sekarang|any|apapun|you\s*tube|yt)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 3) return cleaned;
  return "lagu viral";
}

/** True when the leftover ask is essentially play/search music. */
export function isPlayMusicFollowUp(followUp: string | null): boolean {
  if (!followUp) return false;
  return /\b(setel|play|putar|lagu|viral|music|musik|song|trending)\b/i.test(
    followUp,
  );
}

export function buildDesktopFollowUpPrompt(input: {
  openedSummary: string;
  followUp: string;
  app: string;
}): string {
  return [
    input.openedSummary,
    "",
    `Remaining user request (MUST complete now with desktop_automate on ${input.app}):`,
    input.followUp,
    "",
    "Rules:",
    "- You CAN control Chrome via desktop_automate. Never refuse.",
    "- Prefer keystroke actions: e.g. text=\"/\" then type a query, or text=\"l\" with modifiers=[\"cmd\"] for the address bar.",
    "- For YouTube results already open: activate_app, wait briefly (keystroke is fine), then keystroke to focus/play (e.g. Tab/Enter) or open_url a more specific video search if needed.",
    "- Call desktop_automate as many times as needed until the remaining request is done, then briefly confirm in Indonesian.",
  ].join("\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
