import fs from "node:fs";
import path from "node:path";

export type ProjectRecord = {
  id: string;
  name: string;
  folders: string[];
  idea?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRegistry = {
  version: 1;
  activeProjectId: string | null;
  projects: ProjectRecord[];
};

export type ProjectSummary = ProjectRecord & {
  primaryFolder: string | null;
  isActive: boolean;
};

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidProjectId(id: string): boolean {
  return PROJECT_ID_RE.test(id);
}

export function projectsRegistryPath(profileHome: string): string {
  return path.join(path.resolve(profileHome), ".agent", "projects.json");
}

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

function emptyRegistry(): ProjectRegistry {
  return {
    version: 1,
    activeProjectId: null,
    projects: [],
  };
}

function normalizeFolders(folders: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of folders) {
    const resolved = path.resolve(String(raw || "").trim());
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `project-${Date.now().toString(36)}`;
}

export function loadProjectRegistry(profileHome: string): ProjectRegistry {
  const file = projectsRegistryPath(profileHome);
  const raw = readJson<Partial<ProjectRegistry>>(file);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.projects)) {
    return emptyRegistry();
  }
  const projects = raw.projects
    .filter(
      (p): p is ProjectRecord =>
        Boolean(
          p &&
            typeof p.id === "string" &&
            isValidProjectId(p.id) &&
            typeof p.name === "string" &&
            Array.isArray(p.folders),
        ),
    )
    .map((p) => ({
      ...p,
      folders: normalizeFolders(p.folders),
      idea: typeof p.idea === "string" ? p.idea : undefined,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
    }));
  const active =
    typeof raw.activeProjectId === "string" &&
    projects.some((p) => p.id === raw.activeProjectId)
      ? raw.activeProjectId
      : null;
  return {
    version: 1,
    activeProjectId: active,
    projects,
  };
}

export function saveProjectRegistry(
  profileHome: string,
  registry: ProjectRegistry,
): void {
  writeJson(projectsRegistryPath(profileHome), registry);
}

export function getActiveProject(
  profileHome: string,
): ProjectRecord | null {
  const reg = loadProjectRegistry(profileHome);
  if (!reg.activeProjectId) return null;
  return reg.projects.find((p) => p.id === reg.activeProjectId) ?? null;
}

export function listProjectSummaries(profileHome: string): ProjectSummary[] {
  const reg = loadProjectRegistry(profileHome);
  return reg.projects.map((p) => ({
    ...p,
    primaryFolder: p.folders[0] ?? null,
    isActive: p.id === reg.activeProjectId,
  }));
}

export function createProject(
  profileHome: string,
  input: {
    name: string;
    folders: string[];
    idea?: string;
    id?: string;
    activate?: boolean;
  },
): { ok: true; project: ProjectRecord; registry: ProjectRegistry } | { ok: false; error: string } {
  const name = String(input.name || "").trim();
  if (!name) return { ok: false, error: "Project name is required" };
  const folders = normalizeFolders(input.folders || []);
  if (folders.length === 0) {
    return { ok: false, error: "Add at least one folder" };
  }
  for (const folder of folders) {
    try {
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        return { ok: false, error: `Not a folder: ${folder}` };
      }
    } catch {
      return { ok: false, error: `Cannot access folder: ${folder}` };
    }
  }

  const reg = loadProjectRegistry(profileHome);
  let id = String(input.id || slugifyName(name)).trim().toLowerCase();
  if (!isValidProjectId(id)) {
    return { ok: false, error: "Invalid project id" };
  }
  if (reg.projects.some((p) => p.id === id)) {
    id = `${id}-${Date.now().toString(36)}`;
    if (!isValidProjectId(id)) {
      return { ok: false, error: "Could not allocate unique project id" };
    }
  }

  const now = new Date().toISOString();
  const idea = String(input.idea || "").trim() || undefined;
  const project: ProjectRecord = {
    id,
    name,
    folders,
    idea,
    createdAt: now,
    updatedAt: now,
  };

  if (idea) {
    const ideaPath = path.join(folders[0]!, "IDEA.md");
    try {
      if (!fs.existsSync(ideaPath)) {
        fs.writeFileSync(ideaPath, `${idea.trim()}\n`, "utf8");
      }
    } catch (err) {
      return {
        ok: false,
        error: `Failed to write IDEA.md: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const next: ProjectRegistry = {
    ...reg,
    projects: [...reg.projects, project],
    activeProjectId:
      input.activate === false ? reg.activeProjectId : project.id,
  };
  saveProjectRegistry(profileHome, next);
  return { ok: true, project, registry: next };
}

export function updateProject(
  profileHome: string,
  id: string,
  patch: { name?: string; folders?: string[]; idea?: string },
): { ok: true; project: ProjectRecord; registry: ProjectRegistry } | { ok: false; error: string } {
  const reg = loadProjectRegistry(profileHome);
  const idx = reg.projects.findIndex((p) => p.id === id);
  if (idx < 0) return { ok: false, error: `Unknown project: ${id}` };
  const current = reg.projects[idx]!;
  const folders =
    patch.folders !== undefined
      ? normalizeFolders(patch.folders)
      : current.folders;
  if (folders.length === 0) {
    return { ok: false, error: "Add at least one folder" };
  }
  const updated: ProjectRecord = {
    ...current,
    name: patch.name !== undefined ? String(patch.name).trim() || current.name : current.name,
    folders,
    idea:
      patch.idea !== undefined
        ? String(patch.idea).trim() || undefined
        : current.idea,
    updatedAt: new Date().toISOString(),
  };
  const projects = [...reg.projects];
  projects[idx] = updated;
  const next = { ...reg, projects };
  saveProjectRegistry(profileHome, next);
  return { ok: true, project: updated, registry: next };
}

export function deleteProject(
  profileHome: string,
  id: string,
): { ok: true; registry: ProjectRegistry } | { ok: false; error: string } {
  const reg = loadProjectRegistry(profileHome);
  if (!reg.projects.some((p) => p.id === id)) {
    return { ok: false, error: `Unknown project: ${id}` };
  }
  const next: ProjectRegistry = {
    ...reg,
    projects: reg.projects.filter((p) => p.id !== id),
    activeProjectId: reg.activeProjectId === id ? null : reg.activeProjectId,
  };
  saveProjectRegistry(profileHome, next);
  return { ok: true, registry: next };
}

export function setActiveProject(
  profileHome: string,
  id: string | null,
): { ok: true; registry: ProjectRegistry; project: ProjectRecord | null } | { ok: false; error: string } {
  const reg = loadProjectRegistry(profileHome);
  if (id === null || id === "") {
    const next = { ...reg, activeProjectId: null };
    saveProjectRegistry(profileHome, next);
    return { ok: true, registry: next, project: null };
  }
  const project = reg.projects.find((p) => p.id === id);
  if (!project) return { ok: false, error: `Unknown project: ${id}` };
  const next = { ...reg, activeProjectId: id };
  saveProjectRegistry(profileHome, next);
  return { ok: true, registry: next, project };
}

export function primaryFolderOf(project: ProjectRecord | null | undefined): string | null {
  return project?.folders[0] ?? null;
}
