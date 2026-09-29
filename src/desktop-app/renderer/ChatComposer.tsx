import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  blobToBase64,
  isLongPasteText,
  pastedContentLabel,
  pastedImageFileName,
  pastedTextFileName,
  truncateMiddle,
  truncatePath,
} from "./composer-attachments.js";
import {
  ContextMentionSuggest,
  contextMentionQueryFromValue,
} from "./ContextMentionSuggest.js";
import type { MentionSuggestItem } from "./mention-suggest-static.js";

export type ComposerMode = "agent" | "ask" | "plan" | "debug";
export type ComposerEffort =
  | "Minimal"
  | "Low"
  | "Medium"
  | "High"
  | "ExtraHigh"
  | "Max"
  | "Ultra";

export type ComposerAttachment = {
  path: string;
  absPath?: string;
  basename: string;
  mime?: string;
  size?: number;
  kind: "image" | "file";
  label?: string;
  subtitle?: string;
  previewUrl?: string;
};

export type GitChrome = {
  branch: string | null;
  additions: number;
  deletions: number;
  dirty: boolean;
};

type ImportedFile = {
  path: string;
  absPath: string;
  basename: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  previewUrl?: string;
  label?: string;
};

type Props = {
  value: string;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  modelLabel?: string;
  /** Repo / workspace short name for the bottom chrome strip. */
  repoLabel?: string;
  /** e.g. "128k / 200k tokens" */
  tokenLabel?: string;
  /** e.g. "$0.042 est" */
  costLabel?: string;
  git?: GitChrome | null;
  mode: ComposerMode;
  effort: ComposerEffort;
  voiceMuted: boolean;
  privacyMode: boolean;
  thinking?: boolean;
  attachments?: ComposerAttachment[];
  onChange: (value: string) => void;
  onSend: () => void;
  onModeChange: (mode: ComposerMode) => void;
  onEffortChange: (effort: ComposerEffort) => void;
  onThinkingChange?: (enabled: boolean) => void;
  onToggleVoiceMute: () => void;
  onTogglePrivacy: () => void;
  onAddAttachments: (files: ComposerAttachment[]) => void;
  onRemoveAttachment?: (path: string) => void;
  onAttachError?: (message: string) => void;
  /** Parent column drag highlight — composer clears this on drop/leave. */
  dropActive?: boolean;
  onDropActiveChange?: (active: boolean) => void;
};

const MODES: ComposerMode[] = ["agent", "ask", "plan", "debug"];
const MODE_LABELS: Record<ComposerMode, string> = {
  agent: "Agent",
  ask: "Ask",
  plan: "Plan",
  debug: "Debug",
};
const EFFORTS: Array<{ id: ComposerEffort; label: string; short: string }> = [
  { id: "Minimal", label: "Minimal", short: "Min" },
  { id: "Low", label: "Low", short: "Low" },
  { id: "Medium", label: "Medium", short: "Med" },
  { id: "High", label: "High", short: "High" },
  { id: "ExtraHigh", label: "Extra High", short: "XHigh" },
  { id: "Max", label: "Max", short: "Max" },
  { id: "Ultra", label: "Ultra", short: "Ultra" },
];

const PROMPT_SNIPPETS = [
  {
    id: "review",
    label: "Review recent changes",
    text: "Review the recent changes in this workspace and summarize risks.",
  },
  {
    id: "tests",
    label: "Add missing tests",
    text: "Identify the riskiest untested paths and add focused tests.",
  },
  {
    id: "explain",
    label: "Explain race condition",
    text: "Explain the race condition risk in this area and how to fix it safely.",
  },
];

function effortLabel(effort: ComposerEffort): string {
  return EFFORTS.find((e) => e.id === effort)?.label ?? "Medium";
}

function toComposerAttachment(f: ImportedFile): ComposerAttachment {
  return {
    path: f.path,
    absPath: f.absPath,
    basename: f.basename,
    mime: f.mime,
    size: f.size,
    kind: f.kind,
    label: f.label,
    subtitle: f.absPath || f.path,
    previewUrl: f.previewUrl,
  };
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="composer-menu-item"
      onClick={onClick}
    >
      <span className="composer-menu-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove?: () => void;
}) {
  const fullPath = attachment.absPath || attachment.path;
  const title =
    attachment.label ||
    truncateMiddle(attachment.basename, 26);
  const subtitle = truncatePath(
    attachment.subtitle || fullPath,
    34,
  );
  return (
    <div className="composer-chip group">
      <div className="composer-chip-path-tip" role="tooltip">
        {fullPath}
      </div>
      <div className="composer-chip-thumb">
        {attachment.kind === "image" && attachment.previewUrl ? (
          <img src={attachment.previewUrl} alt="" />
        ) : (
          <DocIcon />
        )}
      </div>
      <div className="composer-chip-meta">
        <div className="composer-chip-title">{title}</div>
        <div className="composer-chip-sub">{subtitle}</div>
      </div>
      {onRemove ? (
        <button
          type="button"
          className="composer-chip-remove"
          title="Remove"
          aria-label={`Remove ${attachment.basename}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function ChatComposer({
  value,
  disabled,
  loading,
  placeholder = "Direct terminal agent or ask architecture refactoring instructions...",
  modelLabel,
  repoLabel,
  tokenLabel,
  costLabel,
  git = null,
  mode,
  effort,
  voiceMuted,
  privacyMode,
  thinking = true,
  attachments = [],
  onChange,
  onSend,
  onModeChange,
  onEffortChange,
  onThinkingChange,
  onToggleVoiceMute,
  onTogglePrivacy,
  onAddAttachments,
  onRemoveAttachment,
  onAttachError,
  dropActive = false,
  onDropActiveChange,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mentionKeyRef = useRef<((e: React.KeyboardEvent) => boolean) | null>(
    null,
  );
  const dragDepthRef = useRef(0);
  const [menu, setMenu] = useState<"attach" | "mode" | "effort" | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [localDrop, setLocalDrop] = useState(false);
  const [busyAttach, setBusyAttach] = useState(false);
  const [fileHits, setFileHits] = useState<MentionSuggestItem[]>([]);

  const clearDropUi = () => {
    dragDepthRef.current = 0;
    setLocalDrop(false);
    onDropActiveChange?.(false);
  };

  useEffect(() => {
    const q = contextMentionQueryFromValue(value);
    if (q === null) {
      setFileHits([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        const api = (
          window as unknown as {
            electronAgent?: {
              searchMentionPaths?: (query: string) => Promise<{
                ok: boolean;
                items?: MentionSuggestItem[];
              }>;
            };
          }
        ).electronAgent;
        if (!api?.searchMentionPaths) return;
        const res = await api.searchMentionPaths(q);
        if (!cancelled && res?.ok && Array.isArray(res.items)) {
          setFileHits(res.items);
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [value]);

  const pickMention = (insert: string) => {
    const replaced = value.replace(/(^|\s)@[^\s]*$/, `$1${insert}`);
    onChange(replaced);
    taRef.current?.focus();
  };

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(140, Math.max(48, el.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    const endDrag = () => {
      dragDepthRef.current = 0;
      setLocalDrop(false);
      onDropActiveChange?.(false);
    };
    window.addEventListener("dragend", endDrag);
    window.addEventListener("drop", endDrag);
    return () => {
      window.removeEventListener("dragend", endDrag);
      window.removeEventListener("drop", endDrag);
    };
  }, [onDropActiveChange]);

  const canSend =
    !disabled &&
    !loading &&
    (Boolean(value.trim()) || attachments.length > 0);

  const filteredModes = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return MODES;
    return MODES.filter(
      (m) =>
        m.toLowerCase().includes(q) ||
        (MODE_LABELS[m] ?? "").toLowerCase().includes(q),
    );
  }, [modelQuery]);

  // Overlay text only while THIS composer is the drop target — not parent column state
  // (parent state used to stick after drop when composer stopPropagation skipped App clear).
  const showDrop = localDrop;
  const showDropChrome = localDrop || dropActive;
  const gatewayLabel = modelLabel
    ? `LOCAL (${modelLabel})`
    : "LOCAL (LOCALHOST)";

  const reportError = (message: string) => {
    onAttachError?.(message);
  };

  const mergeImported = (files: ImportedFile[]) => {
    if (!files.length) return;
    onAddAttachments(files.map(toComposerAttachment));
  };

  const pickAttachments = async (options?: {
    imagesOnly?: boolean;
    directories?: boolean;
  }) => {
    setMenu(null);
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
      mergeImported(res.files);
      if (res.warnings?.length) reportError(res.warnings.join("; "));
    } finally {
      setBusyAttach(false);
    }
  };

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    if (!window.electronAgent?.importAttachmentPaths) {
      reportError("Drop import unavailable. Restart the desktop app.");
      return;
    }
    setBusyAttach(true);
    try {
      const res = await window.electronAgent.importAttachmentPaths(paths);
      if (!res?.ok) {
        reportError(res?.error || "Could not import dropped files");
        return;
      }
      mergeImported(res.files);
      if (res.warnings?.length) reportError(res.warnings.join("; "));
    } finally {
      setBusyAttach(false);
    }
  };

  const importBuffer = async (payload: {
    base64: string;
    fileName: string;
    mime?: string;
    label?: string;
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
      mergeImported([res.file]);
    } finally {
      setBusyAttach(false);
    }
  };

  const pasteImageFromClipboard = async () => {
    setMenu(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const base64 = await blobToBase64(blob);
        await importBuffer({
          base64,
          fileName: pastedImageFileName(type),
          mime: type,
        });
        return;
      }
      reportError("No image found on the clipboard.");
    } catch {
      reportError("Could not read image from clipboard.");
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const cd = e.clipboardData;
    if (!cd) return;

    const imageItem = Array.from(cd.items || []).find((it) =>
      it.type.startsWith("image/"),
    );
    if (imageItem) {
      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const base64 = await blobToBase64(blob);
      await importBuffer({
        base64,
        fileName: pastedImageFileName(blob.type || "image/png"),
        mime: blob.type || "image/png",
      });
      return;
    }

    const text = cd.getData("text/plain");
    if (text && isLongPasteText(text)) {
      e.preventDefault();
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      await importBuffer({
        base64: btoa(binary),
        fileName: pastedTextFileName(),
        mime: "text/plain",
        label: pastedContentLabel(bytes.length),
      });
    }
  };

  const handleDropFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    const paths: string[] = [];
    const buffers: File[] = [];
    for (const file of files) {
      const p =
        window.electronAgent?.getPathForFile?.(file) ||
        (file as File & { path?: string }).path ||
        "";
      if (p) paths.push(p);
      else buffers.push(file);
    }
    if (paths.length) await importPaths(paths);
    for (const file of buffers) {
      const base64 = await blobToBase64(file);
      const isImage = file.type.startsWith("image/");
      await importBuffer({
        base64,
        fileName: file.name || (isImage ? pastedImageFileName(file.type) : "drop.bin"),
        mime: file.type || undefined,
      });
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setLocalDrop(true);
    onDropActiveChange?.(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!localDrop) setLocalDrop(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setLocalDrop(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropUi();
    if (disabled || loading || busyAttach) return;
    void handleDropFiles(e.dataTransfer.files);
  };

  const insertSnippet = (text: string) => {
    setMenu(null);
    const next = value.trim() ? `${value.replace(/\s+$/, "")}\n\n${text}` : text;
    onChange(next);
    taRef.current?.focus();
  };

  const attachUrl = () => {
    setMenu(null);
    const url = window.prompt("Attach URL");
    if (!url?.trim()) return;
    const next = value.trim() ? `${value.trim()} ${url.trim()}` : url.trim();
    onChange(next);
    taRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`composer-shell${showDropChrome ? " composer-shell-drop" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {showDrop ? (
        <div className="composer-drop-overlay" aria-hidden>
          Drop files to attach
        </div>
      ) : null}

      {/* Top tool belt — MODE / EFFORT / toggles, then snippet chips */}
      <div className="composer-toolbelt">
        <div className="composer-controls">
          <div className="composer-pill-mode relative">
            <span className="composer-label">MODE:</span>
            <button
              type="button"
              className="composer-value"
              aria-expanded={menu === "mode"}
              aria-haspopup="menu"
              onClick={() => setMenu((m) => (m === "mode" ? null : "mode"))}
            >
              {MODE_LABELS[mode] ?? mode}
            </button>
            {menu === "mode" ? (
              <div className="composer-popover composer-popover-mode" role="menu">
                <div className="composer-popover-search">
                  <input
                    autoFocus
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Search modes"
                    aria-label="Search modes"
                  />
                </div>
                <div className="composer-popover-section-label">{gatewayLabel}</div>
                <div className="composer-popover-scroll">
                  {filteredModes.map((m) => {
                    const selected = m === mode;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`composer-menu-item composer-menu-item-row ${
                          selected ? "is-selected" : ""
                        }`}
                        onClick={() => {
                          onModeChange(m);
                          setMenu(null);
                          setModelQuery("");
                        }}
                      >
                        <span>{MODE_LABELS[m] ?? m}</span>
                        {selected ? <span className="composer-check">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="composer-pill-effort relative">
            <span className="composer-label">EFFORT:</span>
            <button
              type="button"
              className="composer-value composer-value-accent"
              aria-expanded={menu === "effort"}
              aria-haspopup="menu"
              onClick={() => setMenu((m) => (m === "effort" ? null : "effort"))}
            >
              {effortLabel(effort)}
            </button>
            <span className="composer-effort-tag">(O1)</span>
            {menu === "effort" ? (
              <div className="composer-popover composer-popover-effort" role="menu">
                <div className="composer-popover-section-label">Effort</div>
                {EFFORTS.map((opt) => {
                  const selected = opt.id === effort;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`composer-menu-item composer-menu-item-row ${
                        selected ? "is-selected" : ""
                      }`}
                      onClick={() => {
                        onEffortChange(opt.id);
                        setMenu(null);
                      }}
                    >
                      <span>{opt.label}</span>
                      {selected ? <span className="composer-check">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="composer-feature-toggles">
            <button
              type="button"
              onClick={() => onThinkingChange?.(!thinking)}
              className={`composer-toggle-btn${thinking ? " is-on" : ""}`}
            >
              {thinking ? <span className="composer-toggle-dot" /> : null}
              Thinking {thinking ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={onTogglePrivacy}
              title={
                privacyMode
                  ? "Privacy ON: project folders only — outside paths need your Approve"
                  : "Privacy OFF: agent can access the whole machine"
              }
              className={`composer-toggle-btn${privacyMode ? " is-on" : " is-muted"}`}
            >
              Privacy {privacyMode ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={onToggleVoiceMute}
              className="composer-toggle-btn composer-mute-btn"
            >
              <span className="material-symbols-outlined text-[11px]">
                {voiceMuted ? "mic_off" : "mic"}
              </span>
              {voiceMuted ? "Mute" : "Live"}
            </button>
          </div>
        </div>

        <div className="composer-snippets">
          {PROMPT_SNIPPETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => insertSnippet(s.text)}
              className="composer-snippet"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Attached context tray */}
      {attachments.length > 0 ? (
        <div className="composer-attached">
          <span className="composer-attached-label">ATTACHED CONTEXT:</span>
          <div className="composer-attached-chips">
            {attachments.map((a) => (
              <span key={a.path} className="composer-file-chip">
                <span className="material-symbols-outlined composer-file-chip-icon">
                  {a.kind === "image" ? "image" : "description"}
                </span>
                <span className="composer-file-chip-name">{a.basename}</span>
                {onRemoveAttachment ? (
                  <button
                    type="button"
                    className="composer-file-chip-x"
                    aria-label={`Remove ${a.basename}`}
                    onClick={() => onRemoveAttachment(a.path)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Input row — agent:~$ | textarea | attach / mic / Send */}
      <div className="composer-input-box relative">
        <ContextMentionSuggest
          value={value}
          fileHits={fileHits}
          onPick={pickMention}
          keySinkRef={mentionKeyRef}
        />
        <div className="composer-prompt" aria-hidden="true">
          agent:~$
        </div>
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          rows={1}
          aria-label="Message"
          placeholder={
            attachments.length
              ? "Add a message about the attachment(s)…"
              : "Type @ for files, Terminals, Commit, Branch, Chats…"
          }
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            void handlePaste(e);
          }}
          onKeyDown={(e) => {
            if (mentionKeyRef.current?.(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="composer-textarea"
        />
        <div className="composer-input-actions relative">
          <button
            type="button"
            title="Attach file"
            data-tip="Attach file or code chunk"
            aria-label="Attach file"
            aria-expanded={menu === "attach"}
            aria-haspopup="menu"
            disabled={disabled || loading || busyAttach}
            onClick={() => setMenu((m) => (m === "attach" ? null : "attach"))}
            className="composer-icon-action"
          >
            <span className="material-symbols-outlined">attach_file</span>
          </button>
          {menu === "attach" ? (
            <div className="composer-popover composer-popover-attach" role="menu">
              <div className="composer-popover-section-label">Attach</div>
              <MenuItem
                label="Files..."
                onClick={() => void pickAttachments()}
                icon={
                  <span className="material-symbols-outlined text-[14px]">
                    description
                  </span>
                }
              />
              <MenuItem
                label="Folder..."
                onClick={() => void pickAttachments({ directories: true })}
                icon={
                  <span className="material-symbols-outlined text-[14px]">
                    folder
                  </span>
                }
              />
              <MenuItem
                label="Images..."
                onClick={() => void pickAttachments({ imagesOnly: true })}
                icon={
                  <span className="material-symbols-outlined text-[14px]">
                    image
                  </span>
                }
              />
              <MenuItem
                label="Paste image"
                onClick={() => void pasteImageFromClipboard()}
                icon={
                  <span className="material-symbols-outlined text-[14px]">
                    content_paste
                  </span>
                }
              />
              <MenuItem
                label="URL..."
                onClick={attachUrl}
                icon={
                  <span className="material-symbols-outlined text-[14px]">
                    link
                  </span>
                }
              />
              <div className="composer-popover-divider" />
              <div className="composer-popover-tip">
                Tip: type <kbd>@</kbd> to reference files inline.
              </div>
            </div>
          ) : null}
          <button
            type="button"
            title="Voice dictation"
            aria-label={voiceMuted ? "Unmute voice dictation" : "Mute voice dictation"}
            className="composer-icon-action"
            onClick={onToggleVoiceMute}
          >
            <span className="material-symbols-outlined">mic</span>
          </button>
          <button
            type="button"
            disabled={!canSend && !loading}
            onClick={onSend}
            title={loading ? "Running…" : "Send"}
            className="composer-send"
          >
            {loading ? (
              <span className="composer-send-pulse" />
            ) : (
              <>
                <span>Send</span>
                <span className="material-symbols-outlined composer-send-return">
                  keyboard_return
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Git chrome & model metadata strip */}
      <div className="composer-chrome">
        <div className="composer-chrome-left">
          <div className="composer-chrome-branch">
            <span className="material-symbols-outlined composer-chrome-git-icon">
              fork_right
            </span>
            <span className="composer-chrome-key">branch:</span>
            <span className="composer-chrome-branch-name">
              {git?.branch || "—"}
            </span>
          </div>
          {git ? (
            <div className="composer-chrome-status">
              <span className="composer-chrome-muted">STATUS:</span>
              <span
                className={`composer-status-dot${git.dirty ? " is-dirty" : ""}`}
              />
              <span className="composer-chrome-muted">
                {git.dirty
                  ? `DIRTY (+${git.additions} / -${git.deletions})`
                  : "CLEAN"}
              </span>
            </div>
          ) : null}
          {repoLabel ? (
            <div className="composer-chrome-repo">
              <span className="composer-chrome-muted">REPO: {repoLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="composer-chrome-right">
          {modelLabel ? (
            <span className="composer-chrome-model">{modelLabel}</span>
          ) : null}
          {tokenLabel ? (
            <span className="composer-chrome-tokens">{tokenLabel}</span>
          ) : null}
          {costLabel ? (
            <span className="composer-chrome-cost">{costLabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
