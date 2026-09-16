import fs from "node:fs";
import path from "node:path";
import {
  agentTerminalRoot,
  isValidProfileId,
  profileHome as profileHomePath,
  profilesDir,
  registryPath,
  soulPath,
} from "./paths.js";
import { DEFAULT_SOUL, ensureSoul, readSoul, writeSoul } from "./soul.js";

export type GatewayMode = "local" | "cloud" | "remote" | "ssh";

export type ProfileRecord = {
  id: string;
  createdAt: string;
  /** Display name; defaults to id. */
  name?: string;
};

export type ProfileRegistry = {
  version: 1;
  activeProfileId: string;
  defaultProfileId: string;
  gatewayMode: GatewayMode;
  profiles: ProfileRecord[];
};

export type ProfileSummary = ProfileRecord & {
  home: string;
  isActive: boolean;
  isDefault: boolean;
  hasEnv: boolean;
  soulPreview: string;
  skillsCount: number;
  model?: string;
};

const CLONE_FILES = [
  "settings.json",
  "bots.json",
  "AGENTS.md",
  "messaging.json",
  "capabilities-prefs.json",
  "desktop-allowlist.json",
] as const;

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

function emptyRegistry(): ProfileRegistry {
  return {
    version: 1,
    activeProfileId: "default",
    defaultProfileId: "default",
    gatewayMode: "local",
    profiles: [],
  };
}

export function loadRegistry(root?: string): ProfileRegistry {
  const file = registryPath(root);
  const raw = readJson<Partial<ProfileRegistry>>(file);
  if (!raw || raw.version !== 1 || !Array.isArray(raw.profiles)) {
    return emptyRegistry();
  }
  const profiles = raw.profiles.filter(
    (p): p is ProfileRecord =>
      Boolean(p && typeof p.id === "string" && isValidProfileId(p.id)),
  );
  const active =
    typeof raw.activeProfileId === "string" && isValidProfileId(raw.activeProfileId)
      ? raw.activeProfileId
      : "default";
  const def =
    typeof raw.defaultProfileId === "string" && isValidProfileId(raw.defaultProfileId)
      ? raw.defaultProfileId
      : "default";
  const gatewayMode: GatewayMode =
    raw.gatewayMode === "cloud" ||
    raw.gatewayMode === "remote" ||
    raw.gatewayMode === "ssh"
      ? raw.gatewayMode
      : "local";
  return {
    version: 1,
    activeProfileId: active,
    defaultProfileId: def,
    gatewayMode,
    profiles,
  };
}

export function saveRegistry(registry: ProfileRegistry, root?: string): void {
  writeJson(registryPath(root), registry);
}

function countSkills(home: string): number {
  const dir = path.join(home, ".agent", "skills");
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .length;
  } catch {
    return 0;
  }
}

function readModelHint(home: string): string | undefined {
  const settings = readJson<{ env?: { AGENT_MODEL?: string } }>(
    path.join(home, ".agent", "settings.json"),
  );
  return settings?.env?.AGENT_MODEL?.trim() || undefined;
}

export function ensureProfileHome(profileId: string, root?: string): string {
  if (!isValidProfileId(profileId)) {
    throw new Error(
      "Invalid profile id. Use lowercase letters, digits, hyphens, and underscores; must start with a letter or digit.",
    );
  }
  const home = profileHomePath(profileId, root);
  fs.mkdirSync(path.join(home, ".agent", "memory"), { recursive: true });
  fs.mkdirSync(path.join(home, ".agent", "skills"), { recursive: true });
  fs.mkdirSync(path.join(home, ".agent", "context"), { recursive: true });
  ensureSoul(home, DEFAULT_SOUL);
  return home;
}

function copyFileIfExists(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

/** Clone config/skills/SOUL from source profile (not session transcripts). */
export function cloneProfileContents(
  sourceHome: string,
  destHome: string,
  options?: { soulOverride?: string },
): void {
  fs.mkdirSync(path.join(destHome, ".agent"), { recursive: true });
  for (const name of CLONE_FILES) {
    copyFileIfExists(
      path.join(sourceHome, ".agent", name),
      path.join(destHome, ".agent", name),
    );
  }
  copyFileIfExists(
    path.join(sourceHome, ".env"),
    path.join(destHome, ".env"),
  );
  copyDirRecursive(
    path.join(sourceHome, ".agent", "skills"),
    path.join(destHome, ".agent", "skills"),
  );
  if (typeof options?.soulOverride === "string" && options.soulOverride.trim()) {
    writeSoul(destHome, options.soulOverride);
  } else {
    const soul = readSoul(sourceHome);
    writeSoul(destHome, soul.trim() ? soul : DEFAULT_SOUL);
  }
  fs.mkdirSync(path.join(destHome, ".agent", "memory"), { recursive: true });
  fs.mkdirSync(path.join(destHome, ".agent", "context"), { recursive: true });
}

export function createProfile(
  options: {
    id: string;
    cloneFrom?: string;
    soul?: string;
    name?: string;
  },
  root?: string,
): ProfileSummary {
  const id = options.id.trim().toLowerCase();
  if (!isValidProfileId(id)) {
    throw new Error(
      "Invalid profile id. Use lowercase letters, digits, hyphens, and underscores; must start with a letter or digit.",
    );
  }
  const registry = loadRegistry(root);
  if (registry.profiles.some((p) => p.id === id)) {
    throw new Error(`Profile "${id}" already exists`);
  }
  const home = profileHomePath(id, root);
  if (fs.existsSync(home) && fs.readdirSync(home).length > 0) {
    throw new Error(`Profile home already exists: ${home}`);
  }

  const fallbackClone = registry.defaultProfileId || "default";
  const rawClone = (options.cloneFrom ?? fallbackClone).trim();
  const cloneId =
    isValidProfileId(rawClone) &&
    (registry.profiles.some((p) => p.id === rawClone) || rawClone === "default")
      ? rawClone
      : fallbackClone;
  if (!isValidProfileId(cloneId)) {
    throw new Error("Invalid clone source profile id");
  }
  const sourceHome = profileHomePath(cloneId, root);
  if (!fs.existsSync(sourceHome) && cloneId !== id) {
    ensureProfileHome(cloneId, root);
  }

  ensureProfileHome(id, root);
  if (fs.existsSync(sourceHome) && path.resolve(sourceHome) !== path.resolve(home)) {
    cloneProfileContents(sourceHome, home, { soulOverride: options.soul });
  } else if (options.soul?.trim()) {
    writeSoul(home, options.soul);
  }

  const now = new Date().toISOString();
  registry.profiles.push({
    id,
    createdAt: now,
    name: options.name?.trim() || id,
  });
  saveRegistry(registry, root);
  return summarizeProfile(id, loadRegistry(root), root);
}

export function setActiveProfile(profileId: string, root?: string): ProfileRegistry {
  if (!isValidProfileId(profileId)) throw new Error("Invalid profile id");
  const registry = loadRegistry(root);
  if (!registry.profiles.some((p) => p.id === profileId)) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  ensureProfileHome(profileId, root);
  registry.activeProfileId = profileId;
  saveRegistry(registry, root);
  return registry;
}

export function setDefaultProfile(profileId: string, root?: string): ProfileRegistry {
  if (!isValidProfileId(profileId)) throw new Error("Invalid profile id");
  const registry = loadRegistry(root);
  if (!registry.profiles.some((p) => p.id === profileId)) {
    throw new Error(`Unknown profile: ${profileId}`);
  }
  registry.defaultProfileId = profileId;
  saveRegistry(registry, root);
  return registry;
}

export function setGatewayMode(mode: GatewayMode, root?: string): ProfileRegistry {
  const registry = loadRegistry(root);
  // Only local is supported at runtime; persist selection for UI.
  registry.gatewayMode = mode;
  saveRegistry(registry, root);
  return registry;
}

export function summarizeProfile(
  id: string,
  registry?: ProfileRegistry,
  root?: string,
): ProfileSummary {
  const reg = registry ?? loadRegistry(root);
  const record = reg.profiles.find((p) => p.id === id);
  if (!record) throw new Error(`Unknown profile: ${id}`);
  const home = profileHomePath(id, root);
  const soul = readSoul(home);
  return {
    ...record,
    home,
    isActive: reg.activeProfileId === id,
    isDefault: reg.defaultProfileId === id,
    hasEnv: fs.existsSync(path.join(home, ".env")),
    soulPreview: soul.trim().slice(0, 160),
    skillsCount: countSkills(home),
    model: readModelHint(home),
  };
}

export function listProfileSummaries(root?: string): ProfileSummary[] {
  const registry = loadRegistry(root);
  return registry.profiles.map((p) => summarizeProfile(p.id, registry, root));
}

export function getActiveProfileHome(root?: string): {
  registry: ProfileRegistry;
  profileId: string;
  home: string;
} {
  const registry = loadRegistry(root);
  const profileId = registry.activeProfileId || "default";
  const home = ensureProfileHome(profileId, root);
  return { registry, profileId, home };
}

export function machineRootExists(root?: string): boolean {
  return fs.existsSync(registryPath(root));
}

export { agentTerminalRoot, profilesDir, soulPath, profileHomePath as profileHome };
