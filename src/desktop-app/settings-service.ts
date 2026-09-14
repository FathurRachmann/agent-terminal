import fs from "node:fs";
import path from "node:path";
import { getBots, saveBots, type BotDefinition } from "../agent/bot-manager.js";
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

export function buildSettingsSnapshot(
  workspaceRoot: string,
  allowedFolders: string[] = [workspaceRoot],
): SettingsSnapshot {
  applySettingsEnvToProcess(workspaceRoot);
  const stored = loadStoredSettings(workspaceRoot);
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
      allowedFolders,
    },
    desktop: {
      enabled: desktopEnabled,
      apps: loadDesktopAllowlist(workspaceRoot),
    },
    memory: {
      enableReflection: stored.agent.enableReflection,
      agentsMd: readAgentsMd(workspaceRoot),
      agentsMdPath: path.join(workspaceRoot, ".agent", "AGENTS.md"),
    },
    ui: stored.ui,
    bots: getBots(workspaceRoot),
    toolCatalog: TOOL_CATALOG,
    paths: {
      workspaceRoot,
      envPath: envPath(workspaceRoot),
      settingsPath: settingsPath(workspaceRoot),
      botsPath: path.join(workspaceRoot, ".agent", "bots.json"),
      desktopAllowlistPath: path.join(
        workspaceRoot,
        ".agent",
        "desktop-allowlist.json",
      ),
      capabilitiesPrefsPath: path.join(
        workspaceRoot,
        ".agent",
        "capabilities-prefs.json",
      ),
    },
    reloadRequiredHint:
      "Model, sandbox, and agent-behavior changes reload the engine when idle.",
  };
}

export function applySettingsUpdate(
  workspaceRoot: string,
  patch: SettingsUpdatePayload,
): { snapshot: SettingsSnapshot; needsReload: boolean } {
  const stored = loadStoredSettings(workspaceRoot);
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
      // Only write when user explicitly provided a new value (or clear).
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
      const n = Math.max(1, Math.min(16, Math.floor(s.ptyPoolSize)));
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
      saveDesktopAllowlist(workspaceRoot, patch.desktop.apps);
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
    writeAgentsMd(workspaceRoot, patch.memory.agentsMd);
  }

  if (patch.bots) {
    saveBots(workspaceRoot, patch.bots);
  }

  stored.env = envMirror;
  saveStoredSettings(workspaceRoot, stored);

  if (Object.keys(envUpdates).length > 0) {
    upsertEnvFile(envPath(workspaceRoot), envUpdates);
  }
  applySettingsEnvToProcess(workspaceRoot);

  return {
    snapshot: buildSettingsSnapshot(workspaceRoot),
    needsReload,
  };
}

export function ensureSettingsFile(workspaceRoot: string): void {
  const file = settingsPath(workspaceRoot);
  if (!fs.existsSync(file)) {
    saveStoredSettings(workspaceRoot, loadStoredSettings(workspaceRoot));
  }
}
