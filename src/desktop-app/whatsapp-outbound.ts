/**
 * WhatsApp outbound hygiene: no local paths in chat text,
 * attach only user-facing deliverables (never generator scripts).
 */
import { isChatFileChipPath, isProseFalsePositivePath } from "./file-delivery-shared.js";

/** Extensions that must never be attached on WhatsApp (generators / source). */
const WA_BLOCKED_ATTACH_EXTS = new Set([
  "py",
  "pyw",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "pl",
  "lua",
  "r",
  "ipynb",
  "makefile",
  "cmake",
  "gradle",
  "sql",
  "dbml",
  "json",
  "yml",
  "yaml",
  "toml",
  "lock",
  "env",
  "log",
]);

function extensionOf(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || filePath;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

/**
 * True when this path may be sent as a WhatsApp document.
 * PDF/Office/images/archives OK — generator scripts (.py) stay in tmp only.
 */
export function isWhatsAppAttachablePath(filePath: string): boolean {
  const p = String(filePath || "").trim().replace(/\\/g, "/");
  if (!p) return false;
  if (isProseFalsePositivePath(p)) return false;
  const ext = extensionOf(p);
  if (!ext || WA_BLOCKED_ATTACH_EXTS.has(ext)) return false;
  // Reuse chip allowlist (pdf/docx/png/…) — excludes random binaries.
  return isChatFileChipPath(p);
}

/**
 * Strip absolute / home / tmp paths from WhatsApp chat text so we don't leak
 * "Lokasi File: /Users/…" — the document attach is enough.
 */
export function sanitizeWhatsAppOutboundText(text: string): string {
  let t = String(text || "");
  if (!t.trim()) return t;

  // Drop whole lines that are only a "lokasi file" / path announcement.
  t = t
    .split("\n")
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      if (/^(?:📍\s*)?(?:\*?lokasi\s*file\*?\s*:|file\s*(?:path|location)\s*:)/i.test(s)) {
        return false;
      }
      // Line that is mostly just a filesystem path
      if (
        /^(?:📍\s*)?(?:path|saved(?:\s+at)?|wrote|output)\s*:?\s*/i.test(s) &&
        /(?:\/Users\/|\/home\/|~\/|[A-Za-z]:\\)/.test(s)
      ) {
        return false;
      }
      return true;
    })
    .join("\n");

  // Absolute Unix / macOS paths (optionally in backticks or bold)
  t = t.replace(
    /(?:`|\*{0,2})?(?:\/(?:Users|home|var|tmp|private|Volumes)\/[^\s`*"'<>\]|]+|~\/[^\s`*"'<>\]|]+)(?:`|\*{0,2})?/g,
    "",
  );
  // Windows absolute paths
  t = t.replace(
    /(?:`|\*{0,2})?[A-Za-z]:\\[^\s`*"'<>\]|]+(?:`|\*{0,2})?/g,
    "",
  );
  // Agent artifact relatives often pasted as `tmp/bots/foo.py`
  t = t.replace(
    /`((?:tmp|working)\/[^`\n]+?\.(?:py|js|ts|tsx|mjs|cjs|sh))`/gi,
    "",
  );

  // Clean leftover labels like "Lokasi File:" with empty value
  t = t.replace(
    /(?:📍\s*)?(?:\*?lokasi\s*file\*?\s*:|file\s*(?:path|location)\s*:)\s*/gi,
    "",
  );
  // Collapse excess blank lines / spaces left by removals
  t = t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return t;
}

/** Extra system nudge for WhatsApp turns. */
export const WA_OUTBOUND_HYGIENE_INSTRUCTION = [
  "[WhatsApp outbound rules]",
  "Do NOT print local file paths, absolute paths, or 'Lokasi File:' in the chat reply.",
  "When a document is ready, say briefly that it is done (filename only is OK) — the app will attach the file.",
  "Generator scripts (create_*.py, make_*.py, etc.) must stay in tmp/ only — never tell the user to download them and never list them as deliverables.",
].join(" ");
