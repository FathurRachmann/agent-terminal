/** Parse unified-diff style text into lines for the chat diff viewport. */
export type DiffLine = {
  kind: "ctx" | "add" | "del" | "hunk";
  text: string;
};

export function extractDiffFromToolOutput(output: string): {
  header: string;
  language: string;
  lines: DiffLine[];
} | null {
  const raw = String(output || "");
  if (!raw.trim()) return null;

  // Prefer fenced diff / patch blocks
  const fence =
    raw.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/i)?.[1] ??
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
  for (const line of body.split(/\r?\n/).slice(0, 80)) {
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
    lines: lines.filter((l) => l.kind !== "hunk").slice(0, 40),
  };
}

export function summarizePatchStats(output: string): string | null {
  const adds = (output.match(/^\+(?!\+)/gm) || []).length;
  const dels = (output.match(/^-(?!-)/gm) || []).length;
  if (adds === 0 && dels === 0) return null;
  if (adds && !dels) return `+${adds} lines patched`;
  if (dels && !adds) return `-${dels} lines removed`;
  return `+${adds} / -${dels}`;
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
