import type { UserBubbleAttachment } from "./user-message-attachments.js";

type Props = {
  attachments: UserBubbleAttachment[];
};

function formatSize(bytes?: number): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Image / file chips inside a sent user bubble — Figma attach tray. */
export function UserBubbleAttachments({ attachments }: Props) {
  if (!attachments.length) return null;
  return (
    <div className="chat-attach-row">
      {attachments.map((a) => {
        const key = a.path || a.basename;
        const size = formatSize(a.size);
        if (a.kind === "image" && a.previewUrl) {
          return (
            <div key={key} title={a.absPath || a.path}>
              <img
                src={a.previewUrl}
                alt={a.basename}
                className="chat-attach-img"
              />
            </div>
          );
        }
        return (
          <span
            key={key}
            className="chat-attach-chip"
            title={a.absPath || a.path}
          >
            <span className="material-symbols-outlined">
              {a.kind === "image" ? "image" : "description"}
            </span>
            <span className="chat-attach-name">{a.label || a.basename}</span>
            {size ? <span className="chat-attach-size">{size}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
