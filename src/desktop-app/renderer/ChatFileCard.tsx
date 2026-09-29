type Props = {
  path: string;
  basename?: string;
  note?: string;
  sizeLabel?: string;
  hashLabel?: string;
  onOpen: () => void;
  onSaveAs: () => void;
  onReveal?: () => void;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "picture_as_pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["md", "txt", "doc", "docx"].includes(ext)) return "description";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs"].includes(ext)) return "code";
  return "draft";
}

/** In-chat file delivery card (agent → user) — Figma deliverable. */
export function ChatFileCard({
  path: filePath,
  basename,
  note,
  sizeLabel,
  hashLabel,
  onOpen,
  onSaveAs,
  onReveal,
}: Props) {
  const name = basename || filePath.split(/[/\\]/).pop() || filePath;
  const metaParts = [
    sizeLabel,
    hashLabel,
    !sizeLabel && !hashLabel ? note || filePath : null,
  ].filter(Boolean);

  return (
    <div className="chat-file">
      <div className="chat-file-main">
        <div className="chat-file-icon" aria-hidden>
          <span className="material-symbols-outlined">{extIcon(name)}</span>
        </div>
        <div className="min-w-0">
          <div className="chat-file-name-row">
            <span className="chat-file-name">{name}</span>
            <span className="chat-file-badge">GEN COMPLETED</span>
          </div>
          <div className="chat-file-meta" title={filePath}>
            {metaParts.join(" • ")}
          </div>
        </div>
      </div>
      <div className="chat-file-actions">
        <button type="button" onClick={onOpen} className="chat-file-open">
          <span className="material-symbols-outlined text-[12px]">
            dashboard
          </span>
          Open in Canvas
        </button>
        <button
          type="button"
          onClick={onSaveAs}
          className="chat-file-icon-btn"
          title="Save as…"
          aria-label="Save as"
        >
          <span className="material-symbols-outlined text-[14px]">download</span>
        </button>
        {onReveal ? (
          <button
            type="button"
            onClick={onReveal}
            className="chat-file-icon-btn"
            title="Show in folder"
            aria-label="Show in folder"
          >
            <span className="material-symbols-outlined text-[14px]">folder</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { formatBytes };
