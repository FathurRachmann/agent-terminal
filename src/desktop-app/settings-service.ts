import fs from "node:fs";
import path from "node:path";
import { getBots, saveBots, type BotDefinition } from "../agent/bot-manager.js";
import { soulPath as profileSoulPath } from "../agent/profiles/paths.js";
import {
  applySettingsEnvToProcess,
  envPath,
  loadStoredSettings,
  maskSecret,
  readAgentsMd,
  saveStoredSettings,
  settingsPath,
  upsertEnvFile,
  writeAgentsMd,
  type SettingsSnapshot,
  type StoredSettings,
} from "./settings-store.js";
import {
  loadDesktopAllowlist,
  saveDesktopAllowlist,
} from "../desktop/allowlist.js";

const TOOL_CATALOG: Array<{
  name: string;
  category: string;
  description: string;
}> = [
  { name: "execute", category: "Shell", description: "Run shell commands in PTY" },
  { name: "ls", category: "Filesystem", description: "List directory" },
  { name: "read_file", category: "Filesystem", description: "Read file" },
  { name: "write_file", category: "Filesystem", description: "Write file" },
  { name: "edit_file", category: "Filesystem", description: "Edit file" },
  { name: "glob", category: "Filesystem", description: "Find by glob" },
  { name: "grep", category: "Filesystem", description: "Search contents" },
  { name: "task", category: "Orchestration", description: "Delegate subagents" },
  { name: "delegate_task", category: "Orchestration", description: "Parallel workers" },
  { name: "request_folder_access", category: "Access", description: "Grant folder" },
  { name: "show_allowed_folders", category: "Access", description: "Show folders" },
  { name: "task_plan", category: "Workflow", description: "Save plan" },
  { name: "task_todos", category: "Workflow", description: "Create todos" },
  { name: "task_todo_update", category: "Workflow", description: "Update todo" },
  { name: "task_status", category: "Workflow", description: "Todo status" },
  { name: "task_verify", category: "Workflow", description: "Verify plan" },
  { name: "web_search", category: "Web", description: "Search the web" },
  { name: "web_extract", category: "Web", description: "Extract URL text" },
  { name: "memory_store", category: "Memory", description: "Store memory" },
  { name: "memory_recall", category: "Memory", description: "Recall memory" },
  { name: "remember_rule", category: "Memory", description: "Save rule" },
  { name: "skill_manage", category: "Skills", description: "Manage skills" },
  { name: "process_manage", category: "Process", description: "Background processes" },
  { name: "vault_store", category: "Vault", description: "Store secret" },
  { name: "vault_list", category: "Vault", description: "List secrets" },
  { name: "vault_get", category: "Vault", description: "Get secret" },
  { name: "vault_delete", category: "Vault", description: "Delete secret" },
  { name: "browser_open", category: "Browser", description: "Open URL" },
  { name: "browser_click", category: "Browser", description: "Click element" },
  { name: "browser_type", category: "Browser", description: "Type text" },
  { name: "browser_eval", category: "Browser", description: "Eval JS" },
  { name: "browser_screenshot", category: "Browser", description: "Screenshot" },
  { name: "browser_close", category: "Browser", description: "Close browser" },
  { name: "vision_analyze", category: "Vision", description: "Analyze image" },
  { name: "read_document", category: "Filesystem", description: "Read docx/xlsx text" },
  { name: "graphify_status", category: "Codebase graph", description: "Graph ready?" },
  { name: "graphify_query", category: "Codebase graph", description: "Query project graph" },
  { name: "graphify_path", category: "Codebase graph", description: "Path between concepts" },
  { name: "graphify_explain", category: "Codebase graph", description: "Explain a concept" },
  { name: "graphify_update", category: "Codebase graph", description: "Refresh project graph" },
  { name: "desktop_automate", category: "Desktop", description: "macOS automation" },
  {
    name: "request_desktop_app_access",
    category: "Desktop",
    description: "Grant desktop app",
  },
  { name: "show_desktop_apps", category: "Desktop", description: "List desktop apps" },
];

export type SettingsUpdatePayload = {
  model?: {
    agentModel?: string;
    routerBaseUrl?: string;
    /** Pass a new key to rotate; omit to leave unchanged; empty string clears. */
    routerApiKey?: string;
    embeddingModel?: string;
    visionModel?: string;
    contextWindowTokens?: number;
  };
  agent?: Partial<StoredSettings["agent"]>;
  sandbox?: {
    ptyTimeoutMs?: number;
    ptyPoolSize?: number;
    ptyShell?: string;
  };
  desktop?: {
    enabled?: boolean;
    apps?: string[];
  };
  memory?: {
    enableReflection?: boolean;
    agentsMd?: string;
  };
  ui?: Partial<StoredSettings["ui"]>;
  bots?: BotDefinition[];
};

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type SettingsContext = {
  /** Profile/agent state root (contains `.agent/`). */
  agentHome: string;
  /** Project tree for tools. */
  workspaceRoot: string;
  profileId?: string;
};

export function buildSettingsSnapshot(
  ctx: SettingsContext | string,
  allowedFolders?: string[],
): SettingsSnapshot {
  const agentHome =
    typeof ctx === "string" ? path.resolve(ctx) : path.resolve(ctx.agentHome);
  const workspaceRoot =
    typeof ctx === "string"
      ? agentHome
      : path.resolve(ctx.workspaceRoot || ctx.agentHome);
  const profileId =
    typeof ctx === "string" ? "default" : (ctx.profileId ?? "default");
  const folders = allowedFolders ?? [workspaceRoot];

  applySettingsEnvToProcess(agentHome);
  const stored = loadStoredSettings(agentHome);
  const apiKey = process.env.ROUTER_API_KEY ?? "";
  const desktopFlag = (process.env.DESKTOP_AUTOMATION ?? "1").trim().toLowerCase();
  const desktopEnabled = !(
    desktopFlag === "0" ||
    desktopFlag === "false" ||
    desktopFlag === "off" ||
    desktopFlag === "no"
  );

  return {
    model: {
      agentModel: process.env.AGENT_MODEL ?? "gpt-4o",
      routerBaseUrl: process.env.ROUTER_BASE_URL ?? "https://api.9router.com/v1",
      routerApiKeyConfigured: Boolean(apiKey.trim()),
      routerApiKeyMasked: maskSecret(apiKey),
      embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      visionModel:
        process.env.VISION_MODEL || process.env.AGENT_MODEL || "gemini-2.0-flash",
      contextWindowTokens: numEnv("CONTEXT_WINDOW_TOKENS", 256_000),
    },
    agent: stored.agent,
    sandbox: {
      ptyTimeoutMs: numEnv("PTY_TIMEOUT_MS", 60_000),
      ptyPoolSize: numEnv("PTY_POOL_SIZE", 3),
      ptyShell: process.env.PTY_SHELL ?? "",
      allowedFolders: folders,
    },
    desktop: {
      enabled: desktopEnabled,
      apps: loadDesktopAllowlist(agentHome),
    },
    memory: {
      enableReflection: stored.agent.enableReflection,
      agentsMd: readAgentsMd(agentHome),
      agentsMdPath: path.join(agentHome, ".agent", "AGENTS.md"),
    },
    ui: stored.ui,
    bots: getBots(agentHome),
    toolCatalog: TOOL_CATALOG,
    paths: {
      workspaceRoot,
      profileHome: agentHome,
      profileId,
      envPath: envPath(agentHome),
      settingsPath: settingsPath(agentHome),
      botsPath: path.join(agentHome, ".agent", "bots.json"),
      desktopAllowlistPath: path.join(
        agentHome,
        ".agent",
        "desktop-allowlist.json",
      ),
      capabilitiesPrefsPath: path.join(
        agentHome,
        ".agent",
        "capabilities-prefs.json",
      ),
      soulPath: profileSoulPath(agentHome),
    },
    reloadRequiredHint:
      "Model, sandbox, and agent-behavior changes reload the engine when idle.",
  };
}

export function applySettingsUpdate(
  ctx: SettingsContext | string,
  patch: SettingsUpdatePayload,
): { snapshot: SettingsSnapshot; needsReload: boolean } {
  const agentHome =
    typeof ctx === "string" ? path.resolve(ctx) : path.resolve(ctx.agentHome);
  const workspaceRoot =
    typeof ctx === "string"
      ? agentHome
      : path.resolve(ctx.workspaceRoot || ctx.agentHome);
  const profileId =
    typeof ctx === "string" ? "default" : (ctx.profileId ?? "default");
  const settingsCtx: SettingsContext = { agentHome, workspaceRoot, profileId };

  const stored = loadStoredSettings(agentHome);
  let needsReload = false;
  const envUpdates: Record<string, string | undefined> = {};
  const envMirror: NonNullable<StoredSettings["env"]> = { ...(stored.env ?? {}) };

  if (patch.model) {
    needsReload = true;
    const m = patch.model;
    if (m.agentModel !== undefined) {
      envUpdates.AGENT_MODEL = m.agentModel.trim();
      envMirror.AGENT_MODEL = m.agentModel.trim();
    }
    if (m.routerBaseUrl !== undefined) {
      envUpdates.ROUTER_BASE_URL = m.routerBaseUrl.trim();
      envMirror.ROUTER_BASE_URL = m.routerBaseUrl.trim();
    }
    if (m.embeddingModel !== undefined) {
      envUpdates.EMBEDDING_MODEL = m.embeddingModel.trim();
      envMirror.EMBEDDING_MODEL = m.embeddingModel.trim();
    }
    if (m.visionModel !== undefined) {
      envUpdates.VISION_MODEL = m.visionModel.trim();
      envMirror.VISION_MODEL = m.visionModel.trim();
    }
    if (m.contextWindowTokens !== undefined) {
      const n = Math.max(8_000, Math.floor(m.contextWindowTokens));
      envUpdates.CONTEXT_WINDOW_TOKENS = String(n);
      envMirror.CONTEXT_WINDOW_TOKENS = String(n);
    }
    if (m.routerApiKey !== undefined) {
      envUpdates.ROUTER_API_KEY = m.routerApiKey;
      if (m.routerApiKey) process.env.ROUTER_API_KEY = m.routerApiKey;
      else delete process.env.ROUTER_API_KEY;
    }
  }

  if (patch.sandbox) {
    needsReload = true;
    const s = patch.sandbox;
    if (s.ptyTimeoutMs !== undefined) {
      const n = Math.max(5_000, Math.floor(s.ptyTimeoutMs));
      envUpdates.PTY_TIMEOUT_MS = String(n);
      envMirror.PTY_TIMEOUT_MS = String(n);
    }
    if (s.ptyPoolSize !== undefined) {
      const n = Math.max(1, Math.min(10, Math.floor(s.ptyPoolSize)));
      envUpdates.PTY_POOL_SIZE = String(n);
      envMirror.PTY_POOL_SIZE = String(n);
    }
    if (s.ptyShell !== undefined) {
      envUpdates.PTY_SHELL = s.ptyShell.trim();
      envMirror.PTY_SHELL = s.ptyShell.trim();
    }
  }

  if (patch.desktop) {
    needsReload = true;
    if (patch.desktop.enabled !== undefined) {
      const flag = patch.desktop.enabled ? "1" : "0";
      envUpdates.DESKTOP_AUTOMATION = flag;
      envMirror.DESKTOP_AUTOMATION = flag;
    }
    if (patch.desktop.apps) {
      saveDesktopAllowlist(agentHome, patch.desktop.apps);
    }
  }

  if (patch.agent) {
    needsReload = true;
    stored.agent = { ...stored.agent, ...patch.agent };
  }

  if (patch.memory?.enableReflection !== undefined) {
    needsReload = true;
    stored.agent.enableReflection = patch.memory.enableReflection;
  }

  if (patch.ui) {
    stored.ui = { ...stored.ui, ...patch.ui };
  }

  if (patch.memory?.agentsMd !== undefined) {
    writeAgentsMd(agentHome, patch.memory.agentsMd);
  }

  if (patch.bots) {
    saveBots(agentHome, patch.bots);
  }

  stored.env = envMirror;
  saveStoredSettings(agentHome, stored);

  if (Object.keys(envUpdates).length > 0) {
    upsertEnvFile(envPath(agentHome), envUpdates);
  }
  applySettingsEnvToProcess(agentHome);

  return {
    snapshot: buildSettingsSnapshot(settingsCtx),
    needsReload,
  };
}

export function ensureSettingsFile(agentHome: string): void {
  const file = settingsPath(agentHome);
  if (!fs.existsSync(file)) {
    saveStoredSettings(agentHome, loadStoredSettings(agentHome));
  }
}
