/**
 * Split markdown into leading prose + titled sections for collapsible UI.
 * Recognizes ATX ##/### headings and bold-only titles between thematic breaks.
 */
export type MdChunk =
  | { type: "prose"; markdown: string }
  | {
      type: "section";
      title: string;
      markdown: string;
      /** Non-empty line count (for default open/closed). */
      lineCount: number;
    };

const ATX_RE = /^#{2,3}\s+(.+)$/;
const BOLD_TITLE_RE = /^\*\*(.+?)\*\*\s*$/;
const PLAIN_TITLE_RE =
  /^(?:Files to Touch|Patch Outline|Proposed (?:todos|changes)|Approach|Plan|Scope|Risks|Test plan|Implementation plan)\s*$/i;

function trimDecorativeRules(md: string): string {
  return md
    .replace(/^(?:\s*---\s*\n)+/, "")
    .replace(/(?:\n\s*---\s*)+$/, "")
    .trim();
}

function titleFromLine(line: string): string | null {
  const atx = ATX_RE.exec(line);
  if (atx) return atx[1]!.trim();
  const bold = BOLD_TITLE_RE.exec(line.trim());
  if (bold) {
    const t = bold[1]!.trim();
    if (t.length > 0 && t.length <= 80 && !t.includes("\n")) return t;
  }
  const plain = line.trim();
  if (PLAIN_TITLE_RE.test(plain)) return plain;
  return null;
}

function countContentLines(body: string): number {
  if (!body) return 0;
  return body.split("\n").filter((l) => {
    const t = l.trim();
    return t && t !== "---";
  }).length;
}

/**
 * Split on ## / ### / **Title** section markers.
 * Kept name for callers; handles more than H2.
 */
export function splitMarkdownByH2(src: string): MdChunk[] {
  const text = String(src ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const hasMarker = lines.some((l) => titleFromLine(l) != null);
  if (!hasMarker) {
    return [{ type: "prose", markdown: text }];
  }

  const chunks: MdChunk[] = [];
  let buf: string[] = [];
  let currentTitle: string | null = null;

  const flush = () => {
    const raw = buf.join("\n");
    buf = [];
    if (currentTitle == null) {
      const md = trimDecorativeRules(raw);
      if (md) chunks.push({ type: "prose", markdown: md });
      return;
    }
    const body = trimDecorativeRules(raw);
    chunks.push({
      type: "section",
      title: currentTitle,
      markdown: body || "_Empty section._",
      lineCount: countContentLines(body),
    });
  };

  for (const line of lines) {
    const title = titleFromLine(line);
    if (title) {
      flush();
      currentTitle = title;
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

/** Prefer collapsed when section has enough content (unless streaming). */
export function sectionDefaultOpen(
  lineCount: number,
  opts?: { streaming?: boolean; forceOpen?: boolean },
): boolean {
  if (opts?.forceOpen) return true;
  if (opts?.streaming) return true;
  return lineCount <= 3;
}
