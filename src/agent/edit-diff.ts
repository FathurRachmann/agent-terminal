/**
 * Build unified diffs and FILE_DIFF payloads for post-apply preview (chat + Monaco).
 */
import path from "node:path";

export type FileDiffPayload = {
  path: string;
  language: string;
  before: string;
  after: string;
  unifiedDiff: string;
};

const MAX_SIDE = 32_000;
const MAX_UNIFIED_LINES = 400;

export const FILE_DIFF_FENCE = "agent-file-diff";

export function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    md: "markdown",
    json: "json",
    css: "css",
    html: "html",
    sh: "shell",
    bash: "shell",
    yml: "yaml",
    yaml: "yaml",
  };
  return map[ext] || ext || "plaintext";
}

function clipSide(text: string): string {
  if (text.length <= MAX_SIDE) return text;
  return `${text.slice(0, MAX_SIDE)}\n…(truncated for diff preview)`;
}

/** Minimal line-based unified diff (no external deps). */
export function buildUnifiedDiff(options: {
  path: string;
  before: string;
  after: string;
  context?: number;
}): string {
  const file = options.path.replace(/\\/g, "/") || "file";
  const context = options.context ?? 3;
  const a = options.before.split(/\r?\n/);
  const b = options.after.split(/\r?\n/);
  // Drop trailing empty from split when file ends with newline
  if (a.length && a[a.length - 1] === "") a.pop();
  if (b.length && b[b.length - 1] === "") b.pop();

  const lcs = longestCommonSubsequence(a, b);
  const lines: string[] = [
    `--- a/${file}`,
    `+++ b/${file}`,
  ];

  // Walk both arrays with LCS to emit hunks
  let i = 0;
  let j = 0;
  let li = 0;
  type Hunk = { aStart: number; bStart: number; rows: string[] };
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;

  const flush = () => {
    if (cur && cur.rows.length > 0) {
      hunks.push(cur);
    }
    cur = null;
  };

  const pushRow = (ai: number, bi: number, row: string) => {
    if (!cur) {
      cur = { aStart: ai + 1, bStart: bi + 1, rows: [] };
    }
    cur.rows.push(row);
  };

  while (i < a.length || j < b.length) {
    if (
      li < lcs.length &&
      i < a.length &&
      a[i] === lcs[li] &&
      j < b.length &&
      b[j] === lcs[li]
    ) {
      if (cur) {
        pushRow(i, j, ` ${a[i]}`);
      }
      i++;
      j++;
      li++;
      continue;
    }
    if (i < a.length && (li >= lcs.length || a[i] !== lcs[li])) {
      pushRow(i, j, `-${a[i]}`);
      i++;
      continue;
    }
    if (j < b.length && (li >= lcs.length || b[j] !== lcs[li])) {
      pushRow(i, j, `+${b[j]}`);
      j++;
      continue;
    }
    if (i < a.length) {
      pushRow(i, j, `-${a[i++]}`);
    } else if (j < b.length) {
      pushRow(i, j, `+${b[j++]}`);
    }
  }
  flush();

  // Compact: only emit hunks that have +/- ; trim pure-context-only
  let emitted = 0;
  for (const h of hunks) {
    const hasChange = h.rows.some((r) => r.startsWith("+") || r.startsWith("-"));
    if (!hasChange) continue;
    const trimmed = trimContext(h.rows, context);
    const aCount = trimmed.filter((r) => r.startsWith(" ") || r.startsWith("-")).length;
    const bCount = trimmed.filter((r) => r.startsWith(" ") || r.startsWith("+")).length;
    lines.push(`@@ -${h.aStart},${aCount} +${h.bStart},${bCount} @@`);
    for (const row of trimmed) {
      lines.push(row);
      emitted++;
      if (emitted >= MAX_UNIFIED_LINES) {
        lines.push("…(diff truncated)");
        return lines.join("\n");
      }
    }
  }

  if (lines.length <= 2) {
    // identical or empty
    lines.push("@@ -1,0 +1,0 @@");
  }
  return lines.join("\n");
}

function trimContext(rows: string[], ctx: number): string[] {
  if (ctx < 0) return rows;
  const changeIdx: number[] = [];
  rows.forEach((r, i) => {
    if (r.startsWith("+") || r.startsWith("-")) changeIdx.push(i);
  });
  if (!changeIdx.length) return rows;
  const keep = new Set<number>();
  for (const i of changeIdx) {
    for (let k = i - ctx; k <= i + ctx; k++) {
      if (k >= 0 && k < rows.length) keep.add(k);
    }
  }
  return rows.filter((_, i) => keep.has(i));
}

/** Classic LCS for small/medium files; O(n*m) — cap inputs. */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const n = Math.min(a.length, 2_500);
  const m = Math.min(b.length, 2_500);
  const aa = a.slice(0, n);
  const bb = b.slice(0, m);
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aa[i - 1] === bb[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const out: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aa[i - 1] === bb[j - 1]) {
      out.push(aa[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  return out.reverse();
}

/** Apply old→new replacement to reconstruct "before" when we only have after + args. */
export function reconstructBeforeFromEdit(options: {
  after: string;
  oldString: string | null;
  newString: string | null;
}): string | null {
  const { after, oldString, newString } = options;
  if (!oldString || newString == null) return null;
  if (!after.includes(newString)) return null;
  // Replace first occurrence of newString with oldString to approximate before
  const idx = after.indexOf(newString);
  if (idx < 0) return null;
  return (
    after.slice(0, idx) + oldString + after.slice(idx + newString.length)
  );
}

export function buildFileDiffPayload(options: {
  path: string;
  before: string;
  after: string;
}): FileDiffPayload {
  const before = clipSide(options.before);
  const after = clipSide(options.after);
  const unifiedDiff = buildUnifiedDiff({
    path: options.path,
    before,
    after,
  });
  return {
    path: options.path,
    language: languageForPath(options.path),
    before,
    after,
    unifiedDiff,
  };
}

/** Append chat-parseable diff fence + structured fence for Monaco. */
export function formatDiffToolSuffix(payload: FileDiffPayload): string {
  const json = JSON.stringify({
    path: payload.path,
    language: payload.language,
    before: payload.before,
    after: payload.after,
  });
  return [
    "",
    "```diff",
    payload.unifiedDiff,
    "```",
    "",
    `\`\`\`${FILE_DIFF_FENCE}`,
    json,
    "```",
  ].join("\n");
}

export function parseFileDiffPayload(output: string): FileDiffPayload | null {
  const raw = String(output || "");
  const fence = raw.match(
    new RegExp("```" + FILE_DIFF_FENCE + "\\s*\\n([\\s\\S]*?)```", "i"),
  )?.[1];
  if (!fence) return null;
  try {
    const parsed = JSON.parse(fence.trim()) as {
      path?: string;
      language?: string;
      before?: string;
      after?: string;
    };
    if (typeof parsed.before !== "string" || typeof parsed.after !== "string") {
      return null;
    }
    const pathStr = String(parsed.path || "file");
    return {
      path: pathStr,
      language: String(parsed.language || languageForPath(pathStr)),
      before: parsed.before,
      after: parsed.after,
      unifiedDiff: buildUnifiedDiff({
        path: pathStr,
        before: parsed.before,
        after: parsed.after,
      }),
    };
  } catch {
    return null;
  }
}
