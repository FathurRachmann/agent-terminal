/** Parse `/self-heal` slash command from user input. */
export function parseSelfHealCommand(
  text: string,
): { note: string } | null {
  const trimmed = text.trim();
  const match = /^\/self-heal(?:\s+(.*))?$/is.exec(trimmed);
  if (!match) return null;
  return { note: (match[1] ?? "").trim() };
}
