import React, { useEffect, useRef, useState } from "react";

export type GitChrome = {
  branch: string | null;
  additions: number;
  deletions: number;
  dirty?: boolean;
};

export type GitBranchOption = {
  name: string;
  current: boolean;
  remote: boolean;
};

type Props = {
  git: GitChrome | null;
  branches?: GitBranchOption[];
  switching?: boolean;
  error?: string | null;
  onSelectBranch?: (branch: string) => void | Promise<void>;
  onRefreshBranches?: () => void | Promise<void>;
  className?: string;
};

/** Compact branch + diffstat bar with optional branch picker. */
export function GitStatusBar({
  git,
  branches = [],
  switching = false,
  error = null,
  onSelectBranch,
  onRefreshBranches,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (
    !git?.branch &&
    !git?.additions &&
    !git?.deletions &&
    !git?.dirty &&
    branches.length === 0
  ) {
    return null;
  }

  const branch = git?.branch || "detached";
  const additions = git?.additions ?? 0;
  const deletions = git?.deletions ?? 0;
  const dirty = Boolean(git?.dirty);
  const canPick = Boolean(onSelectBranch);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-0 px-2.5 py-1.5"
        title={git?.dirty ? "Working tree has changes" : "Git status"}
      >
        <button
          type="button"
          disabled={!canPick || switching}
          onClick={() => {
            if (!canPick) return;
            setOpen((v) => !v);
            if (!open) void onRefreshBranches?.();
          }}
          className={`flex min-w-0 items-center gap-1.5 text-left ${
            canPick ? "hover:text-fg" : ""
          } disabled:opacity-60`}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={canPick ? "Switch branch" : undefined}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="shrink-0 text-emerald-400"
          >
            <circle cx="6" cy="6" r="2.25" fill="currentColor" />
            <circle cx="6" cy="18" r="2.25" fill="currentColor" />
            <circle cx="18" cy="12" r="2.25" fill="currentColor" />
            <path
              d="M6 8.25v7.5M6 12h9.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <span className="truncate text-[11px] text-fg-dim">
            {switching ? "switching…" : branch}
          </span>
          {canPick ? (
            <span className="text-[9px] text-muted" aria-hidden>
              ▾
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          {additions > 0 || deletions > 0 ? (
            <>
              <span className="text-emerald-400">+{additions}</span>
              <span className="text-rose-400">-{deletions}</span>
            </>
          ) : dirty ? (
            <span className="text-amber-400">dirty</span>
          ) : (
            <span className="text-muted">clean</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="mt-1 text-[9.5px] leading-snug text-red-300">{error}</div>
      ) : null}

      {open && canPick ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
        >
          {branches.length === 0 ? (
            <li className="px-2.5 py-1.5 text-[10px] text-muted">
              No branches found
            </li>
          ) : (
            branches.map((b) => (
              <li key={b.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b.current}
                  disabled={b.current || switching}
                  onClick={() => {
                    void (async () => {
                      await onSelectBranch?.(b.name);
                      setOpen(false);
                    })();
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] ${
                    b.current
                      ? "bg-accent/15 text-accent-soft"
                      : "text-fg hover:bg-surface-2"
                  } disabled:opacity-70`}
                >
                  <span className="truncate">
                    {b.current ? "● " : "○ "}
                    {b.name}
                  </span>
                  {b.remote ? (
                    <span className="shrink-0 text-[9px] text-muted">remote</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
