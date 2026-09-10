/**
 * Format model answers for terminal/Ink readability.
 * Converts jammed markdown into spaced plain text with real line breaks.
 */
export function formatAgentDisplayText(raw: string): string {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();

  if (!text) return "";

  // Headings → plain lines
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Bold / italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
  text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "$1");

  // Inline code keep content, drop backticks
  text = text.replace(/`([^`]+)`/g, "$1");

  // Ensure numbered items start on their own line: "utama:1. Foo" / ")2. Bar"
  text = text.replace(/([^\n])\s*(\d+)\.\s+/g, "$1\n\n$2. ");

  // Ensure bullets start on their own line: ": - item" / ". - item"
  text = text.replace(/([^\n])\s+-\s+/g, "$1\n  - ");

  // Collapse 3+ newlines
  text = text.replace(/\n{3,}/g, "\n\n");

  // Indent continuation-friendly spacing for list bodies already on new lines
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

  return text;
}

/** Split formatted text into display lines for Ink (preserves blank lines lightly). */
export function toDisplayLines(text: string): string[] {
  const formatted = formatAgentDisplayText(text);
  if (!formatted) return [];
  return formatted.split("\n");
}
