import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import {
  allMessagingAllowlist,
  hasWhatsAppAuth,
  isWhatsAppIdentityAllowed,
  loadMessagingConfig,
  normalizeWhatsAppIdentity,
  whatsappAuthDir,
  type MessagingConfig,
} from "./messaging-store.js";
import {
  attachmentKindFor,
  finalizeAttachmentFile,
  saveAttachmentBuffer,
  waMediaFileName,
  type InboundAttachment,
} from "./inbound-attachments.js";

export type WhatsAppConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "error";

export type WhatsAppBridgeStatus = {
  status: WhatsAppConnectionStatus;
  enabled: boolean;
  hasAuth: boolean;
  me?: string | null;
  lastError?: string | null;
  qrDataUrl?: string | null;
};

export type WhatsAppInboundMessage = {
  /** JID to reply to (may be @lid). */
  jid: string;
  /** Phone / canonical identity for allowlist + thread ids when resolved. */
  identityJid: string;
  /** All sender candidate JIDs (PN + LID) for role resolution. */
  candidates?: string[];
  pushName?: string;
  text: string;
  messageId?: string;
  /** Saved workspace attachments (images/docs from WA). */
  attachments?: InboundAttachment[];
};

export type WhatsAppBridgeEvent =
  | { type: "status"; payload: WhatsAppBridgeStatus }
  | { type: "qr"; payload: { qrDataUrl: string } }
  | { type: "error"; payload: { message: string } }
  | { type: "message_in"; payload: WhatsAppInboundMessage }
  | {
      type: "message_out";
      payload: { jid: string; text: string; ok: boolean; error?: string };
    }
  | { type: "ignored"; payload: { jid: string; reason: string } };

type EmitFn = (event: WhatsAppBridgeEvent) => void;

const MEDIA_CONTENT_TYPES = new Set([
  "imageMessage",
  "documentMessage",
  "stickerMessage",
  "videoMessage",
  "audioMessage",
]);

function extractText(msg: WAMessage): string {
  const content = extractMessageContent(msg.message) ?? msg.message;
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (typeof c.conversation === "string") return c.conversation.trim();
  const ext = c.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return String(ext.text).trim();
  const img = c.imageMessage as { caption?: string } | undefined;
  if (img?.caption) return String(img.caption).trim();
  const vid = c.videoMessage as { caption?: string } | undefined;
  if (vid?.caption) return String(vid.caption).trim();
  const doc = c.documentMessage as { caption?: string } | undefined;
  if (doc?.caption) return String(doc.caption).trim();
  const btn = c.buttonsResponseMessage as { selectedDisplayText?: string } | undefined;
  if (btn?.selectedDisplayText) return String(btn.selectedDisplayText).trim();
  const list = c.listResponseMessage as { title?: string } | undefined;
  if (list?.title) return String(list.title).trim();
  return "";
}

function mediaMetaFromMessage(msg: WAMessage): {
  type: string;
  mime?: string;
  fileName?: string;
} | null {
  const content = extractMessageContent(msg.message) ?? msg.message;
  if (!content) return null;
  const type = getContentType(content);
  if (!type || !MEDIA_CONTENT_TYPES.has(type)) return null;
  const c = content as Record<string, unknown>;
  const node = c[type] as
    | {
        mimetype?: string | null;
        fileName?: string | null;
        title?: string | null;
      }
    | undefined;
  return {
    type,
    mime: node?.mimetype ? String(node.mimetype) : undefined,
    fileName: node?.fileName
      ? String(node.fileName)
      : node?.title
        ? String(node.title)
        : undefined,
  };
}

const silentBaileysLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  child() {
    return this;
  },
  level: "silent",
} as never;

async function downloadInboundMedia(
  msg: WAMessage,
  sock: WASocket,
  saveRoot: string,
): Promise<InboundAttachment | null> {
  const meta = mediaMetaFromMessage(msg);
  if (!meta) return null;
  const fileName = waMediaFileName(meta.type, meta.mime, meta.fileName);
  const applyKind = (attachment: InboundAttachment): InboundAttachment => {
    if (meta.type === "imageMessage" || meta.type === "stickerMessage") {
      attachment.kind = "image";
    } else {
      attachment.kind = attachmentKindFor(attachment.basename, attachment.mime);
    }
    return attachment;
  };

  const downloadOpts = {
    logger: silentBaileysLogger,
    reuploadRequest: (m: WAMessage) => sock.updateMediaMessage(m),
  };

  // Prefer streaming to disk so large WA documents (up to 1 GiB) do not OOM.
  try {
    const tempAbs = path.join(
      os.tmpdir(),
      `wa-in-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`,
    );
    let stream: Readable;
    try {
      stream = (await downloadMediaMessage(
        msg,
        "stream",
        {},
        downloadOpts,
      )) as Readable;
    } catch {
      stream = (await downloadMediaMessage(
        msg,
        "stream",
        {},
      )) as Readable;
    }
    await pipeline(stream, fs.createWriteStream(tempAbs));
    const saved = finalizeAttachmentFile(saveRoot, {
      tempAbsPath: tempAbs,
      fileName,
      mime: meta.mime,
      source: "whatsapp",
    });
    if (!saved.ok) return null;
    return applyKind(saved.attachment);
  } catch {
    /* fall through to buffer path for older media */
  }

  try {
    let buffer: Buffer;
    try {
      buffer = (await downloadMediaMessage(
        msg,
        "buffer",
        {},
        downloadOpts,
      )) as Buffer;
    } catch {
      buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
    }
    if (!buffer?.length) return null;
    const saved = saveAttachmentBuffer(saveRoot, {
      buffer,
      fileName,
      mime: meta.mime,
      source: "whatsapp",
    });
    if (!saved.ok) return null;
    return applyKind(saved.attachment);
  } catch {
    return null;
  }
}

function collectSenderCandidates(msg: WAMessage): string[] {
  const key = msg.key as {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    participant?: string | null;
    participantAlt?: string | null;
    senderPn?: string | null;
  };
  const out: string[] = [];
  for (const j of [
    key.remoteJidAlt,
    key.senderPn,
    key.participantAlt,
    key.remoteJid,
    key.participant,
  ]) {
    if (!j) continue;
    const n = jidNormalizedUser(j);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function phoneJidFromDigits(digits: string): string {
  return `${digits}@s.whatsapp.net`;
}

function pathResolveSafe(root: string): string {
  return path.resolve(root);
}

export class WhatsAppBridge {
  private sock: WASocket | null = null;
  private starting = false;
  private status: WhatsAppConnectionStatus = "disconnected";
  private lastError: string | null = null;
  private qrDataUrl: string | null = null;
  private me: string | null = null;
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private config: MessagingConfig;
  private readonly workspaceRoot: string;
  private readonly emit: EmitFn;
  /** Where inbound WA media is written for the agent (project workspace). */
  private mediaSaveRoot: string;

  constructor(
    workspaceRoot: string,
    emit: EmitFn,
    mediaSaveRoot?: string,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.mediaSaveRoot = mediaSaveRoot || workspaceRoot;
    this.emit = emit;
    this.config = loadMessagingConfig(workspaceRoot);
  }

  /** Update directory used to persist inbound media (e.g. active project root). */
  setMediaSaveRoot(root: string) {
    if (root?.trim()) this.mediaSaveRoot = pathResolveSafe(root);
  }

  reloadConfig(): MessagingConfig {
    this.config = loadMessagingConfig(this.workspaceRoot);
    this.publishStatus();
    return this.config;
  }

  getStatus(): WhatsAppBridgeStatus {
    return {
      status: this.status,
      enabled: this.config.whatsapp.enabled,
      hasAuth: hasWhatsAppAuth(this.workspaceRoot),
      me: this.me,
      lastError: this.lastError,
      qrDataUrl: this.qrDataUrl,
    };
  }

  private publishStatus() {
    this.emit({ type: "status", payload: this.getStatus() });
  }

  private setStatus(next: WhatsAppConnectionStatus, error?: string | null) {
    this.status = next;
    if (error !== undefined) this.lastError = error;
    if (next === "connected") this.qrDataUrl = null;
    this.publishStatus();
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    this.config = loadMessagingConfig(this.workspaceRoot);
    if (!this.config.whatsapp.enabled) {
      return { ok: false, error: "WhatsApp is disabled. Enable and Save first." };
    }
    if (this.sock || this.starting) {
      this.publishStatus();
      return { ok: true };
    }

    this.starting = true;
    this.setStatus("connecting", null);

    try {
      const authDir = whatsappAuthDir(this.workspaceRoot);
      fs.mkdirSync(authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });
      this.sock = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          try {
            this.qrDataUrl = await qrcode.toDataURL(qr, {
              margin: 1,
              width: 280,
              color: { dark: "#0a0a0b", light: "#ffffff" },
            });
            this.setStatus("qr", null);
            this.emit({ type: "qr", payload: { qrDataUrl: this.qrDataUrl } });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.setStatus("error", message);
            this.emit({ type: "error", payload: { message } });
          }
        }

        if (connection === "open") {
          const id = sock.user?.id ?? null;
          this.me = id;
          this.starting = false;
          this.setStatus("connected", null);
        }

        if (connection === "close") {
          this.starting = false;
          this.sock = null;
          const code = (
            lastDisconnect?.error as
              | { output?: { statusCode?: number } }
              | undefined
          )?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          const message =
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error.message
              : code
                ? `Disconnected (${code})`
                : "Disconnected";
          this.setStatus("disconnected", message);
          if (!loggedOut && this.config.whatsapp.enabled) {
            void this.start();
          }
        }
      });

      sock.ev.on("messages.upsert", (upsert) => {
        if (upsert.type !== "notify") return;
        for (const msg of upsert.messages) {
          void this.handleInbound(msg);
        }
      });

      return { ok: true };
    } catch (e) {
      this.starting = false;
      this.sock = null;
      const message = e instanceof Error ? e.message : String(e);
      this.setStatus("error", message);
      this.emit({ type: "error", payload: { message } });
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<{ ok: boolean }> {
    this.config = loadMessagingConfig(this.workspaceRoot);
    for (const jid of [...this.typingTimers.keys()]) {
      this.stopTypingTimer(jid);
    }
    const sock = this.sock;
    this.sock = null;
    this.starting = false;
    this.qrDataUrl = null;
    try {
      sock?.end?.(undefined);
    } catch {
      /* ignore */
    }
    this.setStatus("disconnected", null);
    return { ok: true };
  }

  async logout(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.sock?.logout();
    } catch {
      /* ignore */
    }
    await this.stop();
    const authDir = whatsappAuthDir(this.workspaceRoot);
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    this.publishStatus();
    return { ok: true };
  }

  private async presence(jid: string, type: "composing" | "paused" | "available") {
    if (!this.sock || this.status !== "connected") return;
    try {
      await this.sock.sendPresenceUpdate(type, jid);
    } catch {
      /* presence is best-effort */
    }
  }

  /** Show “typing…” until stopTyping / sendText. Refreshes so long agent turns stay visible. */
  async startTyping(jid: string): Promise<void> {
    this.stopTypingTimer(jid);
    await this.presence(jid, "available");
    await this.presence(jid, "composing");
    const timer = setInterval(() => {
      void this.presence(jid, "composing");
    }, 8_000);
    this.typingTimers.set(jid, timer);
  }

  async stopTyping(jid: string): Promise<void> {
    this.stopTypingTimer(jid);
    await this.presence(jid, "paused");
  }

  private stopTypingTimer(jid: string) {
    const t = this.typingTimers.get(jid);
    if (t) {
      clearInterval(t);
      this.typingTimers.delete(jid);
    }
  }

  async sendText(
    jid: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.sock || this.status !== "connected") {
      const error = "WhatsApp is not connected.";
      this.emit({
        type: "message_out",
        payload: { jid, text, ok: false, error },
      });
      return { ok: false, error };
    }
    try {
      await this.stopTyping(jid);
      await this.sock.sendMessage(jid, { text });
      this.emit({ type: "message_out", payload: { jid, text, ok: true } });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.emit({
        type: "message_out",
        payload: { jid, text, ok: false, error },
      });
      return { ok: false, error };
    }
  }

  /**
   * Send a workspace file as a WhatsApp document (agent → user).
   * Prefer `filePath` for large files (streams from disk, up to ~1 GiB).
   */
  async sendDocument(
    jid: string,
    options: {
      buffer?: Buffer;
      filePath?: string;
      fileName: string;
      mimetype: string;
      caption?: string;
    },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.sock || this.status !== "connected") {
      return { ok: false, error: "WhatsApp is not connected." };
    }
    const documentPayload =
      options.filePath && options.filePath.trim()
        ? { url: options.filePath }
        : options.buffer;
    if (!documentPayload) {
      return { ok: false, error: "No document payload (filePath or buffer)." };
    }
    try {
      await this.stopTyping(jid);
      await this.sock.sendMessage(jid, {
        document: documentPayload,
        mimetype: options.mimetype || "application/octet-stream",
        fileName: options.fileName,
        caption: options.caption?.slice(0, 1000) || undefined,
      });
      this.emit({
        type: "message_out",
        payload: {
          jid,
          text: `[document] ${options.fileName}`,
          ok: true,
        },
      });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.emit({
        type: "message_out",
        payload: {
          jid,
          text: `[document] ${options.fileName}`,
          ok: false,
          error,
        },
      });
      return { ok: false, error };
    }
  }

  /**
   * Resolve WhatsApp @lid senders to phone JIDs using message alts + Baileys LID map.
   * Prefer phone identity for allowlist/thread; keep chat JID for replies.
   */
  private async resolveSender(
    msg: WAMessage,
  ): Promise<{ replyJid: string; identityJid: string; candidates: string[] } | null> {
    const candidates = collectSenderCandidates(msg);
    if (!candidates.length) return null;

    const replyJid = candidates.find((j) => !j.endsWith("@g.us")) ?? candidates[0]!;
    if (replyJid.endsWith("@g.us") || replyJid === "status@broadcast") return null;

    let phoneJid =
      candidates.find((j) => isPnUser(j)) ??
      candidates.find((j) => j.includes("@s.whatsapp.net")) ??
      null;

    const lidJid =
      candidates.find((j) => isLidUser(j)) ??
      candidates.find((j) => j.endsWith("@lid")) ??
      null;

    const sock = this.sock;
    if (!phoneJid && lidJid && sock?.signalRepository?.lidMapping) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(lidJid);
        if (pn) phoneJid = jidNormalizedUser(pn);
      } catch {
        /* mapping may be missing for brand-new contacts */
      }
    }

    // Warm PN→LID for allowlisted numbers so we can match sender LID.
    if (!phoneJid && lidJid && sock?.signalRepository?.lidMapping) {
      for (const entry of allMessagingAllowlist(this.config.whatsapp)) {
        const digits = normalizeWhatsAppIdentity(entry);
        if (!digits || digits.length < 8) continue;
        try {
          const mappedLid = await sock.signalRepository.lidMapping.getLIDForPN(
            phoneJidFromDigits(digits),
          );
          if (
            mappedLid &&
            normalizeWhatsAppIdentity(mappedLid) ===
              normalizeWhatsAppIdentity(lidJid)
          ) {
            phoneJid = phoneJidFromDigits(digits);
            break;
          }
        } catch {
          /* ignore per-entry lookup failures */
        }
      }
    }

    const identityJid = phoneJid || lidJid || replyJid;
    const all = [...candidates];
    if (phoneJid && !all.includes(phoneJid)) all.push(phoneJid);
    if (lidJid && !all.includes(lidJid)) all.push(lidJid);

    return { replyJid, identityJid, candidates: all };
  }

  private isAllowedAgainstCandidates(
    candidates: string[],
    allowedUsers: string[],
  ): boolean {
    return candidates.some((c) => isWhatsAppIdentityAllowed(c, allowedUsers));
  }

  private async handleInbound(msg: WAMessage) {
    if (msg.key.fromMe) return;

    const text = extractText(msg);
    const sock = this.sock;
    const attachments: InboundAttachment[] = [];
    if (sock && mediaMetaFromMessage(msg)) {
      const saved = await downloadInboundMedia(msg, sock, this.mediaSaveRoot);
      if (saved) attachments.push(saved);
    }

    if (!text && attachments.length === 0) {
      const jid = msg.key.remoteJid || "unknown";
      const type = msg.message ? getContentType(msg.message) : undefined;
      if (type) {
        this.emit({
          type: "ignored",
          payload: { jid, reason: `Unsupported message type: ${type}` },
        });
      }
      return;
    }

    this.config = loadMessagingConfig(this.workspaceRoot);
    const resolved = await this.resolveSender(msg);
    if (!resolved) return;

    const { replyJid, identityJid, candidates } = resolved;
    const allowlist = allMessagingAllowlist(this.config.whatsapp);
    const allowed = this.isAllowedAgainstCandidates(candidates, allowlist);
    if (!allowed) {
      this.emit({
        type: "ignored",
        payload: {
          jid: `${identityJid}${identityJid !== replyJid ? ` (chat ${replyJid})` : ""}`,
          reason: allowlist.length
            ? "Sender not in allowlist"
            : "Allowlist empty — add User or Friends numbers",
        },
      });
      return;
    }

    this.emit({
      type: "message_in",
      payload: {
        jid: replyJid,
        identityJid,
        candidates,
        pushName: msg.pushName || undefined,
        text,
        messageId: msg.key.id || undefined,
        attachments: attachments.length ? attachments : undefined,
      },
    });
  }
}
