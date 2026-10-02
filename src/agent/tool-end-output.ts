/**
 * Format tool_end payloads for the UI without destroying FILE_DIFF fences.
 * Plain tools still get a short one-line truncate; edit/write keep newlines.
 */

const EDIT_WRITE_TOOL_NAMES = new Set([
  "edit_file",
  "edit",
  "write_file",
  "write",
]);

const FILE_DIFF_MAX = 100_000;

function asText(value: unknown): string {
  try {
    return typeof value === "string"
      ? value
      : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Collapse whitespace + clip — OK for short status chips, not for diffs. */
export function truncateOneLine(value: unknown, max = 240): string {
  const text = asText(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function clipKeepingDiffFences(text: string, max: number): string {
  const diffFence = text.match(/```(?:diff|patch)\s*\n[\s\S]*?```/i)?.[0] ?? "";
  const fileDiffFence =
    text.match(/```agent-file-diff\s*\n[\s\S]*?```/i)?.[0] ?? "";
  const kept = [diffFence, fileDiffFence].filter(Boolean).join("\n\n");
  if (kept && kept.length <= max) {
    const fenceAt = text.indexOf("```");
    const headEnd = fenceAt > 0 ? Math.min(320, fenceAt) : 320;
    const head = text.slice(0, headEnd).trimEnd();
    const combined = head ? `${head}\n${kept}` : kept;
    return combined.length <= max ? combined : kept.slice(0, max);
  }
  return `${text.slice(0, max - 1)}…`;
}

/** Keep FILE_DIFF / ```diff fences intact for Monaco + green/red chat chips. */
export function formatToolEndOutput(
  name: string,
  out: unknown,
  maxPlain = 400,
): string {
  const text = asText(out);
  const isEditWrite = EDIT_WRITE_TOOL_NAMES.has(name);
  const hasDiffPayload =
    /```agent-file-diff/i.test(text) || /```(?:diff|patch)\b/i.test(text);

  if (isEditWrite && hasDiffPayload) {
    if (text.length <= FILE_DIFF_MAX) return text;
    return clipKeepingDiffFences(text, FILE_DIFF_MAX);
  }

  return truncateOneLine(text, maxPlain);
}
