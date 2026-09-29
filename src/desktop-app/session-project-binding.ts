/**
 * Pure helpers for session ↔ project binding (unit-tested).
 */
export function resolveSessionTurnProjectId(input: {
  isBotThread: boolean;
  sessionMetaProjectId: string | null | undefined;
  /** Only used if you intentionally override; prefer session meta. */
  overrideProjectId?: string | null;
}): string | null {
  if (input.isBotThread) return null;
  if (input.overrideProjectId !== undefined) {
    return input.overrideProjectId;
  }
  return input.sessionMetaProjectId ?? null;
}

/** New session from Sessions tab must never inherit sticky global project. */
export function resolveNewSessionProjectId(
  requested: string | null | undefined,
): string | null {
  if (requested === null || requested === undefined || requested === "") {
    return null;
  }
  return String(requested).trim() || null;
}
