import fs from "node:fs";
import path from "node:path";
import type { BoardMeta } from "./types.js";
import {
  archivedBoardsDir,
  boardAttachmentsDir,
  boardDbPath,
  boardDir,
  boardLogsDir,
  boardMetaPath,
  boardWorkspacesDir,
  currentBoardPointerPath,
  ensureKanbanRoot,
  isValidBoardSlug,
  kanbanRoot,
  normalizeBoardSlug,
} from "./paths.js";

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureBoardDirs(slug: string, root?: string): void {
  fs.mkdirSync(boardDir(slug, root), { recursive: true });
  fs.mkdirSync(boardWorkspacesDir(slug, root), { recursive: true });
  fs.mkdirSync(boardLogsDir(slug, root), { recursive: true });
  fs.mkdirSync(boardAttachmentsDir(slug, root), { recursive: true });
}

function defaultMeta(slug: string, name?: string): BoardMeta {
  return {
    slug,
    name: name ?? (slug === "default" ? "Default" : slug),
    description: "",
    icon: "",
    createdAt: new Date().toISOString(),
    archived: false,
  };
}

export function ensureDefaultBoard(root?: string): BoardMeta {
  ensureKanbanRoot(root);
  ensureBoardDirs("default", root);
  const metaFile = boardMetaPath("default", root);
  let meta = readJson<BoardMeta>(metaFile);
  if (!meta) {
    meta = defaultMeta("default");
    writeJson(metaFile, meta);
  }
  // Touch DB path parent exists; store opens DB lazily.
  void boardDbPath("default", root);
  return meta;
}

export function listBoards(root?: string): BoardMeta[] {
  ensureDefaultBoard(root);
  const boards: BoardMeta[] = [];
  const def = readJson<BoardMeta>(boardMetaPath("default", root));
  if (def && !def.archived) boards.push({ ...def, slug: "default" });

  const boardsRoot = path.join(kanbanRoot(root), "boards");
  if (!fs.existsSync(boardsRoot)) return boards;
  for (const entry of fs.readdirSync(boardsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const slug = entry.name;
    if (!isValidBoardSlug(slug)) continue;
    const meta =
      readJson<BoardMeta>(boardMetaPath(slug, root)) ?? defaultMeta(slug);
    if (meta.archived) continue;
    boards.push({ ...meta, slug });
  }
  return boards.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function createBoard(
  input: {
    slug: string;
    name?: string;
    description?: string;
    icon?: string;
    switchTo?: boolean;
  },
  root?: string,
): BoardMeta {
  ensureKanbanRoot(root);
  const slug = normalizeBoardSlug(input.slug);
  if (!isValidBoardSlug(slug)) {
    throw new Error(
      `Invalid board slug "${input.slug}". Use lowercase alphanumerics, hyphens, underscores (1-64 chars).`,
    );
  }
  if (slug === "default") {
    throw new Error('Board "default" already exists');
  }
  const dir = boardDir(slug, root);
  if (fs.existsSync(dir)) {
    throw new Error(`Board "${slug}" already exists`);
  }
  ensureBoardDirs(slug, root);
  const meta: BoardMeta = {
    slug,
    name: input.name?.trim() || slug,
    description: input.description?.trim() || "",
    icon: input.icon?.trim() || "",
    createdAt: new Date().toISOString(),
    archived: false,
  };
  writeJson(boardMetaPath(slug, root), meta);
  if (input.switchTo) setCurrentBoard(slug, root);
  return meta;
}

export function getBoardMeta(slug: string, root?: string): BoardMeta | null {
  const normalized = normalizeBoardSlug(slug);
  if (!isValidBoardSlug(normalized)) return null;
  ensureDefaultBoard(root);
  const meta = readJson<BoardMeta>(boardMetaPath(normalized, root));
  if (!meta) {
    if (normalized === "default") return ensureDefaultBoard(root);
    return null;
  }
  return { ...meta, slug: normalized };
}

export function renameBoard(
  slug: string,
  name: string,
  root?: string,
): BoardMeta {
  const meta = getBoardMeta(slug, root);
  if (!meta) throw new Error(`Board "${slug}" not found`);
  const next = { ...meta, name: name.trim() || meta.name };
  writeJson(boardMetaPath(meta.slug, root), next);
  return next;
}

export function updateBoardMeta(
  slug: string,
  patch: Partial<Pick<BoardMeta, "name" | "description" | "icon">>,
  root?: string,
): BoardMeta {
  const meta = getBoardMeta(slug, root);
  if (!meta) throw new Error(`Board "${slug}" not found`);
  const next: BoardMeta = {
    ...meta,
    name: patch.name !== undefined ? patch.name.trim() || meta.name : meta.name,
    description:
      patch.description !== undefined
        ? patch.description.trim()
        : meta.description,
    icon: patch.icon !== undefined ? patch.icon.trim() : meta.icon,
  };
  writeJson(boardMetaPath(meta.slug, root), next);
  return next;
}

export function getCurrentBoard(root?: string): string {
  ensureDefaultBoard(root);
  const pointer = currentBoardPointerPath(root);
  try {
    if (fs.existsSync(pointer)) {
      const slug = normalizeBoardSlug(fs.readFileSync(pointer, "utf8"));
      if (isValidBoardSlug(slug) && getBoardMeta(slug, root)) return slug;
    }
  } catch {
    /* fall through */
  }
  return "default";
}

export function setCurrentBoard(slug: string, root?: string): string {
  const normalized = normalizeBoardSlug(slug);
  if (!getBoardMeta(normalized, root)) {
    throw new Error(`Board "${slug}" not found`);
  }
  fs.writeFileSync(currentBoardPointerPath(root), `${normalized}\n`, "utf8");
  return normalized;
}

export function resolveBoardSlug(
  explicit?: string | null,
  envBoard?: string | null,
  root?: string,
): string {
  if (explicit && isValidBoardSlug(normalizeBoardSlug(explicit))) {
    const s = normalizeBoardSlug(explicit);
    if (getBoardMeta(s, root)) return s;
  }
  if (envBoard && isValidBoardSlug(normalizeBoardSlug(envBoard))) {
    const s = normalizeBoardSlug(envBoard);
    if (getBoardMeta(s, root)) return s;
  }
  return getCurrentBoard(root);
}

export function archiveBoard(slug: string, root?: string): void {
  const normalized = normalizeBoardSlug(slug);
  if (normalized === "default") {
    throw new Error('Cannot archive the "default" board');
  }
  const meta = getBoardMeta(normalized, root);
  if (!meta) throw new Error(`Board "${slug}" not found`);
  const src = boardDir(normalized, root);
  const destRoot = archivedBoardsDir(root);
  fs.mkdirSync(destRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(destRoot, `${normalized}-${stamp}`);
  fs.renameSync(src, dest);
  if (getCurrentBoard(root) === normalized) setCurrentBoard("default", root);
}

export function deleteBoard(slug: string, root?: string): void {
  const normalized = normalizeBoardSlug(slug);
  if (normalized === "default") {
    throw new Error('Cannot delete the "default" board');
  }
  const src = boardDir(normalized, root);
  if (!fs.existsSync(src)) throw new Error(`Board "${slug}" not found`);
  fs.rmSync(src, { recursive: true, force: true });
  if (getCurrentBoard(root) === normalized) setCurrentBoard("default", root);
}
