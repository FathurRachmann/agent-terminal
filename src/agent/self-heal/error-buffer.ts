import type { ErrorRecord } from "./types.js";

const DEFAULT_LIMIT = 40;

/** Normalize noisy error text for duplicate detection. */
export function fingerprintError(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b0x[0-9a-f]+\b/g, "0x…")
    .replace(
      /\/(?:users|home|var|tmp)\/[^\s:'"]+/gi,
      (p) => pathTail(p),
    )
    .replace(/chromium-[\w.-]+/gi, "chromium-…")
    .replace(/\d{4,}/g, "###")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function pathTail(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join("/")}`;
}

export function isSelfHealEligibleError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (
    /\bapi[_ ]?key\b|unauthorized|\b401\b|invalid.*\bkey\b|authentication|authorization/i.test(
      m,
    )
  )
    return false;
  if (/already running a turn/i.test(m)) return false;
  if (/user rejected|approval denied|rejected by user/i.test(m)) return false;
  if (/agent engine not ready/i.test(m)) return false;
  // Opaque provider/SDK crashes — editing agent source won't fix; avoid heal loops.
  if (
    /cannot read propert(?:y|ies) of undefined \(reading ['"]message['"]\)/i.test(
      m,
    )
  )
    return false;
  if (/malformed error payload \(missing error\.message\)/i.test(m)) return false;
  return true;
}

export class ErrorBuffer {
  private readonly items: ErrorRecord[] = [];
  private readonly limit: number;

  constructor(limit = DEFAULT_LIMIT) {
    this.limit = limit;
  }

  push(message: string, source = "turn"): ErrorRecord | null {
    const cleaned = message.trim();
    if (!cleaned) return null;
    const record: ErrorRecord = {
      at: Date.now(),
      source,
      message: cleaned.slice(0, 2000),
      fingerprint: fingerprintError(cleaned),
    };
    this.items.push(record);
    while (this.items.length > this.limit) this.items.shift();
    return record;
  }

  /** Count recent identical fingerprints within a time window. */
  countRecent(fingerprint: string, windowMs = 15 * 60_000): number {
    const cutoff = Date.now() - windowMs;
    return this.items.filter(
      (r) => r.fingerprint === fingerprint && r.at >= cutoff,
    ).length;
  }

  latest(): ErrorRecord | null {
    return this.items[this.items.length - 1] ?? null;
  }

  snapshot(max = 8): string {
    const slice = this.items.slice(-max);
    if (slice.length === 0) return "(no recent errors captured)";
    return slice
      .map((r, i) => {
        const ageSec = Math.max(0, Math.round((Date.now() - r.at) / 1000));
        return `${i + 1}. [${r.source} · ${ageSec}s ago] ${r.message}`;
      })
      .join("\n");
  }

  clear(): void {
    this.items.length = 0;
  }
}
