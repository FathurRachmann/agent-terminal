/**
 * Division seed catalogs from vendored agency-agents roster.
 * Source: https://github.com/msitarzewski/agency-agents (MIT)
 */

import type { WorkspaceBot } from "./bots.js";
import catalogJson from "./agency-agents.catalog.json" with { type: "json" };
import {
  agencyFolderForDivision,
  type WorkspaceDivisionId,
} from "./division-options.js";

export type {
  WorkspaceDivisionId,
  WorkspaceDivisionOption,
} from "./division-options.js";
export {
  WORKSPACE_DIVISION_OPTIONS,
  agencyFolderForDivision,
  isWorkspaceDivisionId,
  resolveWorkspaceDivision,
} from "./division-options.js";

type CatalogBot = {
  id: string;
  name: string;
  role?: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  skills?: string[];
  active?: boolean;
  agencySource?: string;
};

type AgencyCatalog = {
  source?: string;
  generatedAt?: string;
  divisions: Record<string, CatalogBot[]>;
};

const catalog = catalogJson as AgencyCatalog;

export function loadAgencyAgentsCatalog(): AgencyCatalog {
  return catalog?.divisions ? catalog : { divisions: {} };
}

function toWorkspaceBot(raw: CatalogBot): WorkspaceBot {
  const tools = Array.isArray(raw.tools)
    ? raw.tools.filter((t) => typeof t === "string" && t.trim())
    : undefined;
  const skills = Array.isArray(raw.skills)
    ? raw.skills.filter((t) => typeof t === "string" && t.trim())
    : undefined;
  const basePrompt = String(raw.systemPrompt || "").trim();
  return {
    id: raw.id,
    name: raw.name,
    role: raw.role,
    description: raw.description || "",
    systemPrompt: basePrompt || undefined,
    tools: tools && tools.length ? tools : undefined,
    skills: skills && skills.length ? skills : undefined,
    active: raw.active !== false,
  };
}

export function seedBotsForDivision(
  division: WorkspaceDivisionId,
): WorkspaceBot[] {
  const folder = agencyFolderForDivision(division);
  if (!folder) return [];
  const list = loadAgencyAgentsCatalog().divisions[folder] ?? [];
  const seen = new Set<string>();
  const out: WorkspaceBot[] = [];
  for (const raw of list) {
    const bot = toWorkspaceBot(raw);
    if (!bot.id || !bot.name || seen.has(bot.id)) continue;
    seen.add(bot.id);
    out.push(bot);
  }
  return out;
}

/** Engineering roster (IT alias resolves to the same folder). */
export function getItDivisionSeedBots(): WorkspaceBot[] {
  return seedBotsForDivision("it");
}

/** @deprecated Prefer getItDivisionSeedBots() — Proxy for array-like access. */
export const IT_DIVISION_SEED_BOTS: WorkspaceBot[] = new Proxy(
  [] as WorkspaceBot[],
  {
    get(_target, prop, receiver) {
      const bots = getItDivisionSeedBots();
      if (prop === "length") return bots.length;
      if (prop === Symbol.iterator) {
        return bots[Symbol.iterator].bind(bots);
      }
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        return bots[Number(prop)];
      }
      const value = Reflect.get(bots, prop, receiver);
      return typeof value === "function" ? value.bind(bots) : value;
    },
  },
);
