import { collectChatFileChipPaths } from "./file-delivery-shared.js";

export type DeliverableFileChip = {
  id: string;
  kind: "file";
  path: string;
  basename: string;
  at: string;
  note: string;
};

/**
 * Build in-chat file cards from assistant text / write paths.
 * Uses a strict path filter so architecture prose (`Next.js`, `middleware.js`)
 * does not spawn fake "File from agent" cards.
 */
export function buildDeliverableFileChips(
  texts: string[],
  extraPaths: string[] = [],
  atTs: string,
  opts?: { limit?: number; idPrefix?: string },
): DeliverableFileChip[] {
  const limit = opts?.limit ?? 8;
  const idPrefix = opts?.idPrefix ?? `file-${Date.now()}`;
  const paths = collectChatFileChipPaths(texts, extraPaths).slice(0, limit);
  return paths.map((p, i) => ({
    id: `${idPrefix}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    kind: "file" as const,
    path: p,
    basename: p.split(/[/\\]/).pop() || p,
    at: atTs,
    note: "Open in app, or Save as… to download a copy",
  }));
}
