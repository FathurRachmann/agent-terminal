import fs from "node:fs";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../atomic-json.js";
import {
  isWorkspaceDivisionId,
  type WorkspaceDivisionId,
} from "./division-options.js";

export type WorkspaceRecord = {
  id: string;
  name: string;
  description?: string;
  /** Seed division for this workspace (it / finance / sales / marketing). */
  division?: WorkspaceDivisionId | "none";
  projectIds: string[];
  activeProjectId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRegistry = {
  version: 1;
  workspaces: WorkspaceRecord[];
};

export type WorkspaceSummary = WorkspaceRecord & {
  memberCount: number;
  chatCount: number;
};

const WORKSPACE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidWorkspaceId(id: string): boolean {
  return WORKSPACE_ID_RE.test(id);
}

export function workspacesRegistryPath(profileHome: string): string {
  return path.join(path.resolve(profileHome), ".agent", "workspaces.json");
}

export function workspaceDir(profileHome: string, workspaceId: string): string {
  return path.join(
    path.resolve(profileHome),
    ".agent",
    "workspaces",
    workspaceId,
  );
}

function readJson<T>(file: string): T | null {
  const result = readJsonFile<T>(file);
  if (result.ok) return result.data;
  if ("corrupt" in result && result.corrupt) {
    console.warn(
      `[workspaces/registry] corrupt JSON at ${file}: ${result.error}`,
    );
  }
  return null;
}

function writeJson(file: string, data: unknown): void {
  writeJsonAtomic(file, data);
}

function emptyRegistry(): WorkspaceRegistry {
  return { version: 1, workspaces: [] };
}

function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `ws-${Date.now().toString(36)}`;
}

function normalizeProjectIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function loadWorkspaceRegistry(profileHome: string): WorkspaceRegistry {
  const file = workspacesRegistryPath(profileHome);
  const raw = readJson<Partial<WorkspaceRegistry>>(file);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.workspaces)) {
    return emptyRegistry();
  }
  const workspaces = raw.workspaces
    .filter(
      (w): w is WorkspaceRecord =>
        Boolean(
          w &&
            typeof w.id === "string" &&
            isValidWorkspaceId(w.id) &&
            typeof w.name === "string",
        ),
    )
    .map((w) => {
      const projectIds = normalizeProjectIds(
        Array.isArray(w.projectIds) ? w.projectIds.map(String) : [],
      );
      const active =
        typeof w.activeProjectId === "string" &&
        projectIds.includes(w.activeProjectId)
          ? w.activeProjectId
          : null;
      return {
        id: w.id,
        name: w.name,
        description:
          typeof w.description === "string" ? w.description : undefined,
        division: isWorkspaceDivisionId(w.division) ? w.division : undefined,
        projectIds,
        activeProjectId: active,
        createdAt: w.createdAt || new Date().toISOString(),
        updatedAt: w.updatedAt || w.createdAt || new Date().toISOString(),
      };
    });
  return { version: 1, workspaces };
}

export function saveWorkspaceRegistry(
  profileHome: string,
  registry: WorkspaceRegistry,
): void {
  writeJson(workspacesRegistryPath(profileHome), registry);
}

export function getWorkspace(
  profileHome: string,
  id: string,
): WorkspaceRecord | null {
  return (
    loadWorkspaceRegistry(profileHome).workspaces.find((w) => w.id === id) ??
    null
  );
}

export function createWorkspace(
  profileHome: string,
  input: {
    name: string;
    description?: string;
    id?: string;
    projectIds?: string[];
    division?: WorkspaceDivisionId;
  },
):
  | { ok: true; workspace: WorkspaceRecord; registry: WorkspaceRegistry }
  | { ok: false; error: string } {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "Workspace name is required" };

  const reg = loadWorkspaceRegistry(profileHome);
  let id = String(input.id || slugifyName(name)).trim().toLowerCase();
  if (!isValidWorkspaceId(id)) {
    return { ok: false, error: "Invalid workspace id" };
  }
  if (reg.workspaces.some((w) => w.id === id)) {
    id = `${id}-${Date.now().toString(36)}`;
    if (!isValidWorkspaceId(id)) {
      return { ok: false, error: "Could not allocate unique workspace id" };
    }
  }

  const now = new Date().toISOString();
  const projectIds = normalizeProjectIds(input.projectIds || []);
  const workspace: WorkspaceRecord = {
    id,
    name,
    description: String(input.description || "").trim() || undefined,
    division: input.division,
    projectIds,
    activeProjectId: projectIds[0] ?? null,
    createdAt: now,
    updatedAt: now,
  };

  fs.mkdirSync(workspaceDir(profileHome, id), { recursive: true });

  const next: WorkspaceRegistry = {
    ...reg,
    workspaces: [...reg.workspaces, workspace],
  };
  saveWorkspaceRegistry(profileHome, next);
  return { ok: true, workspace, registry: next };
}

export function updateWorkspace(
  profileHome: string,
  id: string,
  patch: { name?: string; description?: string },
):
  | { ok: true; workspace: WorkspaceRecord; registry: WorkspaceRegistry }
  | { ok: false; error: string } {
  const reg = loadWorkspaceRegistry(profileHome);
  const idx = reg.workspaces.findIndex((w) => w.id === id);
  if (idx < 0) return { ok: false, error: `Unknown workspace: ${id}` };
  const current = reg.workspaces[idx]!;
  const updated: WorkspaceRecord = {
    ...current,
    name:
      patch.name !== undefined
        ? String(patch.name).trim() || current.name
        : current.name,
    description:
      patch.description !== undefined
        ? String(patch.description).trim() || undefined
        : current.description,
    updatedAt: new Date().toISOString(),
  };
  const workspaces = [...reg.workspaces];
  workspaces[idx] = updated;
  const next = { ...reg, workspaces };
  saveWorkspaceRegistry(profileHome, next);
  return { ok: true, workspace: updated, registry: next };
}

export function deleteWorkspace(
  profileHome: string,
  id: string,
): { ok: true; registry: WorkspaceRegistry } | { ok: false; error: string } {
  const reg = loadWorkspaceRegistry(profileHome);
  if (!reg.workspaces.some((w) => w.id === id)) {
    return { ok: false, error: `Unknown workspace: ${id}` };
  }
  const next: WorkspaceRegistry = {
    ...reg,
    workspaces: reg.workspaces.filter((w) => w.id !== id),
  };
  saveWorkspaceRegistry(profileHome, next);
  const dir = workspaceDir(profileHome, id);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* best-effort cleanup */
  }
  return { ok: true, registry: next };
}

export function assignProjectToWorkspace(
  profileHome: string,
  workspaceId: string,
  projectId: string,
):
  | { ok: true; workspace: WorkspaceRecord; registry: WorkspaceRegistry }
  | { ok: false; error: string } {
  const reg = loadWorkspaceRegistry(profileHome);
  const idx = reg.workspaces.findIndex((w) => w.id === workspaceId);
  if (idx < 0) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
  const pid = String(projectId || "").trim();
  if (!pid) return { ok: false, error: "projectId required" };
  const current = reg.workspaces[idx]!;
  const projectIds = normalizeProjectIds([...current.projectIds, pid]);
  const updated: WorkspaceRecord = {
    ...current,
    projectIds,
    activeProjectId: current.activeProjectId ?? pid,
    updatedAt: new Date().toISOString(),
  };
  const workspaces = [...reg.workspaces];
  workspaces[idx] = updated;
  const next = { ...reg, workspaces };
  saveWorkspaceRegistry(profileHome, next);
  return { ok: true, workspace: updated, registry: next };
}

export function unassignProjectFromWorkspace(
  profileHome: string,
  workspaceId: string,
  projectId: string,
):
  | { ok: true; workspace: WorkspaceRecord; registry: WorkspaceRegistry }
  | { ok: false; error: string } {
  const reg = loadWorkspaceRegistry(profileHome);
  const idx = reg.workspaces.findIndex((w) => w.id === workspaceId);
  if (idx < 0) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
  const current = reg.workspaces[idx]!;
  const projectIds = current.projectIds.filter((p) => p !== projectId);
  const updated: WorkspaceRecord = {
    ...current,
    projectIds,
    activeProjectId:
      current.activeProjectId === projectId
        ? (projectIds[0] ?? null)
        : current.activeProjectId,
    updatedAt: new Date().toISOString(),
  };
  const workspaces = [...reg.workspaces];
  workspaces[idx] = updated;
  const next = { ...reg, workspaces };
  saveWorkspaceRegistry(profileHome, next);
  return { ok: true, workspace: updated, registry: next };
}

export function setWorkspaceActiveProject(
  profileHome: string,
  workspaceId: string,
  projectId: string | null,
):
  | { ok: true; workspace: WorkspaceRecord; registry: WorkspaceRegistry }
  | { ok: false; error: string } {
  const reg = loadWorkspaceRegistry(profileHome);
  const idx = reg.workspaces.findIndex((w) => w.id === workspaceId);
  if (idx < 0) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
  const current = reg.workspaces[idx]!;
  const nextId = projectId || null;
  if (nextId !== null && nextId !== "") {
    if (!current.projectIds.includes(nextId)) {
      return {
        ok: false,
        error: `Project ${nextId} is not assigned to this workspace`,
      };
    }
  }
  // No-op when unchanged — avoids bumping updatedAt and triggering UI reloads.
  if ((current.activeProjectId || null) === nextId) {
    return { ok: true, workspace: current, registry: reg };
  }
  const updated: WorkspaceRecord = {
    ...current,
    activeProjectId: nextId,
    updatedAt: new Date().toISOString(),
  };
  const workspaces = [...reg.workspaces];
  workspaces[idx] = updated;
  const next = { ...reg, workspaces };
  saveWorkspaceRegistry(profileHome, next);
  return { ok: true, workspace: updated, registry: next };
}
