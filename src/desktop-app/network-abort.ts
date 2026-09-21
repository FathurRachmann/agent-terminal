/**
 * Classify network aborts that should not crash Electron's main process.
 * Kept free of `electron` imports so unit tests can run under plain Node.
 */

export function isBenignNetworkTermination(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "string") {
    const m = err.toLowerCase();
    return (
      m === "terminated" ||
      m.includes("aborted") ||
      m.includes("econnreset") ||
      m.includes("socket hang up") ||
      m.includes("fetch failed")
    );
  }
  if (typeof err !== "object") return false;
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    cause?: unknown;
  };
  const name = String(e.name || "");
  const code = String(e.code || "");
  const msg = String(e.message || "").toLowerCase();
  if (name === "AbortError" || code === "ABORT_ERR" || code === "ECONNRESET") {
    return true;
  }
  if (
    msg === "terminated" ||
    msg.includes("this operation was aborted") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    (msg.includes("fetch failed") && Boolean(e.cause))
  ) {
    return true;
  }
  if (e.cause) return isBenignNetworkTermination(e.cause);
  return false;
}
