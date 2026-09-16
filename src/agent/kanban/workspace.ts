import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { KanbanStore } from "./store.js";
import { boardAttachmentsDir, boardWorkspacesDir } from "./paths.js";
import type { KanbanTask, WorkspaceKind } from "./types.js";

export type ResolvedWorkspace = {
  kind: WorkspaceKind;
  cwd: string;
  ephemeral: boolean;
};

export function resolveWorkspace(
  task: KanbanTask,
  boardSlug: string,
  root?: string,
  defaultWorkdir?: string,
): ResolvedWorkspace {
  if (task.workspaceKind === "dir") {
    const dir = task.workspacePath?.trim();
    if (!dir || !path.isAbsolute(dir)) {
      throw new Error(
        `dir workspace requires an absolute path (got ${task.workspacePath ?? "empty"})`,
      );
    }
    if (dir.includes("..")) {
      throw new Error(`dir workspace path must not contain ..`);
    }
    if (!fs.existsSync(dir)) {
      throw new Error(`Workspace dir does not exist: ${dir}`);
    }
    return { kind: "dir", cwd: dir, ephemeral: false };
  }

  if (task.workspaceKind === "worktree") {
    const base =
      task.workspacePath?.trim() ||
      defaultWorkdir?.trim() ||
      process.cwd();
    const absBase = path.isAbsolute(base) ? base : path.resolve(base);
    const wtPath =
      task.workspacePath && path.isAbsolute(task.workspacePath)
        ? task.workspacePath
        : path.join(absBase, ".worktrees", task.id);
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });
    if (!fs.existsSync(wtPath)) {
      const branch = task.branch || `kanban/${task.id}`;
      try {
        execFileSync(
          "git",
          ["worktree", "add", "-b", branch, wtPath, "HEAD"],
          { cwd: absBase, stdio: "ignore" },
        );
      } catch {
        // Fallback: plain directory if git worktree fails
        fs.mkdirSync(wtPath, { recursive: true });
      }
    }
    return { kind: "worktree", cwd: wtPath, ephemeral: false };
  }

  // scratch
  const scratch = path.join(
    boardWorkspacesDir(boardSlug, root),
    task.id,
  );
  fs.mkdirSync(scratch, { recursive: true });
  return { kind: "scratch", cwd: scratch, ephemeral: true };
}

export function copyArtifactsToAttachments(
  store: KanbanStore,
  task: KanbanTask,
  boardSlug: string,
  artifactPaths: string[],
  root?: string,
): string[] {
  const destRoot = path.join(boardAttachmentsDir(boardSlug, root), task.id);
  fs.mkdirSync(destRoot, { recursive: true });
  const copied: string[] = [];
  for (const src of artifactPaths) {
    if (!src || !fs.existsSync(src)) continue;
    const name = path.basename(src);
    const dest = path.join(destRoot, name);
    fs.copyFileSync(src, dest);
    const stat = fs.statSync(dest);
    store.addAttachment(task.id, name, dest, stat.size);
    copied.push(dest);
  }
  return copied;
}

export function cleanupScratchWorkspace(
  task: KanbanTask,
  boardSlug: string,
  root?: string,
): void {
  if (task.workspaceKind !== "scratch") return;
  const scratch = path.join(boardWorkspacesDir(boardSlug, root), task.id);
  if (fs.existsSync(scratch)) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function gcBoard(
  boardSlug: string,
  opts?: { eventRetentionDays?: number; logRetentionDays?: number },
  root?: string,
): { removedWorkspaces: number } {
  const wsRoot = boardWorkspacesDir(boardSlug, root);
  let removed = 0;
  if (fs.existsSync(wsRoot)) {
    for (const entry of fs.readdirSync(wsRoot)) {
      const full = path.join(wsRoot, entry);
      try {
        fs.rmSync(full, { recursive: true, force: true });
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  }
  void opts;
  return { removedWorkspaces: removed };
}
