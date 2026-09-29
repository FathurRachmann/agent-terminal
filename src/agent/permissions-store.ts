/**
 * Cursor-style permissions.json for Auto-review steering + allowlists.
 *
 * Paths (concatenated; team overrides local):
 *   ~/.agent/permissions.json
 *   <profile>/.agent/permissions.json
 *   <workspace>/.agent/permissions.json
 *   <workspace>/.agent/team-permissions.json  (dashboard / team override)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type PermissionsFile = {
  mcpAllowlist?: string[];
  terminalAllowlist?: string[];
  autoRun?: {
    allow_instructions?: string[];
    block_instructions?: string[];
  };
};

export type MergedPermissions = {
  mcpAllowlist: string[];
  terminalAllowlist: string[];
  allowInstructions: string[];
  blockInstructions: string[];
  /** True when team-permissions.json is present and used as override. */
  teamOverride: boolean;
  sources: string[];
};

function readJsonc(file: string): PermissionsFile | null {
  try {
    if (!fs.existsSync(file)) return null;
    let raw = fs.readFileSync(file, "utf8");
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(raw) as PermissionsFile;
  } catch {
    return null;
  }
}

export function permissionsPaths(options: {
  workspaceRoot: string;
  profileHome?: string;
}): {
  user: string;
  profile: string;
  project: string;
  team: string;
} {
  const home = os.homedir();
  const profileHome = options.profileHome || options.workspaceRoot;
  return {
    user: path.join(home, ".agent", "permissions.json"),
    profile: path.join(profileHome, ".agent", "permissions.json"),
    project: path.join(options.workspaceRoot, ".agent", "permissions.json"),
    team: path.join(options.workspaceRoot, ".agent", "team-permissions.json"),
  };
}

function concatUnique(...lists: Array<string[] | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list ?? []) {
      const s = String(item || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function loadMergedPermissions(options: {
  workspaceRoot: string;
  profileHome?: string;
}): MergedPermissions {
  const paths = permissionsPaths(options);
  const team = readJsonc(paths.team);
  if (team) {
    // Team dashboard override — ignore local user/project for these controls.
    return {
      mcpAllowlist: [...(team.mcpAllowlist ?? [])],
      terminalAllowlist: [...(team.terminalAllowlist ?? [])],
      allowInstructions: [...(team.autoRun?.allow_instructions ?? [])],
      blockInstructions: [...(team.autoRun?.block_instructions ?? [])],
      teamOverride: true,
      sources: [paths.team],
    };
  }

  const user = readJsonc(paths.user);
  const profile = readJsonc(paths.profile);
  const project = readJsonc(paths.project);
  const sources = [paths.user, paths.profile, paths.project].filter((p) =>
    fs.existsSync(p),
  );

  return {
    mcpAllowlist: concatUnique(
      user?.mcpAllowlist,
      profile?.mcpAllowlist,
      project?.mcpAllowlist,
    ),
    terminalAllowlist: concatUnique(
      user?.terminalAllowlist,
      profile?.terminalAllowlist,
      project?.terminalAllowlist,
    ),
    allowInstructions: concatUnique(
      user?.autoRun?.allow_instructions,
      profile?.autoRun?.allow_instructions,
      project?.autoRun?.allow_instructions,
    ),
    blockInstructions: concatUnique(
      user?.autoRun?.block_instructions,
      profile?.autoRun?.block_instructions,
      project?.autoRun?.block_instructions,
    ),
    teamOverride: false,
    sources,
  };
}

export function writeProjectPermissions(
  workspaceRoot: string,
  data: PermissionsFile,
): string {
  const file = path.join(workspaceRoot, ".agent", "permissions.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

export function writeTeamPermissions(
  workspaceRoot: string,
  data: PermissionsFile | null,
): string {
  const file = path.join(workspaceRoot, ".agent", "team-permissions.json");
  if (data == null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return file;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

export function mcpToolAllowed(
  toolName: string,
  allowlist: readonly string[],
): boolean {
  if (!allowlist.length) return false;
  // mcp_<server>_<tool> or mcp_server_tool
  const name = toolName.replace(/^mcp_/, "");
  const parts = name.split("_");
  const server = parts[0] ?? "";
  const tool = parts.slice(1).join("_") || "*";
  for (const entry of allowlist) {
    const e = entry.trim();
    if (e === "*:*" || e === "*") return true;
    const [s, t] = e.split(":");
    if (!s) continue;
    const serverOk = s === "*" || s === server;
    const toolOk = !t || t === "*" || t === tool || e === toolName;
    if (serverOk && toolOk) return true;
    if (e === toolName) return true;
  }
  return false;
}
