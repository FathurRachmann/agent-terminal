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

export type ComposerMode = "Rotating" | "Auto" | "Fixed" | "Chat" | "Coding";
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
  contextLabel?: string;
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

const MODES: ComposerMode[] = ["Rotating", "Chat", "Coding", "Auto", "Fixed"];
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
    label: "Explain this area",
    text: "Explain how this part of the codebase works, with key files and flow.",
  },
];

function effortShort(effort: ComposerEffort): string {
  return EFFORTS.find((e) => e.id === effort)?.short ?? "Med";
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
  placeholder = "What should we tackle?",
  modelLabel,
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
  const dragDepthRef = useRef(0);
  const [menu, setMenu] = useState<"attach" | "mode" | "effort" | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [localDrop, setLocalDrop] = useState(false);
  const [busyAttach, setBusyAttach] = useState(false);

  const clearDropUi = () => {
    dragDepthRef.current = 0;
    setLocalDrop(false);
    onDropActiveChange?.(false);
  };

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(140, Math.max(22, el.scrollHeight))}px`;
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
    return MODES.filter((m) => m.toLowerCase().includes(q));
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
      className={`composer-shell relative rounded-xl border border-border-strong bg-surface-1 shadow-[0_10px_40px_rgba(0,0,0,0.45)] ${
        showDropChrome ? "composer-shell-drop" : ""
      }`}
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

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a) => (
            <AttachmentChip
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
            data-tip="Add context"
            aria-label="Add context"
            aria-expanded={menu === "attach"}
            disabled={disabled || loading || busyAttach}
            onClick={() =>
              setMenu((m) => (m === "attach" ? null : "attach"))
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim transition hover:bg-surface-3 hover:text-fg disabled:opacity-40"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          {menu === "attach" ? (
            <div className="composer-popover composer-popover-attach" role="menu">
              <div className="composer-popover-section-label">Attach</div>
              <MenuItem
                label="Files..."
                onClick={() => void pickAttachments()}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                }
              />
              <MenuItem
                label="Folder..."
                onClick={() => void pickAttachments({ directories: true })}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                }
              />
              <MenuItem
                label="Images..."
                onClick={() => void pickAttachments({ imagesOnly: true })}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path d="m21 15-4.5-4.5L7 20" />
                  </svg>
                }
              />
              <MenuItem
                label="Paste image"
                onClick={() => void pasteImageFromClipboard()}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M8 5h8M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z" />
                    <path d="M8 7h8v12a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" />
                  </svg>
                }
              />
              <MenuItem
                label="URL..."
                onClick={attachUrl}
                icon={
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 5" />
                    <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07L13 19" />
                  </svg>
                }
              />
              <div className="composer-popover-divider" />
              <div className="composer-popover-section-label">Snippets</div>
              {PROMPT_SNIPPETS.map((s) => (
                <MenuItem
                  key={s.id}
                  label={s.label}
                  onClick={() => insertSnippet(s.text)}
                  icon={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                    </svg>
                  }
                />
              ))}
              <div className="composer-popover-divider" />
              <div className="composer-popover-tip">
                Tip: type <kbd>@</kbd> to reference files inline.
              </div>
            </div>
          ) : null}
        </div>

        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder={
            attachments.length
              ? "Add a message about the attachment(s)…"
              : placeholder
          }
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            void handlePaste(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="max-h-[140px] min-h-[22px] flex-1 resize-none border-0 bg-transparent py-1 text-[13px] leading-snug text-fg outline-none placeholder:text-muted disabled:opacity-60"
        />

        <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
          <div className="relative">
            <button
              type="button"
              className="composer-pill"
              title="Model"
              aria-expanded={menu === "mode"}
              onClick={() => setMenu((m) => (m === "mode" ? null : "mode"))}
            >
              <span>{mode}</span>
              <Chevron />
            </button>
            {menu === "mode" ? (
              <div className="composer-popover composer-popover-mode" role="listbox">
                <div className="composer-popover-search">
                  <input
                    autoFocus
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Search models"
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
                        className={`composer-menu-item composer-menu-item-row ${
                          selected ? "is-selected" : ""
                        }`}
                        onClick={() => {
                          onModeChange(m);
                          setMenu(null);
                          setModelQuery("");
                        }}
                      >
                        <span>
                          {m}{" "}
                          <span className="text-muted">{effortShort(effort)}</span>
                        </span>
                        {selected ? <span className="composer-check">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="composer-popover-divider" />
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => {
                    setMenu(null);
                    setModelQuery("");
                  }}
                >
                  <span className="composer-menu-icon">↻</span>
                  <span>Refresh models</span>
                </button>
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => setMenu(null)}
                >
                  <span className="composer-menu-icon">⚙</span>
                  <span>Edit models...</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              className="composer-pill"
              data-tip={`Effort: ${effortShort(effort)}`}
              title={`Effort: ${effortShort(effort)}`}
              aria-expanded={menu === "effort"}
              onClick={() =>
                setMenu((m) => (m === "effort" ? null : "effort"))
              }
            >
              <span>{effortShort(effort)}</span>
              <Chevron />
            </button>
            {menu === "effort" ? (
              <div className="composer-popover composer-popover-effort" role="menu">
                <div className="composer-popover-section-label">Options</div>
                <div className="composer-menu-item composer-menu-item-row">
                  <span>Thinking</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={thinking}
                    className={`composer-toggle ${thinking ? "is-on" : ""}`}
                    onClick={() => onThinkingChange?.(!thinking)}
                  >
                    <span className="composer-toggle-knob" />
                  </button>
                </div>
                <div className="composer-popover-divider" />
                <div className="composer-popover-section-label">Effort</div>
                {EFFORTS.map((opt) => {
                  const selected = opt.id === effort;
                  return (
                    <button
                      key={opt.id}
                      type="button"
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

          <button
            type="button"
            title="Voice input (coming soon)"
            aria-label="Voice input"
            className="composer-icon-btn text-muted/70"
            onClick={() => {
              /* not wired */
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
            </svg>
          </button>

          <button
            type="button"
            title={voiceMuted ? "Unmute agent audio" : "Mute agent audio"}
            aria-label={voiceMuted ? "Unmute" : "Mute"}
            className={`composer-icon-btn ${voiceMuted ? "is-active" : ""}`}
            onClick={onToggleVoiceMute}
          >
            {voiceMuted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="m23 9-6 6M17 9l6 6" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
              </svg>
            )}
          </button>

          <button
            type="button"
            title={privacyMode ? "Privacy mode on" : "Privacy mode"}
            aria-label="Privacy mode"
            className={`composer-icon-btn ${privacyMode ? "is-active" : ""}`}
            onClick={onTogglePrivacy}
          >
            {privacyMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M17.9 17.9A10 10 0 0 1 3.6 6.6M9.9 4.2A10 10 0 0 1 20.5 15" />
                <path d="M1 1l22 22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          <button
            type="button"
            title="Context"
            aria-label="Context"
            className="composer-icon-btn"
            onClick={() => setMenu((m) => (m === "attach" ? null : "attach"))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1.2" />
              <rect x="14" y="3" width="7" height="7" rx="1.2" />
              <rect x="3" y="14" width="7" height="7" rx="1.2" />
              <rect x="14" y="14" width="7" height="7" rx="1.2" />
            </svg>
          </button>

          <button
            type="button"
            disabled={!canSend && !loading}
            onClick={onSend}
            title={loading ? "Running…" : "Send"}
            aria-label={loading ? "Running" : "Send message"}
            className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#d7dde8] text-[#0b0d11] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {loading ? (
              <span className="h-3 w-3 animate-pulse rounded-full bg-[#0b0d11]/70" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
