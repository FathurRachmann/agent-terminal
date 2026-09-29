import fs from "node:fs";
import path from "node:path";

export type BotDefinition = {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
};

/** Stable thread id for a specialized bot's dedicated chat history. */
export const BOT_THREAD_PREFIX = "bot-";

export function isSpecializedBot(bot: BotDefinition): boolean {
  return bot.id !== "general" && Array.isArray(bot.tools) && bot.tools.length > 0;
}

export function botThreadId(botId: string): string {
  const safe = botId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${BOT_THREAD_PREFIX}${safe}`;
}

export function isBotThreadId(threadId: string): boolean {
  return threadId.startsWith(BOT_THREAD_PREFIX);
}

export function parseBotIdFromThread(threadId: string): string | null {
  if (!isBotThreadId(threadId)) return null;
  const id = threadId.slice(BOT_THREAD_PREFIX.length);
  return id || null;
}

const DEFAULT_BOTS: BotDefinition[] = [
  {
    id: "general",
    name: "General Assistant",
    description: "Semua tools aktif, jawaban umum. Default agent.",
  },
  {
    id: "coder",
    name: "Coder Bot",
    description: "Fokus pada pemrograman: terminal, file, web search, skills.",
    systemPrompt:
      "You are a senior software engineer bot. Focus on writing clean, minimal code. Always verify with tests/build after changes. Respond in Indonesian unless asked otherwise.",
    tools: ["execute", "write_file", "edit_file", "read_file", "web_search", "web_extract", "skill_manage"],
  },
  {
    id: "web-scraper",
    name: "Web Scraper Bot",
    description: "Khusus scraping web & ekstraksi data via Playwright.",
    systemPrompt:
      "You are a web scraping specialist. Use browser_open, browser_click, browser_type, browser_eval to navigate sites and extract structured data. Save output to tmp/ directory.",
    tools: ["browser_open", "browser_click", "browser_type", "browser_eval", "browser_screenshot", "write_file", "web_search", "web_extract"],
  },
  {
    id: "sysadmin",
    name: "SysAdmin Bot",
    description: "Monitor server, process, log, dan task otomatis.",
    systemPrompt:
      "You are a system administrator bot. Use process_manage to start/monitor/kill background processes, check logs, and report status clearly in Indonesian.",
    tools: ["execute", "process_manage", "read_file", "write_file"],
  },
];

function botsFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "bots.json");
}

let botsCache: { key: string; mtime: number; bots: BotDefinition[] } | null =
  null;

function normalizeBots(raw: unknown): BotDefinition[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const bots: BotDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!id || !name) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const description =
      typeof e.description === "string" ? e.description : "";
    const systemPrompt =
      typeof e.systemPrompt === "string" ? e.systemPrompt : undefined;
    let tools: string[] | undefined;
    if (Array.isArray(e.tools)) {
      tools = e.tools.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
      if (tools.length === 0) tools = undefined;
    }
    bots.push({ id, name, description, systemPrompt, tools });
  }
  return bots.length > 0 ? bots : null;
}

export function invalidateBotsCache(): void {
  botsCache = null;
}

export function getBots(workspaceRoot: string): BotDefinition[] {
  try {
    const filePath = botsFilePath(workspaceRoot);
    if (fs.existsSync(filePath)) {
      const mtime = fs.statSync(filePath).mtimeMs;
      const key = path.resolve(filePath);
      if (botsCache && botsCache.key === key && botsCache.mtime === mtime) {
        return botsCache.bots;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      const normalized = normalizeBots(parsed);
      if (normalized) {
        botsCache = { key, mtime, bots: normalized };
        return normalized;
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_BOTS;
}

export function getBot(workspaceRoot: string, id: string): BotDefinition {
  return getBots(workspaceRoot).find((b) => b.id === id) ?? DEFAULT_BOTS[0]!;
}

export function saveBots(
  workspaceRoot: string,
  bots: BotDefinition[],
): BotDefinition[] {
  const normalized = normalizeBots(bots);
  if (!normalized || normalized.length === 0) {
    throw new Error("At least one valid bot is required");
  }
  if (!normalized.some((b) => b.id === "general")) {
    normalized.unshift({
      id: "general",
      name: "General Assistant",
      description: "Semua tools aktif, jawaban umum. Default agent.",
    });
  }
  const filePath = botsFilePath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  invalidateBotsCache();
  return getBots(workspaceRoot);
}

export function initializeBots(workspaceRoot: string): void {
  const dir = path.dirname(botsFilePath(workspaceRoot));
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(botsFilePath(workspaceRoot))) {
    fs.writeFileSync(botsFilePath(workspaceRoot), JSON.stringify(DEFAULT_BOTS, null, 2));
  }
}