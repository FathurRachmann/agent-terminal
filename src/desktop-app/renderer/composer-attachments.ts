/** Pasted plain text above this length becomes an attachment chip. */
export const LONG_PASTE_THRESHOLD = 500;

export function isLongPasteText(text: string): boolean {
  return String(text || "").length > LONG_PASTE_THRESHOLD;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb >= 10 ? `${kb.toFixed(0)} KB` : `${kb.toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function pastedContentLabel(byteLength: number): string {
  return `Pasted content (${formatBytes(byteLength)})`;
}

export function truncateMiddle(text: string, max = 28): string {
  const s = String(text || "");
  if (s.length <= max) return s;
  const keep = Math.max(4, Math.floor((max - 1) / 2));
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

export function truncatePath(text: string, max = 32): string {
  const s = String(text || "").replace(/\\/g, "/");
  if (s.length <= max) return s;
  return `…${s.slice(-(max - 1))}`;
}

/** Filename for a long-text paste stored under working/uploads/. */
export function pastedTextFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  const rand = Math.random().toString(16).slice(2, 8);
  return `pasted_content_${stamp}_${time}-${ms}_${rand}.txt`;
}

export function pastedImageFileName(
  mime = "image/png",
  now = new Date(),
): string {
  const ext =
    mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : mime.includes("gif")
        ? "gif"
        : mime.includes("webp")
          ? "webp"
          : "png";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
  const rand = Math.random().toString(16).slice(2, 8);
  return `Screenshot_${stamp}_at_${time}_${rand}.${ext}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
