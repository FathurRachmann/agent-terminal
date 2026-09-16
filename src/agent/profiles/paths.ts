import os from "node:os";
import path from "node:path";

/** Machine-level root for profile registry and homes. */
export function agentTerminalRoot(override?: string): string {
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".agent-terminal");
}

export function registryPath(root?: string): string {
  return path.join(agentTerminalRoot(root), "registry.json");
}

export function profilesDir(root?: string): string {
  return path.join(agentTerminalRoot(root), "profiles");
}

export function profileHome(profileId: string, root?: string): string {
  return path.join(profilesDir(root), profileId);
}

/**
 * Agent state lives under profileHome/.agent/ (same shape as legacy workspace `.agent`)
 * so existing path helpers keep working when given profileHome as the state root.
 * SOUL.md sits at the profile root.
 */
export function soulPath(home: string): string {
  return path.join(home, "SOUL.md");
}

export function profileAgentDir(home: string): string {
  return path.join(home, ".agent");
}

export function profileSkillsDir(home: string): string {
  return path.join(home, ".agent", "skills");
}

export function profileEnvPath(home: string): string {
  return path.join(home, ".env");
}

export function profileDesktopLogPath(home: string): string {
  return path.join(home, "desktop.log");
}

/** Valid profile id: lowercase letters, digits, hyphens, underscores; starts with letter or digit. */
export const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidProfileId(id: string): boolean {
  return PROFILE_ID_RE.test(id) && id.length <= 64;
}
