import { extractResultPathsFromText } from "./renderer/activity-artifact.js";

/** Max WhatsApp / chat document payload we will send or accept (1 GiB). */
export const WA_DOCUMENT_MAX_BYTES = 1024 * 1024 * 1024;

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
 * Broader path scrape for delivery — any extension inside quotes/backticks,
 * plus unquoted paths with a file extension.
 */
export function extractAnyFilePathsFromText(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    let p = String(raw || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/[.,;:!?)\]}]+$/g, "");
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
  const unquoted =
    /(?:^|[\s"'=`(,\[{])((?:\.?\.?\/)?[\w./\\-]+\.[a-z0-9]{1,16})/gi;
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
    const norm = p.trim().replace(/\\/g, "/");
    if (!norm || seen.has(norm)) return;
    if (!isDeliverableChatPath(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  for (const t of texts) {
    for (const p of extractResultPathsFromText(t)) push(p);
    for (const p of extractAnyFilePathsFromText(t)) push(p);
  }
  for (const p of extraPaths) push(p);
  return out;
}
