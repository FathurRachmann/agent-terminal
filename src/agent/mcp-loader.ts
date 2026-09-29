import fs from "node:fs";
import path from "node:path";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { filterMcpServers } from "./capabilities-catalog.js";

export type McpServerConfig = {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
  transport?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  description?: string;
  cwd?: string;
};

export type LoadedMcp = {
  tools: StructuredToolInterface[];
  serverNames: string[];
  close: () => Promise<void>;
};

/** Candidate paths for MCP config (first existing wins). */
export function mcpConfigPaths(roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    out.push(path.join(root, ".agent", "mcp.json"));
    out.push(path.join(root, ".mcp.json"));
  }
  return out;
}

/** Read mcpServers map from the first readable config under roots. */
export function readMcpServerMap(
  roots: string[],
): { file: string; servers: Record<string, McpServerConfig> } | null {
  for (const file of mcpConfigPaths(roots)) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        mcpServers?: Record<string, McpServerConfig>;
      };
      const servers = raw.mcpServers ?? {};
      if (Object.keys(servers).length === 0) continue;
      return { file, servers };
    } catch {
      /* ignore corrupt */
    }
  }
  return null;
}

function toConnection(
  name: string,
  cfg: McpServerConfig,
): Record<string, unknown> | null {
  if (cfg.url) {
    const transport =
      cfg.transport === "sse" || cfg.type === "sse" ? "sse" : "http";
    return {
      transport,
      url: cfg.url,
      ...(cfg.headers ? { headers: cfg.headers } : {}),
    };
  }
  if (cfg.command) {
    return {
      transport: "stdio" as const,
      command: cfg.command,
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      ...(cfg.env ? { env: cfg.env } : {}),
      ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
      stderr: "ignore" as const,
    };
  }
  console.warn(`[mcp] skip "${name}": need command+args or url`);
  return null;
}

/**
 * Connect enabled MCP servers from `.agent/mcp.json` / `.mcp.json` and
 * return LangChain tools. Failures on individual servers are skipped so the
 * agent still boots.
 */
export async function loadMcpTools(options: {
  roots: string[];
  disabledMcpServers?: Set<string>;
}): Promise<LoadedMcp> {
  const empty: LoadedMcp = {
    tools: [],
    serverNames: [],
    close: async () => {},
  };

  const loaded = readMcpServerMap(options.roots);
  if (!loaded) return empty;

  const enabled = filterMcpServers(
    loaded.servers,
    options.disabledMcpServers ?? new Set(),
  );

  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const [name, cfg] of Object.entries(enabled)) {
    const conn = toConnection(name, cfg);
    if (conn) mcpServers[name] = conn;
  }

  if (Object.keys(mcpServers).length === 0) return empty;

  try {
    const client = new MultiServerMCPClient({
      mcpServers: mcpServers as never,
      onConnectionError: "ignore",
      throwOnLoadError: false,
      prefixToolNameWithServerName: true,
      additionalToolNamePrefix: "mcp",
    });

    const tools = await client.getTools();
    const serverNames = Object.keys(mcpServers);
    console.info(
      `[mcp] loaded ${tools.length} tool(s) from: ${serverNames.join(", ")} (${path.basename(loaded.file)})`,
    );

    return {
      tools: tools as StructuredToolInterface[],
      serverNames,
      close: async () => {
        try {
          await client.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    console.warn(
      `[mcp] failed to load tools: ${err instanceof Error ? err.message : String(err)}`,
    );
    return empty;
  }
}
