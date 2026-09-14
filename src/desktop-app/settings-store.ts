import fs from "node:fs";
import path from "node:path";

export type AgentBehaviorSettings = {
  autoApproveDestructive: boolean;
  requirePlanApproval: boolean;
  enableReflection: boolean;
  enableCheckpointer: boolean;
};

export type UiSettings = {
  defaultRailOpen: boolean;
  defaultRailLayer: "trace" | "canvas";
  compactActivity: boolean;
};

export type StoredSettings = {
  version: 1;
  agent: AgentBehaviorSettings;
  ui: UiSettings;
  /** Optional overrides mirrored into process.env / .env */
  env?: Partial<{
    AGENT_MODEL: string;
    ROUTER_BASE_URL: string;
    EMBEDDING_MODEL: string;
    VISION_MODEL: string;
    CONTEXT_WINDOW_TOKENS: string;
    PTY_TIMEOUT_MS: string;
    PTY_POOL_SIZE: string;
    PTY_SHELL: string;
    DESKTOP_AUTOMATION: string;
  }>;
};

export type SettingsSnapshot = {
  model: {
    agentModel: string;
    routerBaseUrl: string;
    /** True when a key is configured; raw secret is never returned. */
    routerApiKeyConfigured: boolean;
    routerApiKeyMasked: string;
    embeddingModel: string;
    visionModel: string;
    contextWindowTokens: number;
  };
  agent: AgentBehaviorSettings;
  sandbox: {
    ptyTimeoutMs: number;
    ptyPoolSize: number;
    ptyShell: string;
    allowedFolders: string[];
  };
  desktop: {
    enabled: boolean;
    apps: string[];
  };
  memory: {
    enableReflection: boolean;
    agentsMd: string;
    agentsMdPath: string;
  };
  ui: UiSettings;
  bots: Array<{
    id: string;
    name: string;
    description: string;
    systemPrompt?: string;
    tools?: string[];
  }>;
  toolCatalog: Array<{ name: string; category: string; description: string }>;
  paths: {
    workspaceRoot: string;
    envPath: string;
    settingsPath: string;
    botsPath: string;
    desktopAllowlistPath: string;
    capabilitiesPrefsPath: string;
  };
  reloadRequiredHint: string;
};

const DEFAULT_AGENT: AgentBehaviorSettings = {
  autoApproveDestructive: true,
  requirePlanApproval: true,
  enableReflection: true,
  enableCheckpointer: true,
};

const DEFAULT_UI: UiSettings = {
  defaultRailOpen: true,
  defaultRailLayer: "trace",
  compactActivity: false,
};

export function settingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "settings.json");
}

export function envPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".env");
}

function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadStoredSettings(workspaceRoot: string): StoredSettings {
  const raw = readJsonFile<Partial<StoredSettings>>(settingsPath(workspaceRoot));
  return {
    version: 1,
    agent: { ...DEFAULT_AGENT, ...(raw?.agent ?? {}) },
    ui: { ...DEFAULT_UI, ...(raw?.ui ?? {}) },
    env: raw?.env ?? {},
  };
}

export function saveStoredSettings(
  workspaceRoot: string,
  settings: StoredSettings,
): void {
  const file = settingsPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: StoredSettings = {
    version: 1,
    agent: { ...DEFAULT_AGENT, ...settings.agent },
    ui: { ...DEFAULT_UI, ...settings.ui },
    env: settings.env ?? {},
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Apply settings.json env overrides into process.env (boot + after save). */
export function applySettingsEnvToProcess(workspaceRoot: string): void {
  const stored = loadStoredSettings(workspaceRoot);
  const env = stored.env ?? {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }
}

export function maskSecret(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 8) return "••••••••";
  return `${v.slice(0, 3)}${"•".repeat(Math.min(12, v.length - 6))}${v.slice(-3)}`;
}

/**
 * Upsert keys in `.env` without wiping unrelated lines/comments.
 * Empty string values remove the assignment (leave key commented out).
 */
export function upsertEnvFile(
  file: string,
  updates: Record<string, string | undefined>,
): void {
  let content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!content.endsWith("\n") && content.length > 0) content += "\n";

  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue === undefined) continue;
    const value = rawValue;
    const lineRe = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    if (value === "") {
      // Keep key but clear value so user sees it exists
      if (lineRe.test(content)) {
        content = content.replace(lineRe, `${key}=`);
      }
      continue;
    }
    const line = `${key}=${value}`;
    if (lineRe.test(content)) {
      content = content.replace(lineRe, line);
    } else {
      content = `${content.trimEnd()}\n${line}\n`;
    }
    process.env[key] = value;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readAgentsMd(workspaceRoot: string): string {
  const file = path.join(workspaceRoot, ".agent", "AGENTS.md");
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

export function writeAgentsMd(workspaceRoot: string, content: string): void {
  const file = path.join(workspaceRoot, ".agent", "AGENTS.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export { DEFAULT_AGENT, DEFAULT_UI };
