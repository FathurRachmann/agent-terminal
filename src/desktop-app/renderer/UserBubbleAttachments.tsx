import type { UserBubbleAttachment } from "./user-message-attachments.js";

type Props = {
  attachments: UserBubbleAttachment[];
};

/** Image / file previews inside a sent user bubble. */
export function UserBubbleAttachments({ attachments }: Props) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {attachments.map((a) => {
        const key = a.path || a.basename;
        if (a.kind === "image") {
          return (
            <div
              key={key}
              className="overflow-hidden rounded-xl border border-accent/20 bg-black/25"
              title={a.absPath || a.path}
            >
              {a.previewUrl ? (
                <img
                  src={a.previewUrl}
                  alt={a.basename}
                  className="max-h-56 max-w-full object-contain"
                />
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-fg-dim">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-[9px] font-semibold tracking-wide text-accent">
                    IMG
                  </span>
                  <span className="min-w-0 truncate">{a.label || a.basename}</span>
                </div>
              )}
            </div>
          );
        }
        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-xl border border-accent/20 bg-black/20 px-2.5 py-2"
            title={a.absPath || a.path}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[9px] font-semibold tracking-wide text-muted">
              FILE
            </span>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-fg">
                {a.label || a.basename}
              </div>
              <div className="truncate font-mono text-[9.5px] text-muted">
                {a.path}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
