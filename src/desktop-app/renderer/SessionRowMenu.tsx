import React, { useEffect, useRef, useState } from "react";

export type SessionProjectOption = {
  id: string;
  name: string;
};

type Props = {
  threadId: string;
  projects: SessionProjectOption[];
  currentProjectId?: string | null;
  onDelete: (threadId: string) => void | Promise<void>;
  onClear: (threadId: string) => void | Promise<void>;
  onMoveToProject: (
    threadId: string,
    projectId: string | null,
  ) => void | Promise<void>;
};

/** Three-dot menu for a sidebar session row. */
export function SessionRowMenu({
  threadId,
  projects,
  currentProjectId = null,
  onDelete,
  onClear,
  onMoveToProject,
}: Props) {
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoveOpen(false);
        setOpen(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      setMoveOpen(false);
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title="Session actions"
        aria-label="Session actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
          setMoveOpen(false);
        }}
        className={`inline-flex h-5 w-5 items-center justify-center rounded text-muted transition hover:bg-surface-3 hover:text-fg ${
          open
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus:opacity-100"
        }`}
      >
        <span aria-hidden className="text-[12px] leading-none">
          ⋯
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-1 min-w-[148px] overflow-hidden rounded-md border border-border bg-surface-2 py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            label="Clear"
            tip="Clear chat history"
            onClick={() => {
              setOpen(false);
              void onClear(threadId);
            }}
          />
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] text-fg transition hover:bg-surface-3"
              onClick={() => setMoveOpen((v) => !v)}
            >
              <span>Move to project</span>
              <span className="text-[9px] text-muted">{moveOpen ? "▾" : "▸"}</span>
            </button>
            {moveOpen ? (
              <div className="border-t border-border bg-surface-1 py-1">
                <button
                  type="button"
                  role="menuitem"
                  className={`flex w-full px-3 py-1.5 text-left text-[10.5px] transition hover:bg-surface-3 ${
                    currentProjectId == null
                      ? "text-accent-soft"
                      : "text-fg-dim"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    setMoveOpen(false);
                    void onMoveToProject(threadId, null);
                  }}
                >
                  No project (global)
                </button>
                {projects.length === 0 ? (
                  <div className="px-3 py-1.5 text-[10px] text-muted">
                    No projects yet
                  </div>
                ) : (
                  projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      className={`flex w-full truncate px-3 py-1.5 text-left text-[10.5px] transition hover:bg-surface-3 ${
                        currentProjectId === p.id
                          ? "text-accent-soft"
                          : "text-fg"
                      }`}
                      onClick={() => {
                        setOpen(false);
                        setMoveOpen(false);
                        void onMoveToProject(threadId, p.id);
                      }}
                    >
                      {p.name || p.id}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="my-0.5 border-t border-border" />
          <MenuItem
            label="Delete"
            tip="Delete session"
            danger
            onClick={() => {
              setOpen(false);
              void onDelete(threadId);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  tip,
  onClick,
  danger,
}: {
  label: string;
  tip?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={tip}
      onClick={onClick}
      className={`block w-full px-2.5 py-1.5 text-left text-[11px] transition hover:bg-surface-3 ${
        danger ? "text-danger" : "text-fg"
      }`}
    >
      {label}
    </button>
  );
}
