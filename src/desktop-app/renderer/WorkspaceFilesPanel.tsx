import React, { useCallback, useEffect, useMemo, useState } from "react";

export type WorkspaceDirEntry = {
  name: string;
  path: string;
  kind: "file" | "dir";
};

type ListResult =
  | { ok: true; path: string; entries: WorkspaceDirEntry[] }
  | { ok: false; error: string };

type ReviewEntry = {
  path: string;
  status: string;
};

type Props = {
  workspaceRoot: string;
  onOpenFile: (relPath: string) => void;
};

function basenameOf(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return (parts[parts.length - 1] || "WORKSPACE").toUpperCase();
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-fg-dim"
    >
      {open ? (
        <path d="M3 8h18l-1.5 11.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5L3 8zM3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v0" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      )}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-fg-dim"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function TreeRow({
  depth,
  name,
  kind,
  expanded,
  selected,
  onClick,
}: {
  depth: number;
  name: string;
  kind: "file" | "dir";
  expanded?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[11px] transition ${
        selected
          ? "bg-accent/15 text-accent-soft"
          : "text-fg hover:bg-surface-2"
      }`}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {kind === "dir" ? <FolderIcon open={expanded} /> : <FileIcon />}
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}

function DirNode({
  entry,
  depth,
  selectedPath,
  onOpenFile,
  listDir,
}: {
  entry: WorkspaceDirEntry;
  depth: number;
  selectedPath: string | null;
  onOpenFile: (relPath: string) => void;
  listDir: (rel: string) => Promise<ListResult>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceDirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDir(entry.path);
      if (!res.ok) {
        setError(res.error);
        setChildren([]);
        return;
      }
      setChildren(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }, [entry.path, listDir]);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) await load();
  };

  return (
    <div>
      <TreeRow
        depth={depth}
        name={entry.name}
        kind="dir"
        expanded={expanded}
        selected={selectedPath === entry.path}
        onClick={() => void toggle()}
      />
      {expanded ? (
        <div>
          {loading ? (
            <div
              className="py-1 text-[10px] text-muted"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              Loading…
            </div>
          ) : null}
          {error ? (
            <div
              className="py-1 text-[10px] text-danger"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              {error}
            </div>
          ) : null}
          {children?.map((child) =>
            child.kind === "dir" ? (
              <DirNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
                listDir={listDir}
              />
            ) : (
              <TreeRow
                key={child.path}
                depth={depth + 1}
                name={child.name}
                kind="file"
                selected={selectedPath === child.path}
                onClick={() => onOpenFile(child.path)}
              />
            ),
          )}
          {children && children.length === 0 && !loading && !error ? (
            <div
              className="py-1 text-[10px] text-muted"
              style={{ paddingLeft: 20 + depth * 12 }}
            >
              Empty folder
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceFilesPanel({ workspaceRoot, onOpenFile }: Props) {
  const [pane, setPane] = useState<"files" | "review">("files");
  const [rootEntries, setRootEntries] = useState<WorkspaceDirEntry[]>([]);
  const [review, setReview] = useState<ReviewEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const listDir = useCallback(async (rel: string): Promise<ListResult> => {
    if (!window.electronAgent?.listWorkspaceDir) {
      return { ok: false, error: "listWorkspaceDir unavailable" };
    }
    return window.electronAgent.listWorkspaceDir(rel);
  }, []);

  const refreshRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDir("");
      if (!res.ok) {
        setError(res.error);
        setRootEntries([]);
        return;
      }
      setRootEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRootEntries([]);
    } finally {
      setLoading(false);
    }
  }, [listDir]);

  const refreshReview = useCallback(async () => {
    if (!window.electronAgent?.listWorkspaceChanges) {
      setReview([]);
      return;
    }
    try {
      const res = await window.electronAgent.listWorkspaceChanges();
      if (res?.ok) setReview(res.entries ?? []);
      else setReview([]);
    } catch {
      setReview([]);
    }
  }, []);

  useEffect(() => {
    void refreshRoot();
  }, [refreshRoot, workspaceRoot]);

  useEffect(() => {
    if (pane === "review") void refreshReview();
  }, [pane, refreshReview, workspaceRoot]);

  const rootLabel = useMemo(() => basenameOf(workspaceRoot), [workspaceRoot]);

  const openFile = (rel: string) => {
    setSelectedPath(rel);
    onOpenFile(rel);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-0.5">
        <div className="flex min-w-0 flex-1">
          {(["files", "review"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              className={`border-b-2 px-2.5 py-1.5 text-[10px] font-semibold tracking-wider uppercase ${
                pane === id
                  ? "border-accent text-fg"
                  : "border-transparent text-muted hover:text-fg-dim"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Refresh"
          aria-label="Refresh files"
          onClick={() => {
            if (pane === "files") void refreshRoot();
            else void refreshReview();
          }}
          className="rounded-md p-1 text-fg-dim hover:bg-surface-2 hover:text-fg"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-1.5 py-2">
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-accent/25 text-[8px] font-bold text-accent-soft">
          ▦
        </span>
        <span className="truncate text-[10px] font-semibold tracking-wide text-accent-soft">
          {rootLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {pane === "files" ? (
          loading && rootEntries.length === 0 ? (
            <div className="px-2 py-2 text-[10px] text-muted">Loading…</div>
          ) : error ? (
            <div className="px-2 py-2 text-[10px] text-danger">{error}</div>
          ) : rootEntries.length === 0 ? (
            <div className="px-2 py-2 text-[10px] text-muted">Empty workspace</div>
          ) : (
            rootEntries.map((entry) =>
              entry.kind === "dir" ? (
                <DirNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  selectedPath={selectedPath}
                  onOpenFile={openFile}
                  listDir={listDir}
                />
              ) : (
                <TreeRow
                  key={entry.path}
                  depth={0}
                  name={entry.name}
                  kind="file"
                  selected={selectedPath === entry.path}
                  onClick={() => openFile(entry.path)}
                />
              ),
            )
          )
        ) : review.length === 0 ? (
          <div className="px-2 py-2 text-[10px] text-muted">
            No changed files
          </div>
        ) : (
          review.map((row) => (
            <button
              key={row.path}
              type="button"
              onClick={() => openFile(row.path)}
              className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition ${
                selectedPath === row.path
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg hover:bg-surface-2"
              }`}
            >
              <FileIcon />
              <span className="min-w-0 flex-1 truncate">{row.path}</span>
              <span className="shrink-0 font-mono text-[9px] text-muted">
                {row.status}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
