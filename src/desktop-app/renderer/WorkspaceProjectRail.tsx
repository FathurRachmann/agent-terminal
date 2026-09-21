import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityCanvas,
  type CanvasTab,
} from "./ActivityCanvas.js";
import {
  basenamePath,
  extensionOf,
  inferPreviewKind,
  languageForExt,
  normalizeCanvasKey,
} from "./activity-artifact.js";
import { GitStatusBar, type GitBranchOption, type GitChrome } from "./GitStatusBar.js";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel.js";

type Props = {
  workspaceRoot: string;
  profileId?: string;
  projectLabel?: string | null;
};

/**
 * Right rail for Workspaces: file tree + canvas preview + git chrome
 * for the assigned/active project.
 */
export function WorkspaceProjectRail({
  workspaceRoot,
  profileId = "default",
  projectLabel,
}: Props) {
  const [layer, setLayer] = useState<"files" | "canvas">("files");
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [git, setGit] = useState<GitChrome | null>(null);
  const [branches, setBranches] = useState<GitBranchOption[]>([]);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const refreshGit = useCallback(async () => {
    const api = window.electronAgent as
      | {
          getGitSummary?: () => Promise<{
            branch: string | null;
            additions: number;
            deletions: number;
            dirty?: boolean;
          }>;
          listGitBranches?: () => Promise<{
            ok: boolean;
            branches?: GitBranchOption[];
            error?: string;
          }>;
        }
      | undefined;
    if (!api?.getGitSummary) return;
    try {
      const res = await api.getGitSummary();
      if (res) {
        setGit({
          branch: res.branch,
          additions: res.additions ?? 0,
          deletions: res.deletions ?? 0,
          dirty: res.dirty,
        });
      }
    } catch {
      /* ignore */
    }
    if (api.listGitBranches) {
      try {
        const listed = await api.listGitBranches();
        if (listed?.ok && Array.isArray(listed.branches)) {
          setBranches(listed.branches);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshGit();
    })();
    const id = window.setInterval(() => {
      if (!cancelled) void refreshGit();
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workspaceRoot, refreshGit]);

  const checkoutBranch = useCallback(
    async (branch: string) => {
      const api = window.electronAgent as
        | {
            checkoutGitBranch?: (b: string) => Promise<{
              ok: boolean;
              branch?: string;
              error?: string;
            }>;
          }
        | undefined;
      if (!api?.checkoutGitBranch) return;
      setBranchSwitching(true);
      setBranchError(null);
      try {
        const res = await api.checkoutGitBranch(branch);
        if (!res?.ok) {
          setBranchError(res?.error ?? "Checkout failed");
          return;
        }
        await refreshGit();
      } catch (e) {
        setBranchError(e instanceof Error ? e.message : String(e));
      } finally {
        setBranchSwitching(false);
      }
    },
    [refreshGit],
  );

  useEffect(() => {
    setCanvasTabs([]);
    setActiveCanvasId(null);
    setLayer("files");
  }, [workspaceRoot]);

  const openFile = useCallback((relPath: string) => {
    const cleaned = relPath.trim().replace(/\\/g, "/");
    if (!cleaned) return;
    const ext = extensionOf(cleaned);
    const tab: CanvasTab = {
      id: normalizeCanvasKey(cleaned) || cleaned,
      path: cleaned,
      basename: basenamePath(cleaned),
      kind: inferPreviewKind(ext),
      language: languageForExt(ext),
    };
    setCanvasTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) return prev;
      return [...prev, tab];
    });
    setActiveCanvasId(tab.id);
    setLayer("canvas");
  }, []);

  if (!workspaceRoot || workspaceRoot === "…") {
    return (
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface-1">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
          <div className="text-[10px] font-semibold tracking-wider text-accent-soft uppercase">
            Project
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <div className="text-[11px] text-muted">
            Binding project sandbox…
          </div>
          <div className="text-[10px] text-muted">
            {projectLabel
              ? `Waiting for “${projectLabel}” cwd`
              : "Assign a project, then click it to activate"}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface-1">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wider text-accent-soft uppercase">
            Project
          </div>
          <div className="truncate text-[10px] text-muted">
            {projectLabel || workspaceRoot.split(/[/\\]/).filter(Boolean).pop()}
          </div>
        </div>
        <div className="flex rounded-md border border-border p-0.5">
          {(
            [
              ["files", "Files"],
              ["canvas", `Canvas${canvasTabs.length ? ` ${canvasTabs.length}` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayer(id)}
              className={`rounded px-2 py-0.5 text-[9.5px] ${
                layer === id
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {layer === "files" ? (
          <WorkspaceFilesPanel
            key={`ws-files-${profileId}-${workspaceRoot}`}
            workspaceRoot={workspaceRoot}
            onOpenFile={openFile}
          />
        ) : (
          <ActivityCanvas
            tabs={canvasTabs}
            activeId={activeCanvasId}
            onSelect={setActiveCanvasId}
            onClose={(id) => {
              setCanvasTabs((prev) => {
                const next = prev.filter((t) => t.id !== id);
                setActiveCanvasId((cur) =>
                  cur === id ? (next[next.length - 1]?.id ?? null) : cur,
                );
                return next;
              });
            }}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <GitStatusBar
          git={git}
          branches={branches}
          switching={branchSwitching}
          error={branchError}
          onRefreshBranches={refreshGit}
          onSelectBranch={checkoutBranch}
        />
      </div>
    </aside>
  );
}
