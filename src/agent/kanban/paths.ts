import fs from "node:fs";
import path from "node:path";
import { agentTerminalRoot } from "../profiles/paths.js";

export function kanbanRoot(root?: string): string {
  return path.join(agentTerminalRoot(root), "kanban");
}

export function ensureKanbanRoot(root?: string): string {
  const dir = kanbanRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "boards"), { recursive: true });
  return dir;
}

export function currentBoardPointerPath(root?: string): string {
  return path.join(kanbanRoot(root), "current");
}

export function defaultBoardDbPath(root?: string): string {
  return path.join(kanbanRoot(root), "kanban.db");
}

export function boardDir(slug: string, root?: string): string {
  if (slug === "default") return kanbanRoot(root);
  return path.join(kanbanRoot(root), "boards", slug);
}

export function boardDbPath(slug: string, root?: string): string {
  if (slug === "default") return defaultBoardDbPath(root);
  return path.join(boardDir(slug, root), "kanban.db");
}

export function boardMetaPath(slug: string, root?: string): string {
  return path.join(boardDir(slug, root), "board.json");
}

export function boardWorkspacesDir(slug: string, root?: string): string {
  return path.join(boardDir(slug, root), "workspaces");
}

export function boardLogsDir(slug: string, root?: string): string {
  return path.join(boardDir(slug, root), "logs");
}

export function boardAttachmentsDir(slug: string, root?: string): string {
  return path.join(boardDir(slug, root), "attachments");
}

export function archivedBoardsDir(root?: string): string {
  return path.join(kanbanRoot(root), "boards", "_archived");
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeBoardSlug(input: string): string {
  return String(input ?? "")
    .trim()
    .toLowerCase();
}

export function isValidBoardSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug !== "_archived";
}
