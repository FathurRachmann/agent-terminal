import { parseUserMessageContent } from "./user-message-attachments.js";

export type SessionListRowLike = {
  threadId: string;
  updatedAt: string;
  preview: string;
  turnCount: number;
  projectId?: string | null;
};

/** Short label for the sessions sidebar (strip attachment prompt noise). */
export function sessionPreviewLabel(raw: string, max = 48): string {
  const parsed = parseUserMessageContent(raw);
  const text = parsed.text.trim();
  if (text) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }
  if (parsed.attachments.length) {
    const names = parsed.attachments.map((a) => a.basename).join(", ");
    return names.length <= max ? names : `${names.slice(0, max - 1)}…`;
  }
  const fallback = String(raw || "").replace(/\s+/g, " ").trim();
  if (!fallback) return "(empty)";
  return fallback.length <= max ? fallback : `${fallback.slice(0, max - 1)}…`;
}

/**
 * Sort sessions for the sidebar: busy threads first, then newest updatedAt.
 */
export function sortSessionsForSidebar<T extends SessionListRowLike>(
  rows: T[],
  busyThreadIds: string[],
): T[] {
  const busy = new Set(busyThreadIds);
  return rows.slice().sort((a, b) => {
    const ab = busy.has(a.threadId) ? 1 : 0;
    const bb = busy.has(b.threadId) ? 1 : 0;
    if (ab !== bb) return bb - ab;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });
}

/** Optimistically move a thread to the top with a fresh preview/timestamp. */
export function touchSessionRow<T extends SessionListRowLike>(
  rows: T[],
  threadId: string,
  patch: { preview?: string; projectId?: string | null },
): T[] {
  if (!threadId) return rows;
  const nowIso = new Date().toISOString();
  const idx = rows.findIndex((s) => s.threadId === threadId);
  if (idx < 0) {
    return [
      {
        threadId,
        updatedAt: nowIso,
        preview: patch.preview || "(current session)",
        turnCount: 1,
        projectId: patch.projectId ?? null,
      } as T,
      ...rows,
    ];
  }
  const current = rows[idx]!;
  const next: T = {
    ...current,
    updatedAt: nowIso,
    preview: patch.preview ?? current.preview,
    turnCount: Math.max(1, (current.turnCount || 0) + (patch.preview ? 1 : 0)),
  };
  return [next, ...rows.slice(0, idx), ...rows.slice(idx + 1)];
}

/** Merge main-process busy ids with local optimistic busy (never drop local-only). */
export function mergeBusyThreadIds(
  fromMain: string[],
  localOptimistic: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...fromMain, ...localOptimistic]) {
    const t = String(id || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
