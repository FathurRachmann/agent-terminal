/** Workspace group-chat composer — ChatComposer shell + @mention chips + attachments. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposerAttachment } from "./ChatComposer.js";
import {
  blobToBase64,
  formatBytes,
  pastedImageFileName,
  truncateMiddle,
  truncatePath,
} from "./composer-attachments.js";
import {
  MentionSuggest,
  mentionQueryFromValue,
} from "./MentionSuggest.js";

export type MentionBot = { id: string; name: string; role?: string };

type Props = {
  value: string;
  bots: MentionBot[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  attachments?: ComposerAttachment[];
  onChange: (next: string) => void;
  onSend: () => void;
  onAddAttachments?: (files: ComposerAttachment[]) => void;
  onRemoveAttachment?: (path: string) => void;
  onAttachError?: (message: string) => void;
};

function buildTokenSet(bots: MentionBot[]): Set<string> {
  const set = new Set<string>();
  for (const b of bots) {
    set.add(b.id.toLowerCase());
    set.add(b.name.toLowerCase().replace(/\s+/g, ""));
    if (b.role) set.add(b.role.toLowerCase().replace(/\s+/g, "-"));
  }
  return set;
}

/** Split plain text into text / mention segments for highlight + bubble chips. */
export function segmentMentions(
  text: string,
  bots: MentionBot[],
): Array<{ type: "text" | "mention"; value: string }> {
  if (!text) return [];
  const tokens = buildTokenSet(bots);
  if (tokens.size === 0) return [{ type: "text", value: text }];

  const out: Array<{ type: "text" | "mention"; value: string }> = [];
  const re = /@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: text.slice(last, m.index) });
    }
    const token = m[1]!.toLowerCase();
    if (tokens.has(token)) {
      out.push({ type: "mention", value: m[0]! });
    } else if (out.length > 0 && out[out.length - 1]!.type === "text") {
      out[out.length - 1]!.value += m[0]!;
    } else {
      out.push({ type: "text", value: m[0]! });
    }
    last = m.index + m[0]!.length;
  }
  if (last < text.length) {
    out.push({ type: "text", value: text.slice(last) });
  }
  return out.length > 0 ? out : [{ type: "text", value: text }];
}

export function MentionRichText({
  text,
  bots,
  className,
}: {
  text: string;
  bots: MentionBot[];
  className?: string;
}) {
  const parts = useMemo(() => segmentMentions(text, bots), [text, bots]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <span key={`${p.type}-${p.value}-${i}`} className="mention-chip">
            {p.value}
          </span>
        ) : (
          <React.Fragment key={`${p.type}-${i}`}>{p.value}</React.Fragment>
        ),
      )}
    </span>
  );
}

function AttachChip({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove?: () => void;
}) {
  const title = attachment.label || attachment.basename;
  const subtitle =
    attachment.subtitle ||
    (attachment.size != null ? formatBytes(attachment.size) : attachment.kind);
  return (
    <div className="composer-chip group">
      <div className="composer-chip-path-tip" role="tooltip">
        {truncatePath(attachment.path, 64)}
      </div>
      <div className="composer-chip-thumb">
        {attachment.kind === "image" && attachment.previewUrl ? (
          <img src={attachment.previewUrl} alt="" />
        ) : (
          <span className="text-[9px] font-semibold text-muted">FILE</span>
        )}
      </div>
      <div className="composer-chip-meta">
        <div className="composer-chip-title">{truncateMiddle(title, 22)}</div>
        <div className="composer-chip-sub">{subtitle}</div>
      </div>
      {onRemove ? (
        <button
          type="button"
          className="composer-chip-remove"
          aria-label={`Remove ${title}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function WorkspaceComposer({
  value,
  bots,
  disabled,
  loading,
  placeholder = "Message…",
  attachments = [],
  onChange,
  onSend,
  onAddAttachments,
  onRemoveAttachment,
  onAttachError,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mentionKeyRef = useRef<((e: React.KeyboardEvent) => boolean) | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAttach, setBusyAttach] = useState(false);
  const canSend =
    (Boolean(value.trim()) || attachments.length > 0) && !loading && !disabled;
  const mentionOpen = mentionQueryFromValue(value) !== null && bots.length > 0;
  const parts = useMemo(() => segmentMentions(value, bots), [value, bots]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(140, Math.max(22, ta.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const syncScroll = () => {
    const ta = taRef.current;
    const mir = mirrorRef.current;
    if (ta && mir) mir.scrollTop = ta.scrollTop;
  };

  const insertMention = useCallback(
    (token: string) => {
      if (!token) return;
      const next = (() => {
        const replaced = value.replace(
          /(^|\s)@[a-zA-Z0-9._-]*$/,
          (_full, g1: string) => `${g1}${token} `,
        );
        return replaced === value ? `${value}${token} ` : replaced;
      })();
      onChange(next);
      requestAnimationFrame(() => taRef.current?.focus());
    },
    [onChange, value],
  );

  const reportError = (message: string) => onAttachError?.(message);

  const pickAttachments = async (options?: {
    imagesOnly?: boolean;
    directories?: boolean;
  }) => {
    setMenuOpen(false);
    if (!window.electronAgent?.pickAttachments) {
      reportError("File picker unavailable. Restart the desktop app.");
      return;
    }
    setBusyAttach(true);
    try {
      const res = await window.electronAgent.pickAttachments(options);
      if (!res || res.cancelled) return;
      if (!res.ok) {
        reportError(res.error || "Could not attach files");
        return;
      }
      onAddAttachments?.(
        (res.files || []).map((f) => ({
          path: f.path,
          absPath: f.absPath,
          basename: f.basename,
          mime: f.mime,
          size: f.size,
          kind: f.kind,
          label: f.label,
          previewUrl: f.previewUrl,
        })),
      );
      if (res.warnings?.length) reportError(res.warnings.join("; "));
    } finally {
      setBusyAttach(false);
    }
  };

  const importBuffer = async (payload: {
    base64: string;
    fileName: string;
    mime?: string;
  }) => {
    if (!window.electronAgent?.importAttachmentBuffer) {
      reportError("Paste import unavailable. Restart the desktop app.");
      return;
    }
    setBusyAttach(true);
    try {
      const res = await window.electronAgent.importAttachmentBuffer(payload);
      if (!res?.ok || !res.file) {
        reportError(res?.error || "Could not store pasted content");
        return;
      }
      const f = res.file;
      onAddAttachments?.([
        {
          path: f.path,
          absPath: f.absPath,
          basename: f.basename,
          mime: f.mime,
          size: f.size,
          kind: f.kind,
          label: f.label,
          previewUrl: f.previewUrl,
        },
      ]);
    } finally {
      setBusyAttach(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const imageItem = Array.from(cd.items || []).find((it) =>
      it.type.startsWith("image/"),
    );
    if (!imageItem) return;
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    const base64 = await blobToBase64(blob);
    await importBuffer({
      base64,
      fileName: pastedImageFileName(blob.type || "image/png"),
      mime: blob.type || "image/png",
    });
  };

  return (
    <div className="relative" ref={rootRef}>
      {bots.length > 0 ? (
        <MentionSuggest
          value={value}
          bots={bots}
          onPick={insertMention}
          keySinkRef={mentionKeyRef}
        />
      ) : null}

      <div className="composer-shell relative rounded-xl border border-border-strong bg-surface-1 shadow-[0_10px_40px_rgba(0,0,0,0.45)]">
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <AttachChip
                key={a.path}
                attachment={a}
                onRemove={
                  onRemoveAttachment
                    ? () => onRemoveAttachment(a.path)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 px-2.5 py-2">
          <div className="relative mb-0.5 shrink-0">
            <button
              type="button"
              title="Add context"
              aria-label="Add context"
              aria-expanded={menuOpen}
              disabled={disabled || loading || busyAttach}
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim transition hover:bg-surface-3 hover:text-fg disabled:opacity-40"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="composer-popover composer-popover-attach" role="menu">
                <div className="composer-popover-section-label">Attach</div>
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => void pickAttachments()}
                >
                  Files…
                </button>
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => void pickAttachments({ imagesOnly: true })}
                >
                  Images…
                </button>
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => void pickAttachments({ directories: true })}
                >
                  Folder…
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative min-h-[22px] min-w-0 flex-1">
            <div
              ref={mirrorRef}
              aria-hidden
              className="mention-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words py-1 text-[13px] leading-snug text-fg"
            >
              {value ? (
                parts.map((p, i) =>
                  p.type === "mention" ? (
                    <span
                      key={`${p.type}-${p.value}-${i}`}
                      className="mention-chip"
                    >
                      {p.value}
                    </span>
                  ) : (
                    <span key={`${p.type}-${i}`}>{p.value}</span>
                  ),
                )
              ) : (
                <span className="text-transparent">.</span>
              )}
            </div>
            <textarea
              ref={taRef}
              value={value}
              disabled={disabled || loading}
              rows={1}
              placeholder={
                attachments.length
                  ? "Add a message about the attachment(s)…"
                  : placeholder
              }
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={mentionOpen}
              aria-autocomplete="list"
              aria-controls="mention-listbox"
              onChange={(e) => onChange(e.target.value)}
              onPaste={(e) => {
                void handlePaste(e);
              }}
              onScroll={syncScroll}
              onKeyDown={(e) => {
                if (mentionKeyRef.current?.(e)) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) onSend();
                }
              }}
              className="mention-textarea relative z-[1] max-h-[140px] min-h-[22px] w-full resize-none border-0 bg-transparent py-1 text-[13px] leading-snug text-transparent outline-none placeholder:text-muted disabled:opacity-60"
            />
          </div>

          <button
            type="button"
            disabled={!canSend}
            onClick={onSend}
            title={loading ? "Running…" : "Send"}
            aria-label={loading ? "Running" : "Send message"}
            className="mb-0.5 ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d7dde8] text-[#0b0d11] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {loading ? (
              <span className="h-3 w-3 animate-pulse rounded-full bg-[#0b0d11]/70" />
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
