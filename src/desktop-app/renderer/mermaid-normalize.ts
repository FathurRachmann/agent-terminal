/**
 * Best-effort cleanup for common LLM Mermaid mistakes so chat preview
 * does not fail on missing `:` after arrows/notes or trailing `----`.
 */

/** Sequence / flowchart arrows only — avoid bare `--` / `---` (too greedy). */
const SEQ_ARROW = "(?:-->>|->>|--x|-x)";
const FLOW_ARROW = "(?:-->|==>|-.->)";

export function normalizeMermaidSource(code: string): string {
  let out = String(code || "").replace(/\r\n/g, "\n");

  // Drop accidental fences if a .mmd file was double-wrapped.
  out = out
    .replace(/^\s*```(?:mermaid|mmd)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // `Note over A, B text` → `Note over A, B: text` (LLM often drops `:`).
  out = out.replace(
    /^(\s*Note\s+(?:over|left of|right of)\s+[A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)?)\s+(?![:])(\S.*)$/gim,
    "$1: $2",
  );

  // `A->>B includes input validation, …` → insert missing `:` after target.
  out = out.replace(
    new RegExp(
      `^(\\s*[A-Za-z][A-Za-z0-9_]*\\s*${SEQ_ARROW}\\s*[A-Za-z][A-Za-z0-9_]*)\\s+(?!:)(\\S.*)$`,
      "gm",
    ),
    "$1: $2",
  );

  // `A-->>B----: msg` → strip junk dashes between target and colon.
  out = out.replace(
    new RegExp(
      `(\\b(?:${SEQ_ARROW}|${FLOW_ARROW})\\s*[A-Za-z][A-Za-z0-9_]*)\\s*[-=]{3,}(?=\\s*:)`,
      "g",
    ),
    "$1",
  );

  // Trailing decorative separators (`----`, `====`) at EOL — run last.
  out = out.replace(/[-=]{3,}\s*$/gm, "");
  out = out.replace(/[ \t]+$/gm, "");

  return out;
}
