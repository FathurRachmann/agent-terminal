/** Parse unified-diff style text into lines for the chat diff viewport. */
export type DiffLine = {
  kind: "ctx" | "add" | "del" | "hunk";
  text: string;
};

export type ExtractedDiff = {
  header: string;
  language: string;
  lines: DiffLine[];
};

export const AGENT_FILE_DIFF_FENCE = "agent-file-diff";

const EDIT_WRITE_NAMES = new Set([
  "edit_file",
  "edit",
  "str_replace",
  "write_file",
  "write",
]);

export type AgentFileDiffPayload = {
  path: string;
  language: string;
  before: string;
  after: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function argString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string") return v;
  }
  return "";
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toUpperCase() || "CODE";
  return ext.slice(0, 12);
}

function basenameHint(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts[parts.length - 1] || filePath || "file";
}

/** Cap huge write_file bodies so the chat chip stays usable. */
const MAX_DIFF_LINES = 80;

export function parseAgentFileDiffPayload(
  output: string,
): AgentFileDiffPayload | null {
  const raw = String(output || "");
  const fence = raw.match(
    /```agent-file-diff\s*\n([\s\S]*?)```/i,
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
    return {
      path: String(parsed.path || "file"),
      language: String(parsed.language || "plaintext"),
      before: parsed.before,
      after: parsed.after,
    };
  } catch {
    return null;
  }
}

export function extractDiffFromToolOutput(output: string): ExtractedDiff | null {
  const raw = String(output || "");
  if (!raw.trim()) return null;

  // Prefer fenced diff / patch blocks
  const fence =
    raw.match(/```(?:diff|patch)\s*\n([\s\S]*?)```/i)?.[1] ??
    raw.match(/(^|\n)(---[\s\S]*?\n\+\+\+[\s\S]*)/)?.[2] ??
    null;

  const body = (fence || raw).trim();
  const hasDiffMarks =
    /^[+-](?![+-])/m.test(body) ||
    /^@@ /m.test(body) ||
    /^diff --git /m.test(body);
  if (!hasDiffMarks) return null;

  const lines: DiffLine[] = [];
  let hunkHeader = "";
  let language = "CODE";
  for (const line of body.split(/\r?\n/).slice(0, 160)) {
    if (/^diff --git /.test(line) || /^index /.test(line)) continue;
    if (/^--- /.test(line) || /^\+\+\+ /.test(line)) {
      const m = line.match(/[./]?([\w.-]+\.\w+)/);
      if (m?.[1]) {
        const ext = m[1].split(".").pop()?.toUpperCase() || "CODE";
        language = ext;
      }
      continue;
    }
    if (/^@@ /.test(line)) {
      hunkHeader = line.replace(/^@@\s*/, "@@ ").slice(0, 90);
      lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line });
    } else if (line.startsWith("-")) {
      lines.push({ kind: "del", text: line });
    } else {
      lines.push({ kind: "ctx", text: line.startsWith(" ") ? line : ` ${line}` });
    }
  }
  if (!lines.some((l) => l.kind === "add" || l.kind === "del")) return null;

  return {
    header: hunkHeader || "DIFF CHUNK",
    language,
    lines: lines.filter((l) => l.kind !== "hunk").slice(0, MAX_DIFF_LINES),
  };
}

/**
 * Fallback when stream tool_end only has "Successfully updated file" —
 * rebuild a visual diff from edit_file / write_file args.
 */
export function extractDiffFromEditArgs(
  name: string,
  input: unknown,
): ExtractedDiff | null {
  if (!EDIT_WRITE_NAMES.has(name)) return null;
  const args = asRecord(input);
  const filePath = argString(args, [
    "file_path",
    "path",
    "filePath",
    "filename",
    "file",
  ]);
  const header = filePath ? basenameHint(filePath) : "DIFF CHUNK";
  const language = filePath ? languageFromPath(filePath) : "CODE";

  if (name === "write_file" || name === "write") {
    const content = argString(args, ["content", "text", "file_content", "new_string"]);
    if (!content.trim()) return null;
    const rawLines = content.split(/\r?\n/);
    const truncated = rawLines.length > MAX_DIFF_LINES;
    const lines: DiffLine[] = rawLines.slice(0, MAX_DIFF_LINES).map((line) => ({
      kind: "add" as const,
      text: `+${line}`,
    }));
    if (truncated) {
      lines.push({
        kind: "ctx",
        text: ` …(+${rawLines.length - MAX_DIFF_LINES} more lines)`,
      });
    }
    return { header, language, lines };
  }

  const oldString = argString(args, ["old_string", "oldString", "old_str"]);
  const newString = argString(args, ["new_string", "newString", "new_str"]);
  if (!oldString && !newString) return null;
  if (oldString === newString) return null;

  const lines: DiffLine[] = [];
  if (oldString) {
    for (const line of oldString.split(/\r?\n/)) {
      lines.push({ kind: "del", text: `-${line}` });
    }
  }
  if (newString) {
    for (const line of newString.split(/\r?\n/)) {
      lines.push({ kind: "add", text: `+${line}` });
    }
  }
  if (!lines.length) return null;
  const truncated = lines.length > MAX_DIFF_LINES;
  return {
    header,
    language,
    lines: truncated
      ? [
          ...lines.slice(0, MAX_DIFF_LINES),
          {
            kind: "ctx",
            text: ` …(+${lines.length - MAX_DIFF_LINES} more lines)`,
          },
        ]
      : lines,
  };
}

/** Prefer streamed FILE_DIFF; else synthesize from tool args. */
export function resolveToolDiff(
  name: string,
  output: string,
  input?: unknown,
): ExtractedDiff | null {
  return (
    extractDiffFromToolOutput(output) ?? extractDiffFromEditArgs(name, input)
  );
}

/**
 * Monaco / chat payload from args when middleware FILE_DIFF never arrived.
 */
export function fileDiffPayloadFromEditArgs(
  name: string,
  input: unknown,
): AgentFileDiffPayload | null {
  if (!EDIT_WRITE_NAMES.has(name)) return null;
  const args = asRecord(input);
  const filePath =
    argString(args, ["file_path", "path", "filePath", "filename", "file"]) ||
    "file";
  const language = languageFromPath(filePath).toLowerCase() || "plaintext";

  if (name === "write_file" || name === "write") {
    const after = argString(args, ["content", "text", "file_content", "new_string"]);
    if (!after) return null;
    return { path: filePath, language, before: "", after };
  }

  const before = argString(args, ["old_string", "oldString", "old_str"]);
  const after = argString(args, ["new_string", "newString", "new_str"]);
  if (!before && !after) return null;
  if (before === after) return null;
  return { path: filePath, language, before, after };
}

export function summarizePatchStats(
  output: string,
  name?: string,
  input?: unknown,
): string | null {
  const fromOutAdds = (output.match(/^\+(?!\+)/gm) || []).length;
  const fromOutDels = (output.match(/^-(?!-)/gm) || []).length;
  if (fromOutAdds || fromOutDels) {
    if (fromOutAdds && !fromOutDels) return `+${fromOutAdds} lines patched`;
    if (fromOutDels && !fromOutAdds) return `-${fromOutDels} lines removed`;
    return `+${fromOutAdds} / -${fromOutDels}`;
  }

  if (name) {
    const synth = extractDiffFromEditArgs(name, input);
    if (synth) {
      const adds = synth.lines.filter((l) => l.kind === "add").length;
      const dels = synth.lines.filter((l) => l.kind === "del").length;
      if (adds && !dels) return `+${adds} lines`;
      if (dels && !adds) return `-${dels} lines`;
      if (adds || dels) return `+${adds} / −${dels}`;
    }
  }
  return null;
}

export function detectTestPassSummary(output: string): string | null {
  const m =
    output.match(/PASS[^\n]*?(\d+)\s*(?:tests?|passed)/i) ||
    output.match(/(\d+)\s+passed/i) ||
    output.match(/ok\s+(\d+)/i);
  const fail = /(\d+)\s+failed/i.exec(output);
  const time = output.match(/\((\d+(?:\.\d+)?m?s)\)/i)?.[1];
  if (m) {
    const n = m[1];
    const t = time ? ` (${time})` : "";
    if (fail && Number(fail[1]) > 0) return `Failed ${fail[1]}/${n}${t}`;
    return `Passed ${n}/${n}${t}`;
  }
  if (/PASS|✓|ok\b/i.test(output) && !/FAIL|✗/i.test(output)) {
    return time ? `Passed${time ? ` (${time})` : ""}` : "Passed";
  }
  return null;
}

/** Split file text into lines (drop trailing empty from final newline). */
function splitLines(text: string): string[] {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Line-oriented LCS diff for chat / proposed-patch previews.
 * Prefer this over dumping whole before as dels + after as adds.
 */
export function diffLinesFromSides(
  before: string,
  after: string,
  maxLines = MAX_DIFF_LINES,
): DiffLine[] {
  if (!before && !after) return [];
  if (!before) {
    return splitLines(after)
      .slice(0, maxLines)
      .map((line) => ({ kind: "add" as const, text: `+${line}` }));
  }
  if (!after) {
    return splitLines(before)
      .slice(0, maxLines)
      .map((line) => ({ kind: "del" as const, text: `-${line}` }));
  }
  if (before === after) {
    return splitLines(after)
      .slice(0, Math.min(12, maxLines))
      .map((line) => ({ kind: "ctx" as const, text: ` ${line}` }));
  }

  const a = splitLines(before);
  const b = splitLines(after);
  // Cap LCS for huge files
  const aUse = a.length > 400 ? a.slice(0, 400) : a;
  const bUse = b.length > 400 ? b.slice(0, 400) : b;
  const lcs = longestCommonSubsequence(aUse, bUse);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let li = 0;
  while ((i < aUse.length || j < bUse.length) && out.length < maxLines) {
    if (
      li < lcs.length &&
      i < aUse.length &&
      aUse[i] === lcs[li] &&
      j < bUse.length &&
      bUse[j] === lcs[li]
    ) {
      out.push({ kind: "ctx", text: ` ${aUse[i]}` });
      i++;
      j++;
      li++;
      continue;
    }
    if (i < aUse.length && (li >= lcs.length || aUse[i] !== lcs[li])) {
      out.push({ kind: "del", text: `-${aUse[i]}` });
      i++;
      continue;
    }
    if (j < bUse.length && (li >= lcs.length || bUse[j] !== lcs[li])) {
      out.push({ kind: "add", text: `+${bUse[j]}` });
      j++;
      continue;
    }
    break;
  }
  if (!out.some((l) => l.kind === "add" || l.kind === "del")) {
    // Fallback: treat as full replace
    return [
      ...aUse.slice(0, Math.floor(maxLines / 2)).map((line) => ({
        kind: "del" as const,
        text: `-${line}`,
      })),
      ...bUse.slice(0, Math.floor(maxLines / 2)).map((line) => ({
        kind: "add" as const,
        text: `+${line}`,
      })),
    ].slice(0, maxLines);
  }
  return out;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
    }
  }
  const seq: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      seq.push(a[i - 1]!);
      i--;
      j--;
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) i--;
    else j--;
  }
  seq.reverse();
  return seq;
}
