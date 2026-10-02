/** Attachment shown inside a sent user chat bubble. */
export type UserBubbleAttachment = {
  path: string;
  absPath?: string;
  basename: string;
  kind: "image" | "audio" | "file";
  mime?: string;
  size?: number;
  label?: string;
  previewUrl?: string;
};

const ATTACHMENTS_BLOCK_RE =
  /\[ATTACHMENTS\][\s\S]*?\[\/ATTACHMENTS\]\s*/g;
const USER_TAG_RE = /^\[USER\]\s*/m;
const IMAGE_LINE_RE = /- IMAGE:\s*`([^`]+)`/g;
const AUDIO_LINE_RE = /- AUDIO:\s*`([^`]+)`/g;
const FILE_LINE_RE = /- FILE:\s*`([^`]+)`/g;

function basenameOf(p: string): string {
  const norm = String(p || "").replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts[parts.length - 1] || p;
}

function kindFromPath(filePath: string): "image" | "audio" | "file" {
  const ext = basenameOf(filePath).split(".").pop()?.toLowerCase() || "";
  if (
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "tif", "tiff"].includes(
      ext,
    )
  ) {
    return "image";
  }
  if (
    ["m4a", "mp3", "wav", "ogg", "oga", "opus", "aac", "flac", "webm"].includes(ext)
  ) {
    return "audio";
  }
  return "file";
}

/**
 * Split a stored user transcript into display text + attachment refs.
 * Handles composed prompts that include [ATTACHMENTS]…[/ATTACHMENTS].
 */
export function parseUserMessageContent(content: string): {
  text: string;
  attachments: UserBubbleAttachment[];
} {
  const raw = String(content || "");
  const attachments: UserBubbleAttachment[] = [];
  const seen = new Set<string>();

  const push = (filePath: string, kindHint?: "image" | "audio" | "file") => {
    const path = filePath.trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    attachments.push({
      path,
      basename: basenameOf(path),
      kind: kindHint || kindFromPath(path),
    });
  };

  let m: RegExpExecArray | null;
  IMAGE_LINE_RE.lastIndex = 0;
  while ((m = IMAGE_LINE_RE.exec(raw))) push(m[1]!, "image");
  AUDIO_LINE_RE.lastIndex = 0;
  while ((m = AUDIO_LINE_RE.exec(raw))) push(m[1]!, "audio");
  FILE_LINE_RE.lastIndex = 0;
  while ((m = FILE_LINE_RE.exec(raw))) push(m[1]!, "file");

  let text = raw
    .replace(ATTACHMENTS_BLOCK_RE, "")
    .replace(USER_TAG_RE, "")
    .trim();

  // Fallback placeholder when user sent only attachments with no typed message
  if (
    !text ||
    /^Please (analyze the attached image|review the attached file|transcribe\/summarize the attached audio)/i.test(
      text,
    )
  ) {
    text = attachments.length ? "" : raw.trim();
  }

  return { text, attachments };
}
