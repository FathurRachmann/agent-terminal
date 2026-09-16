import fs from "node:fs";
import path from "node:path";
import { mimeForPath, WA_DOCUMENT_MAX_BYTES } from "./file-delivery-shared.js";

export const INBOUND_UPLOAD_MAX_BYTES = WA_DOCUMENT_MAX_BYTES;

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

export type AttachmentKind = "image" | "file";
export type AttachmentSource = "desktop" | "whatsapp";

export type InboundAttachment = {
  absPath: string;
  /** Workspace-relative path for agent tools. */
  relPath: string;
  basename: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  source: AttachmentSource;
};

export type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function extOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function isImageMime(mime: string | undefined | null): boolean {
  const m = String(mime || "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    ?.trim();
  return Boolean(m && IMAGE_MIMES.has(m));
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(extOf(filePath));
}

export function attachmentKindFor(
  fileName: string,
  mime?: string | null,
): AttachmentKind {
  if (isImageMime(mime) || isImagePath(fileName)) return "image";
  return "file";
}

export function uploadsDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), "working", "uploads");
}

function safeBasename(fileName: string): string {
  const base = path.basename(String(fileName || "attachment").replace(/\0/g, ""));
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "attachment";
}

function uniqueTargetPath(dir: string, basename: string): string {
  const safe = safeBasename(basename);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || "attachment";
  let candidate = path.join(dir, `${stem}${ext}`);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return candidate;
}

export function ensureUploadsDir(workspaceRoot: string): string {
  const dir = uploadsDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Persist an inbound buffer under working/uploads/ so agent tools can read it.
 */
export function saveAttachmentBuffer(
  workspaceRoot: string,
  options: {
    buffer: Buffer;
    fileName: string;
    mime?: string | null;
    source: AttachmentSource;
    maxBytes?: number;
  },
):
  | { ok: true; attachment: InboundAttachment }
  | { ok: false; error: string } {
  const maxBytes = options.maxBytes ?? INBOUND_UPLOAD_MAX_BYTES;
  if (!options.buffer?.length) {
    return { ok: false, error: "Empty attachment" };
  }
  if (options.buffer.length > maxBytes) {
    return {
      ok: false,
      error: `File too large (${Math.ceil(options.buffer.length / (1024 * 1024))}MB). Max ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    };
  }

  const root = path.resolve(workspaceRoot);
  const dir = ensureUploadsDir(root);
  const absPath = uniqueTargetPath(dir, options.fileName);
  try {
    fs.writeFileSync(absPath, options.buffer);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const basename = path.basename(absPath);
  const mime =
    (options.mime && String(options.mime).trim()) || mimeForPath(absPath);
  const relPath = path.relative(root, absPath).split(path.sep).join("/");
  return {
    ok: true,
    attachment: {
      absPath,
      relPath,
      basename,
      mime,
      size: options.buffer.length,
      kind: attachmentKindFor(basename, mime),
      source: options.source,
    },
  };
}

/** Copy an existing local file into working/uploads/ (streams on disk — safe up to 1 GiB). */
export function importLocalAttachment(
  workspaceRoot: string,
  sourcePath: string,
  source: AttachmentSource = "desktop",
  maxBytes = INBOUND_UPLOAD_MAX_BYTES,
):
  | { ok: true; attachment: InboundAttachment }
  | { ok: false; error: string } {
  const abs = path.resolve(String(sourcePath || "").trim());
  if (!abs) return { ok: false, error: "path required" };
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return { ok: false, error: "File not found" };
  }
  if (!st.isFile()) return { ok: false, error: "Not a file" };
  if (st.size > maxBytes) {
    return {
      ok: false,
      error: `File too large (${Math.ceil(st.size / (1024 * 1024))}MB). Max ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    };
  }
  const root = path.resolve(workspaceRoot);
  const dir = ensureUploadsDir(root);
  const absPath = uniqueTargetPath(dir, path.basename(abs));
  try {
    fs.copyFileSync(abs, absPath);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const basename = path.basename(absPath);
  const mime = mimeForPath(absPath);
  const relPath = path.relative(root, absPath).split(path.sep).join("/");
  return {
    ok: true,
    attachment: {
      absPath,
      relPath,
      basename,
      mime,
      size: st.size,
      kind: attachmentKindFor(basename, mime),
      source,
    },
  };
}

/**
 * Persist an inbound file already written to a temp path under working/uploads/.
 */
export function finalizeAttachmentFile(
  workspaceRoot: string,
  options: {
    tempAbsPath: string;
    fileName: string;
    mime?: string | null;
    source: AttachmentSource;
    maxBytes?: number;
  },
):
  | { ok: true; attachment: InboundAttachment }
  | { ok: false; error: string } {
  const maxBytes = options.maxBytes ?? INBOUND_UPLOAD_MAX_BYTES;
  let st: fs.Stats;
  try {
    st = fs.statSync(options.tempAbsPath);
  } catch {
    return { ok: false, error: "Temp attachment missing" };
  }
  if (!st.isFile() || st.size <= 0) {
    try {
      fs.unlinkSync(options.tempAbsPath);
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Empty attachment" };
  }
  if (st.size > maxBytes) {
    try {
      fs.unlinkSync(options.tempAbsPath);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `File too large (${Math.ceil(st.size / (1024 * 1024))}MB). Max ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    };
  }

  const root = path.resolve(workspaceRoot);
  const dir = ensureUploadsDir(root);
  const absPath = uniqueTargetPath(dir, options.fileName);
  try {
    fs.renameSync(options.tempAbsPath, absPath);
  } catch {
    try {
      fs.copyFileSync(options.tempAbsPath, absPath);
      fs.unlinkSync(options.tempAbsPath);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const basename = path.basename(absPath);
  const mime =
    (options.mime && String(options.mime).trim()) || mimeForPath(absPath);
  const relPath = path.relative(root, absPath).split(path.sep).join("/");
  return {
    ok: true,
    attachment: {
      absPath,
      relPath,
      basename,
      mime,
      size: st.size,
      kind: attachmentKindFor(basename, mime),
      source: options.source,
    },
  };
}

export async function buildAttachmentPromptBlock(
  attachments: InboundAttachment[],
): Promise<string> {
  if (!attachments.length) return "";
  const { extractDocumentText } = await import("./document-extract.js");
  const lines = [
    "[ATTACHMENTS]",
    "The user attached the following file(s). They are saved under working/uploads/.",
    "For .docx/.xlsx use read_document (NOT read_file — those formats are binary ZIP).",
    "Extracted text below (when available) is authoritative — base your answer on it, do not invent from older files.",
  ];
  for (const a of attachments) {
    const where = a.relPath || a.absPath;
    if (a.kind === "image") {
      lines.push(
        `- IMAGE: \`${where}\` (${a.mime}, ${a.size} bytes). Call vision_analyze on this path before answering questions about what is in the image.`,
      );
      continue;
    }
    lines.push(
      `- FILE: \`${where}\` (${a.mime || "application/octet-stream"}, ${a.size} bytes). Prefer read_document for office docs.`,
    );
    const extracted = await extractDocumentText(a.absPath);
    if (extracted.ok) {
      lines.push(
        `  <extracted format="${extracted.format}"${extracted.truncated ? ' truncated="true"' : ""}>`,
      );
      lines.push(extracted.text);
      lines.push("  </extracted>");
    } else {
      lines.push(`  <extract_error>${extracted.error}</extract_error>`);
    }
  }
  lines.push("[/ATTACHMENTS]");
  return lines.join("\n");
}

export async function composePromptWithAttachments(
  userText: string,
  attachments: InboundAttachment[],
): Promise<string> {
  const text = String(userText || "").trim();
  const block = await buildAttachmentPromptBlock(attachments);
  if (!block) {
    return text;
  }
  const body =
    text ||
    (attachments.some((a) => a.kind === "image")
      ? "Please analyze the attached image(s) and respond helpfully."
      : "Please review the attached file(s) and respond helpfully.");
  return `${block}\n\n[USER]\n${body}`;
}

function isInsideRoot(root: string, abs: string): boolean {
  const r = path.resolve(root);
  const a = path.resolve(abs);
  const rel = path.relative(r, a);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Build LangChain-style multimodal user content when images are attached. */
export async function buildMultimodalUserContent(
  promptText: string,
  attachments: InboundAttachment[],
  maxImageBytes = 8 * 1024 * 1024,
): Promise<string | MultimodalContentPart[]> {
  const images = attachments.filter((a) => a.kind === "image");
  if (!images.length) return promptText;

  const parts: MultimodalContentPart[] = [
    { type: "text", text: promptText },
  ];
  for (const img of images) {
    try {
      const st = await fs.promises.stat(img.absPath);
      if (!st.isFile() || st.size > maxImageBytes) continue;
      const buf = await fs.promises.readFile(img.absPath);
      const mime = img.mime.startsWith("image/") ? img.mime : "image/jpeg";
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${buf.toString("base64")}`,
        },
      });
    } catch {
      /* skip unreadable image; path still in text block */
    }
  }
  return parts.length > 1 ? parts : promptText;
}

/**
 * Resolve renderer-supplied attachment refs to files already under working/uploads.
 * Rejects path traversal / arbitrary absolute paths outside the uploads dir.
 */
export function resolveWorkspaceUploadAttachment(
  workspaceRoot: string,
  ref: { path?: string; absPath?: string },
):
  | { ok: true; attachment: InboundAttachment }
  | { ok: false; error: string } {
  const root = path.resolve(workspaceRoot);
  const uploadRoot = uploadsDir(root);
  const candidate = String(ref.absPath || ref.path || "").trim();
  if (!candidate) return { ok: false, error: "path required" };

  let abs: string;
  if (path.isAbsolute(candidate)) {
    abs = path.resolve(candidate);
  } else {
    abs = path.resolve(root, candidate);
  }

  if (!isInsideRoot(uploadRoot, abs)) {
    return {
      ok: false,
      error: "Attachment must be under working/uploads (re-attach via picker)",
    };
  }

  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return { ok: false, error: "Not a file" };
    if (st.size > INBOUND_UPLOAD_MAX_BYTES) {
      return { ok: false, error: "File too large" };
    }
    const basename = path.basename(abs);
    const mime = mimeForPath(abs);
    const relPath = path.relative(root, abs).split(path.sep).join("/");
    return {
      ok: true,
      attachment: {
        absPath: abs,
        relPath,
        basename,
        mime,
        size: st.size,
        kind: attachmentKindFor(basename, mime),
        source: "desktop",
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function waMediaFileName(
  type: string | undefined,
  mime?: string | null,
  suggested?: string | null,
): string {
  if (suggested && String(suggested).trim()) {
    return safeBasename(String(suggested));
  }
  const m = String(mime || "").toLowerCase();
  const extFromMime =
    m.includes("png")
      ? "png"
      : m.includes("webp")
        ? "webp"
        : m.includes("gif")
          ? "gif"
          : m.includes("jpeg") || m.includes("jpg")
            ? "jpg"
            : m.includes("pdf")
              ? "pdf"
              : m.includes("ogg") || m.includes("opus")
                ? "ogg"
                : m.includes("mp4")
                  ? "mp4"
                  : m.includes("mpeg") || m.includes("mp3")
                    ? "mp3"
                    : type === "stickerMessage"
                      ? "webp"
                      : type === "imageMessage"
                        ? "jpg"
                        : type === "videoMessage"
                          ? "mp4"
                          : type === "audioMessage"
                            ? "ogg"
                            : "bin";
  const stamp = Date.now();
  const prefix =
    type === "imageMessage"
      ? "wa-image"
      : type === "documentMessage"
        ? "wa-document"
        : type === "stickerMessage"
          ? "wa-sticker"
          : type === "videoMessage"
            ? "wa-video"
            : type === "audioMessage"
              ? "wa-audio"
              : "wa-media";
  return `${prefix}-${stamp}.${extFromMime}`;
}
