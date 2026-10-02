import { extractResultPathsFromText } from "./renderer/activity-artifact.js";
import { restoreAbsolutePathPrefix } from "./path-normalize.js";

export { restoreAbsolutePathPrefix } from "./path-normalize.js";

/** Max WhatsApp / chat document payload we will send or accept (1 GiB). */
export const WA_DOCUMENT_MAX_BYTES = 1024 * 1024 * 1024;

/** Extensions that deserve an in-chat "File from agent" card when mentioned. */
const CHAT_CHIP_EXTS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "xlsm",
  "csv",
  "tsv",
  "ppt",
  "pptx",
  "md",
  "markdown",
  "mmd",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "html",
  "htm",
  "json",
  "dbml",
  "sql",
  "mp4",
  "mp3",
  "wav",
  "odt",
  "ods",
  "rtf",
]);

const MIME_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/ogg",
  webm: "audio/webm",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  docs: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
};

export function mimeForPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || filePath;
  const i = base.lastIndexOf(".");
  const ext = i >= 0 ? base.slice(i + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Any file-looking path (any extension) may be delivered over chat/WhatsApp. */
export function isDeliverableChatPath(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || filePath;
  if (!base || base === "." || base === "..") return false;
  return /\.[a-z0-9]{1,16}$/i.test(base);
}

/**
 * Reject prose false-positives: product names (Next.js), domains (a.go.id),
 * globs (*.js), and bare source filenames mentioned in architecture writeups.
 */
export function isProseFalsePositivePath(filePath: string): boolean {
  const p = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!p) return true;
  if (/[*?]/.test(p)) return true;
  if (/^https?:\/\//i.test(p)) return true;

  const base = p.split("/").pop() || p;
  if (
    /^(next|node|vue|nuxt|remix|react|angular|svelte|express|nest|deno|bun)\.js$/i.test(
      base,
    )
  ) {
    return true;
  }

  // DOM/Code-like false positives: document.doc, document.body, document.title, window.opener, etc.
  if (/^(document|window|element|node|process|global|console|navigator|location)\.[a-z0-9]+$/i.test(base)) {
    return true;
  }

  // Domain-like: simkopdes.go.id / example.com (2+ dots, no slash)
  if (!p.includes("/") && /^[\w-]+(?:\.[\w-]+){2,}$/i.test(p)) return true;

  // Bare source/config names in prose — only real when under a directory path.
  if (!p.includes("/")) {
    if (/\.(js|jsx|ts|tsx|mjs|cjs|css|scss|less|map|lock|vue)$/i.test(base)) {
      return true;
    }
    if (/^(cloudbuild|dockerfile|makefile|procfile|package)(\.|$)/i.test(base)) {
      return true;
    }
    if (/\.ya?ml$/i.test(base)) return true;
  }

  return false;
}

/**
 * Paths safe to show as in-chat file chips (not every `.js` mention in prose).
 * Always prefer `tmp/` (legacy `working/`) / absolute artifact paths / document-like extensions.
 */
export function isChatFileChipPath(filePath: string): boolean {
  const p = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!isDeliverableChatPath(p)) return false;
  if (isProseFalsePositivePath(p)) return false;

  const base = p.split("/").pop() || p;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (!CHAT_CHIP_EXTS.has(ext)) return false;

  if (
    /^tmp\//i.test(p) ||
    p.includes("/tmp/") ||
    /^working\//i.test(p) ||
    p.includes("/working/")
  )
    return true;
  if (p.startsWith("/")) return true;
  if (p.includes("/")) return true;
  // Bare `report.pdf` / `diagram.mmd` OK; bare `middleware.js` already rejected.
  return true;
}

/**
 * Broader path scrape for delivery — any extension inside quotes/backticks,
 * plus unquoted paths with a file extension.
 */
export function extractAnyFilePathsFromText(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    let p = restoreAbsolutePathPrefix(
      String(raw || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/[.,;:!?)\]}]+$/g, ""),
    );
    if (!p || seen.has(p)) return;
    if (!isDeliverableChatPath(p)) return;
    seen.add(p);
    found.push(p);
  };

  const tickRe = /`([^`\n]+?\.[a-z0-9]{1,16})`/gi;
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(text)) !== null) push(m[1] || "");
  const dqRe = /"([^"\n]+?\.[a-z0-9]{1,16})"/gi;
  while ((m = dqRe.exec(text)) !== null) push(m[1] || "");
  const sqRe = /'([^'\n]+?\.[a-z0-9]{1,16})'/gi;
  while ((m = sqRe.exec(text)) !== null) push(m[1] || "");
  // Prefer capturing a leading `/` so absolute paths stay absolute.
  const unquoted =
    /(?:^|[\s"'=`(,\[{])((?:\/|\.?\.?\/)?[\w./\\-]+\.[a-z0-9]{1,16})/gi;
  while ((m = unquoted.exec(text)) !== null) push(m[1] || "");

  return found.filter((p) => {
    if (p.includes("/")) return true;
    return !found.some(
      (other) =>
        other !== p &&
        other.includes("/") &&
        (other.endsWith(`/${p}`) ||
          other.endsWith(` ${p}`) ||
          other.endsWith(`-${p}`) ||
          other.endsWith(` - ${p}`)),
    );
  });
}

/** Collect unique deliverable paths from assistant text + optional extras. */
export function collectDeliverablePaths(
  texts: string[],
  extraPaths: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (p: string) => {
    const norm = restoreAbsolutePathPrefix(p.trim().replace(/\\/g, "/"));
    if (!norm || seen.has(norm)) return;
    if (!isDeliverableChatPath(norm)) return;
    if (isProseFalsePositivePath(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  for (const t of texts) {
    for (const p of extractResultPathsFromText(t)) push(p);
    for (const p of extractAnyFilePathsFromText(t)) push(p);
  }
  for (const p of extraPaths) {
    const norm = restoreAbsolutePathPrefix(p.trim().replace(/\\/g, "/"));
    if (!norm || seen.has(norm)) continue;
    if (!isDeliverableChatPath(norm)) continue;
    // Explicit write/edit paths always allowed even if prose filter would reject.
    seen.add(norm);
    out.push(norm);
  }
  return dropTruncatedBasenames(out);
}

/**
 * Drop bare basenames that are suffixes of a longer collected path
 * (e.g. "Digital.pdf" when "Kata Kami- … Pemerintah Digital.pdf" is present).
 */
export function dropTruncatedBasenames(paths: string[]): string[] {
  return paths.filter((p) => {
    const base = p.split("/").pop() || p;
    if (base.includes("/") || !base.includes(".")) return true;
    // Keep paths with directories.
    if (p.includes("/")) return true;
    return !paths.some((other) => {
      if (other === p) return false;
      const otherBase = other.split("/").pop() || other;
      if (otherBase === base) return false;
      return (
        otherBase.endsWith(`/${base}`) ||
        otherBase.endsWith(` ${base}`) ||
        otherBase.endsWith(`-${base}`) ||
        otherBase.endsWith(` - ${base}`) ||
        other.endsWith(`/${base}`) ||
        other.endsWith(` ${base}`) ||
        other.endsWith(`-${base}`) ||
        other.endsWith(` - ${base}`)
      );
    });
  });
}

/** Paths for in-chat file cards — stricter than WhatsApp path scrape. */
export function collectChatFileChipPaths(
  texts: string[],
  extraPaths: string[] = [],
): string[] {
  const extras = new Set(
    extraPaths.map((p) =>
      restoreAbsolutePathPrefix(p.trim().replace(/\\/g, "/")),
    ),
  );
  return collectDeliverablePaths(texts, extraPaths).filter(
    (p) => extras.has(p) || isChatFileChipPath(p),
  );
}
