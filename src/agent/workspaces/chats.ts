import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../atomic-json.js";
import { workspaceDir } from "./registry.js";

export type GroupChatReplyMode = "auto" | "mention_only";

export type GroupChatRecord = {
  id: string;
  name: string;
  replyMode: GroupChatReplyMode;
  maxResponders: number;
  /**
   * Preferred supervisor bot id for completion review.
   * Null → auto-pick (CTO / senior / lead / …).
   */
  supervisorBotId: string | null;
  /** When false, skip post-turn supervisor review. Default true. */
  supervisorEnabled: boolean;
  /** Max group turns before supervisor forces "done". Clamped 1–20. */
  maxRounds: number;
  /** Completed group turns that ran workers (for round budget). */
  roundCount: number;
  /** Snapshot of active project when chat was last used; workspace.activeProjectId is source of truth. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const WS_THREAD_PREFIX = "ws-";
/** Separates workspaceId from chatId so hyphenated workspace ids round-trip. */
export const WS_THREAD_SEP = "__";

export function isWorkspaceThreadId(
  threadId: string | null | undefined,
): boolean {
  return Boolean(threadId && /^ws-/i.test(threadId));
}

export function workspaceThreadId(
  workspaceId: string,
  chatId: string,
): string {
  // Strip `__` so the separator stays unambiguous even if ids contain underscores.
  const ws = workspaceId
    .replace(/__/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const chat = chatId
    .replace(/__/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${WS_THREAD_PREFIX}${ws}${WS_THREAD_SEP}${chat}`;
}

export function parseWorkspaceThreadId(
  threadId: string,
): { workspaceId: string; chatId: string } | null {
  if (!isWorkspaceThreadId(threadId)) return null;
  const rest = threadId.slice(WS_THREAD_PREFIX.length);
  // Prefer last `__` so workspace ids that somehow still contain `__` round-trip.
  const sep = rest.lastIndexOf(WS_THREAD_SEP);
  if (sep > 0 && sep < rest.length - WS_THREAD_SEP.length) {
    return {
      workspaceId: rest.slice(0, sep),
      chatId: rest.slice(sep + WS_THREAD_SEP.length),
    };
  }
  // Legacy `ws-<workspace>-<chat>`: prefer last dash so hyphenated workspace ids work
  // when chat ids are single segments (e.g. general).
  const dash = rest.lastIndexOf("-");
  if (dash <= 0 || dash >= rest.length - 1) return null;
  return {
    workspaceId: rest.slice(0, dash),
    chatId: rest.slice(dash + 1),
  };
}

function chatsDir(profileHome: string, workspaceId: string): string {
  return path.join(workspaceDir(profileHome, workspaceId), "chats");
}

function chatMetaPath(
  profileHome: string,
  workspaceId: string,
  chatId: string,
): string {
  return path.join(chatsDir(profileHome, workspaceId), chatId, "meta.json");
}

function readJson<T>(file: string): T | null {
  const result = readJsonFile<T>(file);
  if (result.ok) return result.data;
  if ("corrupt" in result && result.corrupt) {
    console.warn(`[workspaces/chats] corrupt JSON at ${file}: ${result.error}`);
  }
  return null;
}

function writeJson(file: string, data: unknown): void {
  writeJsonAtomic(file, data);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || `chat-${Date.now().toString(36)}`;
}

function normalizeChat(raw: Partial<GroupChatRecord>, id: string): GroupChatRecord {
  const replyMode: GroupChatReplyMode =
    raw.replyMode === "mention_only" ? "mention_only" : "auto";
  const maxResponders = Math.min(
    10,
    Math.max(1, Number(raw.maxResponders) || 3),
  );
  const maxRounds = Math.min(20, Math.max(1, Number(raw.maxRounds) || 8));
  const roundCount = Math.max(0, Math.floor(Number(raw.roundCount) || 0));
  const supervisorBotId =
    typeof raw.supervisorBotId === "string" && raw.supervisorBotId.trim()
      ? raw.supervisorBotId.trim()
      : null;
  const supervisorEnabled = raw.supervisorEnabled !== false;
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id,
    replyMode,
    maxResponders,
    supervisorBotId,
    supervisorEnabled,
    maxRounds,
    roundCount,
    projectId:
      typeof raw.projectId === "string" && raw.projectId ? raw.projectId : null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
  };
}

export function listGroupChats(
  profileHome: string,
  workspaceId: string,
): GroupChatRecord[] {
  const dir = chatsDir(profileHome, workspaceId);
  if (!fs.existsSync(dir)) return [];
  const out: GroupChatRecord[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readJson<Partial<GroupChatRecord>>(
      chatMetaPath(profileHome, workspaceId, entry.name),
    );
    if (!meta) continue;
    out.push(normalizeChat(meta, entry.name));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getGroupChat(
  profileHome: string,
  workspaceId: string,
  chatId: string,
): GroupChatRecord | null {
  const meta = readJson<Partial<GroupChatRecord>>(
    chatMetaPath(profileHome, workspaceId, chatId),
  );
  if (!meta) return null;
  return normalizeChat(meta, chatId);
}

export function createGroupChat(
  profileHome: string,
  workspaceId: string,
  input: {
    name?: string;
    replyMode?: GroupChatReplyMode;
    maxResponders?: number;
    supervisorBotId?: string | null;
    supervisorEnabled?: boolean;
    maxRounds?: number;
    projectId?: string | null;
    id?: string;
  } = {},
): { ok: true; chat: GroupChatRecord } | { ok: false; error: string } {
  const name = String(input.name || "General").trim() || "General";
  let id = String(input.id || slugify(name)).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
    return { ok: false, error: "Invalid chat id" };
  }
  if (getGroupChat(profileHome, workspaceId, id)) {
    id = `${id}-${Date.now().toString(36)}`;
  }
  const now = new Date().toISOString();
  const chat = normalizeChat(
    {
      id,
      name,
      replyMode: input.replyMode,
      maxResponders: input.maxResponders,
      supervisorBotId: input.supervisorBotId,
      supervisorEnabled: input.supervisorEnabled,
      maxRounds: input.maxRounds,
      projectId: input.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    },
    id,
  );
  writeJson(chatMetaPath(profileHome, workspaceId, id), chat);
  return { ok: true, chat };
}

export function updateGroupChat(
  profileHome: string,
  workspaceId: string,
  chatId: string,
  patch: Partial<
    Pick<
      GroupChatRecord,
      | "name"
      | "replyMode"
      | "maxResponders"
      | "projectId"
      | "supervisorBotId"
      | "supervisorEnabled"
      | "maxRounds"
      | "roundCount"
    >
  >,
): { ok: true; chat: GroupChatRecord } | { ok: false; error: string } {
  const current = getGroupChat(profileHome, workspaceId, chatId);
  if (!current) return { ok: false, error: `Unknown chat: ${chatId}` };
  const chat = normalizeChat(
    {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    chatId,
  );
  writeJson(chatMetaPath(profileHome, workspaceId, chatId), chat);
  return { ok: true, chat };
}

export function deleteGroupChat(
  profileHome: string,
  workspaceId: string,
  chatId: string,
): { ok: true } | { ok: false; error: string } {
  const dir = path.join(chatsDir(profileHome, workspaceId), chatId);
  if (!fs.existsSync(dir)) return { ok: false, error: `Unknown chat: ${chatId}` };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
}

export function ensureDefaultGroupChat(
  profileHome: string,
  workspaceId: string,
  projectId?: string | null,
): GroupChatRecord {
  const existing = listGroupChats(profileHome, workspaceId);
  if (existing[0]) return existing[0]!;
  const created = createGroupChat(profileHome, workspaceId, {
    name: "General",
    id: "general",
    projectId: projectId ?? null,
  });
  if (!created.ok) {
    throw new Error(created.error);
  }
  return created.chat;
}

export function countGroupChats(
  profileHome: string,
  workspaceId: string,
): number {
  return listGroupChats(profileHome, workspaceId).length;
}
