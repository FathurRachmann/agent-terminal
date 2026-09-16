import fs from "node:fs";
import path from "node:path";
import {
  agentTerminalRoot,
  profileHome,
  registryPath,
} from "./paths.js";
import {
  ensureProfileHome,
  loadRegistry,
  saveRegistry,
  type ProfileRegistry,
} from "./registry.js";
import { DEFAULT_SOUL, writeSoul } from "./soul.js";

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

/**
 * First-run: seed `default` profile from workspace `.agent/` when registry is missing.
 * Idempotent — no-op if registry.json already exists.
 */
export function migrateWorkspaceAgentToProfiles(
  workspaceRoot: string,
  machineRoot?: string,
): {
  migrated: boolean;
  profileId: string;
  home: string;
  registry: ProfileRegistry;
} {
  const root = machineRoot ?? agentTerminalRoot();
  const regFile = registryPath(root);
  if (fs.existsSync(regFile)) {
    const registry = loadRegistry(root);
    const profileId = registry.activeProfileId || "default";
    const home = ensureProfileHome(profileId, root);
    return { migrated: false, profileId, home, registry };
  }

  const home = ensureProfileHome("default", root);
  const workspaceAgent = path.join(workspaceRoot, ".agent");
  if (fs.existsSync(workspaceAgent)) {
    copyDirRecursive(workspaceAgent, path.join(home, ".agent"));
  }

  const soulFile = path.join(home, "SOUL.md");
  if (!fs.existsSync(soulFile) || !fs.readFileSync(soulFile, "utf8").trim()) {
    writeSoul(home, DEFAULT_SOUL);
  }

  const now = new Date().toISOString();
  const registry: ProfileRegistry = {
    version: 1,
    activeProfileId: "default",
    defaultProfileId: "default",
    gatewayMode: "local",
    profiles: [{ id: "default", createdAt: now, name: "default" }],
  };
  saveRegistry(registry, root);

  return { migrated: true, profileId: "default", home, registry };
}
