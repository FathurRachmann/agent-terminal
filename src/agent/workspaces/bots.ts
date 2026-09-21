import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../atomic-json.js";
import {
  IT_DIVISION_SEED_BOTS,
  resolveWorkspaceDivision,
  seedBotsForDivision,
  type WorkspaceDivisionId,
} from "./division-catalog.js";
import { workspaceDir } from "./registry.js";

export type WorkspaceBot = {
  id: string;
  name: string;
  role?: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  skills?: string[];
  /** When false, bot stays in the roster but does not reply. Default true. */
  active?: boolean;
};

export { IT_DIVISION_SEED_BOTS };
export type { WorkspaceDivisionId };

const BOT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidWorkspaceBotId(id: string): boolean {
  return BOT_ID_RE.test(id);
}

export function workspaceBotsPath(
  profileHome: string,
  workspaceId: string,
): string {
  return path.join(workspaceDir(profileHome, workspaceId), "bots.json");
}

function normalizeBots(raw: unknown): WorkspaceBot[] {
  if (!Array.isArray(raw)) return [];
  const bots: WorkspaceBot[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim().toLowerCase() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!id || !name || !isValidWorkspaceBotId(id) || seen.has(id)) continue;
    seen.add(id);
    const tools = Array.isArray(e.tools)
      ? e.tools.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;
    const skills = Array.isArray(e.skills)
      ? e.skills.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : undefined;
    const active = e.active === false ? false : true;
    bots.push({
      id,
      name,
      role: typeof e.role === "string" ? e.role.trim() || undefined : undefined,
      description: typeof e.description === "string" ? e.description : "",
      systemPrompt:
        typeof e.systemPrompt === "string" ? e.systemPrompt : undefined,
      tools: tools && tools.length > 0 ? tools : undefined,
      skills: skills && skills.length > 0 ? skills : undefined,
      active,
    });
  }
  return bots;
}

/** Bots that may reply in group chat (active !== false). */
export function activeWorkspaceBots(bots: WorkspaceBot[]): WorkspaceBot[] {
  return bots.filter((b) => b.active !== false);
}

function slugifyBot(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `bot-${Date.now().toString(36)}`;
}

export function loadWorkspaceBots(
  profileHome: string,
  workspaceId: string,
): WorkspaceBot[] {
  const file = workspaceBotsPath(profileHome, workspaceId);
  const result = readJsonFile<unknown>(file);
  if (!result.ok) {
    if ("corrupt" in result && result.corrupt) {
      console.warn(
        `[workspaces/bots] corrupt JSON at ${file}: ${result.error}`,
      );
    }
    return [];
  }
  return normalizeBots(result.data);
}

export function saveWorkspaceBots(
  profileHome: string,
  workspaceId: string,
  bots: WorkspaceBot[],
): WorkspaceBot[] {
  const normalized = normalizeBots(bots);
  const file = workspaceBotsPath(profileHome, workspaceId);
  writeJsonAtomic(file, normalized);
  return normalized;
}

export function seedItDivisionBots(
  profileHome: string,
  workspaceId: string,
): WorkspaceBot[] {
  return seedDivisionBots(profileHome, workspaceId, "it");
}

/** Seed bots for a workspace division (no-op if roster already non-empty). */
export function seedDivisionBots(
  profileHome: string,
  workspaceId: string,
  division: WorkspaceDivisionId,
): WorkspaceBot[] {
  const existing = loadWorkspaceBots(profileHome, workspaceId);
  if (existing.length > 0) return existing;
  const seed = seedBotsForDivision(division);
  if (seed.length === 0) return [];
  return saveWorkspaceBots(profileHome, workspaceId, seed);
}

export function getWorkspaceBot(
  profileHome: string,
  workspaceId: string,
  botId: string,
): WorkspaceBot | null {
  return (
    loadWorkspaceBots(profileHome, workspaceId).find((b) => b.id === botId) ??
    null
  );
}

export function createWorkspaceBot(
  profileHome: string,
  workspaceId: string,
  input: {
    name: string;
    role?: string;
    description?: string;
    systemPrompt?: string;
    tools?: string[];
    skills?: string[];
    id?: string;
  },
): { ok: true; bot: WorkspaceBot; bots: WorkspaceBot[] } | { ok: false; error: string } {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "Bot name is required" };
  const bots = loadWorkspaceBots(profileHome, workspaceId);
  let id = String(input.id || slugifyBot(name)).trim().toLowerCase();
  if (!isValidWorkspaceBotId(id)) return { ok: false, error: "Invalid bot id" };
  if (bots.some((b) => b.id === id)) {
    const suffix = `-${Date.now().toString(36)}`;
    id = `${id.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
  }
  if (!isValidWorkspaceBotId(id) || bots.some((b) => b.id === id)) {
    return { ok: false, error: "Could not allocate unique bot id" };
  }
  const bot: WorkspaceBot = {
    id,
    name,
    role: String(input.role || "").trim() || undefined,
    description: String(input.description || "").trim(),
    systemPrompt: String(input.systemPrompt || "").trim() || undefined,
    tools:
      Array.isArray(input.tools) && input.tools.length > 0
        ? input.tools.map(String)
        : undefined,
    skills:
      Array.isArray(input.skills) && input.skills.length > 0
        ? input.skills.map(String)
        : undefined,
    active: true,
  };
  const next = saveWorkspaceBots(profileHome, workspaceId, [...bots, bot]);
  return { ok: true, bot, bots: next };
}

export function updateWorkspaceBot(
  profileHome: string,
  workspaceId: string,
  botId: string,
  patch: Partial<
    Pick<
      WorkspaceBot,
      | "name"
      | "role"
      | "description"
      | "systemPrompt"
      | "tools"
      | "skills"
      | "active"
    >
  >,
): { ok: true; bot: WorkspaceBot; bots: WorkspaceBot[] } | { ok: false; error: string } {
  const bots = loadWorkspaceBots(profileHome, workspaceId);
  const idx = bots.findIndex((b) => b.id === botId);
  if (idx < 0) return { ok: false, error: `Unknown bot: ${botId}` };
  const current = bots[idx]!;
  const updated: WorkspaceBot = {
    ...current,
    name:
      patch.name !== undefined
        ? String(patch.name).trim() || current.name
        : current.name,
    role:
      patch.role !== undefined
        ? String(patch.role).trim() || undefined
        : current.role,
    description:
      patch.description !== undefined
        ? String(patch.description)
        : current.description,
    systemPrompt:
      patch.systemPrompt !== undefined
        ? String(patch.systemPrompt).trim() || undefined
        : current.systemPrompt,
    tools:
      patch.tools !== undefined
        ? patch.tools.length > 0
          ? patch.tools.map(String)
          : undefined
        : current.tools,
    skills:
      patch.skills !== undefined
        ? patch.skills.length > 0
          ? patch.skills.map(String)
          : undefined
        : current.skills,
    active:
      patch.active !== undefined ? Boolean(patch.active) : current.active !== false,
  };
  const nextList = [...bots];
  nextList[idx] = updated;
  const next = saveWorkspaceBots(profileHome, workspaceId, nextList);
  return { ok: true, bot: updated, bots: next };
}

export function deleteWorkspaceBot(
  profileHome: string,
  workspaceId: string,
  botId: string,
): { ok: true; bots: WorkspaceBot[] } | { ok: false; error: string } {
  const bots = loadWorkspaceBots(profileHome, workspaceId);
  if (!bots.some((b) => b.id === botId)) {
    return { ok: false, error: `Unknown bot: ${botId}` };
  }
  const next = saveWorkspaceBots(
    profileHome,
    workspaceId,
    bots.filter((b) => b.id !== botId),
  );
  return { ok: true, bots: next };
}

/** Build bot-scope instruction for workspace group turns. */
export function buildWorkspaceBotInstruction(
  bot: WorkspaceBot,
  extras?: {
    priorBotNames?: string[];
    parallelGroup?: boolean;
    project?: {
      id: string;
      name: string;
      folders: string[];
      primaryFolder: string | null;
    } | null;
  },
): string {
  const project = extras?.project;
  const folderLines = project?.folders?.length
    ? project.folders.map((f) => `  - ${f}`).join("\n")
    : "";
  const lines = [
    `You are "${bot.name}"${bot.role ? ` (${bot.role})` : ""} in a workspace group chat.`,
    bot.description ? `Role focus: ${bot.description}` : "",
    bot.systemPrompt || "",
    bot.skills?.length
      ? [
          `Assigned skills (read on demand via tools): ${bot.skills.join(", ")}.`,
          "Load each skill with: `read_file /skills/<skill-id>/SKILL.md` before applying its workflow.",
        ].join("\n")
      : "",
    project
      ? [
          `Assigned project: "${project.name}" (id=${project.id}).`,
          project.primaryFolder
            ? `Primary working directory (already bound for tools): ${project.primaryFolder}`
            : "",
          folderLines ? `Project folders:\n${folderLines}` : "",
          "You CAN access this project via tools (ls, read_file, execute, glob).",
          "Hard rules when asked about project contents / bugs / laporan / potensi bug / apakah bisa lihat isi project:",
          "1) Call tools FIRST on the project primary folder (absolute path above). Start with `ls` there — NOT under working/project/… (that folder is artifacts only).",
          project.primaryFolder
            ? `2) Example: \`ls ${project.primaryFolder}\` then \`ls ${project.primaryFolder}/frontend\` (or \`src\`) before claiming anything is empty.`
            : "2) After tool results, answer briefly in Indonesian with evidence (folders, files, concrete bug risks).",
          "3) After tool results, answer briefly in Indonesian with evidence (real paths + what you saw). NEVER invent \"folder kosong\" without tool output proving it.",
          "4) NEVER reply with English planning like \"I need to use the available tools…\", \"First, I should start by listing…\", \"I can use the ls command…\", or \"I need to remember to keep my response…\". That is not an answer — call tools silently.",
          "5) Do NOT ask the user for the folder path or repo URL — it is already configured.",
          "6) PDF deliverables: use pdf skill `pdf_create.py`. Diagrams = element type `mermaid` (PNG image), never raw Mermaid source text. Tables = element type `table` (black 0.5pt borders).",
          "7) Save generated files under working/project/<project-name>/ (Agent root), not in the project source tree.",
          "8) For bug hunts / laporan: cite specific files from tool results (file + why). No empty \"I'll check eslint\" plans.",
        ]
          .filter(Boolean)
          .join("\n")
      : "No project is assigned to this workspace yet — say so briefly if file access is required.",
    extras?.parallelGroup
      ? [
          "Other teammates may be answering this prompt in parallel. Stay complementary; do not wait for them or repeat the same points.",
          "Speak ONLY as your own role. Do NOT write numbered sections for other roles (no fake CTO/PM/FE/QA report in one bubble).",
          "If you are CTO: lead briefly (prioritas + arahan), then let teammates detail their domains.",
        ].join("\n")
      : extras?.priorBotNames?.length
        ? `Other teammates already replied in this turn: ${extras.priorBotNames.join(", ")}. Add complementary insight; do not repeat them.`
        : "",
    "You have the SAME tools as the global agent (files, shell, browser, vision, docs, graphify, desktop when enabled).",
    "Role focus guides what you prioritize — it does not limit which tools you may call.",
    "Shell: emit at most 3 independent `execute` calls in one turn (shared group pool has up to 10 slots for all bots).",
    "Reply as this persona only. Keep answers concise and useful for the team thread.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Tools every bot needs when a project is attached (explore + read). */
export const WORKSPACE_PROJECT_TOOL_BASE = [
  "ls",
  "read_file",
  "execute",
  "glob",
] as const;

export function mergeBotToolsForProject(
  botTools: string[] | undefined | null,
): string[] {
  const set = new Set<string>([
    ...WORKSPACE_PROJECT_TOOL_BASE,
    ...(botTools ?? []),
  ]);
  return [...set];
}
