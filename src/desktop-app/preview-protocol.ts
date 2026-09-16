import path from "node:path";

/** Custom scheme for streaming workspace files into Canvas (PDF/media/large binaries). */
export const AGENT_PREVIEW_SCHEME = "agent-preview";

export function encodeAgentPreviewUrl(absPath: string): string {
  const token = Buffer.from(path.resolve(absPath), "utf8").toString("base64url");
  return `${AGENT_PREVIEW_SCHEME}://local/${token}`;
}

export function decodeAgentPreviewUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== `${AGENT_PREVIEW_SCHEME}:`) return null;
    const token = (u.pathname || "").replace(/^\//, "").split("/")[0] || "";
    if (!token) return null;
    const abs = Buffer.from(token, "base64url").toString("utf8");
    return abs ? path.resolve(abs) : null;
  } catch {
    return null;
  }
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
