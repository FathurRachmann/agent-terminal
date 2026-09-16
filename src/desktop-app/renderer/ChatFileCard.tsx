type Props = {
  path: string;
  basename?: string;
  note?: string;
  onOpen: () => void;
  onSaveAs: () => void;
  onReveal?: () => void;
};

/** In-chat file delivery card (agent → user). */
export function ChatFileCard({
  path: filePath,
  basename,
  note,
  onOpen,
  onSaveAs,
  onReveal,
}: Props) {
  const name = basename || filePath.split(/[/\\]/).pop() || filePath;
  return (
    <div className="min-w-0 w-full max-w-[90%] self-start">
      <div className="mb-1 text-[9.5px] text-muted">File from agent</div>
      <div className="overflow-hidden rounded-2xl rounded-bl-md border border-accent/35 bg-surface-3">
        <div className="flex items-start gap-3 px-3.5 py-3">
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-[10px] font-semibold tracking-wide text-accent"
            aria-hidden
          >
            FILE
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-fg">{name}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
              {filePath}
            </div>
            {note ? (
              <div className="mt-1 text-[10px] text-muted">{note}</div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border bg-surface-2 px-3 py-2">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-md bg-accent px-2.5 py-1.5 text-[10px] font-semibold text-surface-0"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onSaveAs}
            className="rounded-md border border-border px-2.5 py-1.5 text-[10px] text-fg hover:bg-surface-1"
          >
            Save as…
          </button>
          {onReveal ? (
            <button
              type="button"
              onClick={onReveal}
              className="rounded-md border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-fg"
            >
              Show in folder
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
