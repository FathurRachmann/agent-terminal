/**
 * High-level MCP auth: status, connect (OAuth/bearer/env), apply to connections.
 */
import {
  accessTokenFromRecord,
  deleteMcpAuthRecord,
  getMcpAuthRecord,
  isAccessTokenFresh,
  upsertMcpAuthRecord,
  type McpAuthRecord,
  type McpAuthType,
} from "./mcp-auth-store.js";
import {
  discoverOAuthForResource,
  refreshAccessToken,
  runPkceLogin,
} from "./mcp-oauth.js";

export type McpAuthStatus = "none" | "required" | "connected" | "expired";

export type McpAuthMode = "none" | "oauth" | "bearer" | "env";

export type McpServerAuthConfig = {
  type?: McpAuthMode;
  envKeys?: string[];
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
};

/** Minimal server shape needed for auth (avoids circular import with mcp-loader). */
export type McpServerConfigWithAuth = {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  description?: string;
  auth?: McpServerAuthConfig;
};

export type McpAuthInfo = {
  status: McpAuthStatus;
  mode: McpAuthMode;
  envKeys: string[];
  canOAuth: boolean;
  canBearer: boolean;
  canEnv: boolean;
};

function asAuthConfig(cfg: McpServerConfigWithAuth): McpServerAuthConfig {
  return cfg.auth && typeof cfg.auth === "object" ? cfg.auth : {};
}

/** Infer how this server authenticates. */
export function resolveMcpAuthMode(cfg: McpServerConfigWithAuth): McpAuthMode {
  const auth = asAuthConfig(cfg);
  if (auth.type === "none" || auth.type === "oauth" || auth.type === "bearer" || auth.type === "env") {
    return auth.type;
  }
  if (Array.isArray(auth.envKeys) && auth.envKeys.length > 0) return "env";
  if (cfg.url) return "oauth";
  return "none";
}

export function resolveMcpAuthInfo(
  profileHome: string,
  serverName: string,
  cfg: McpServerConfigWithAuth,
): McpAuthInfo {
  const mode = resolveMcpAuthMode(cfg);
  const auth = asAuthConfig(cfg);
  const envKeys = Array.isArray(auth.envKeys)
    ? auth.envKeys.map(String).filter(Boolean)
    : [];
  const record = getMcpAuthRecord(profileHome, serverName);

  if (mode === "none") {
    return {
      status: "none",
      mode,
      envKeys,
      canOAuth: false,
      canBearer: Boolean(cfg.url),
      canEnv: false,
    };
  }

  if (mode === "env") {
    const keys = envKeys.length ? envKeys : Object.keys(record?.env ?? {});
    const filled =
      record?.type === "env" &&
      keys.length > 0 &&
      keys.every((k) => Boolean(record.env?.[k]?.trim()));
    return {
      status: filled ? "connected" : "required",
      mode,
      envKeys: keys,
      canOAuth: false,
      canBearer: false,
      canEnv: true,
    };
  }

  // oauth / bearer (url servers default to oauth)
  const canOAuth = Boolean(cfg.url) && mode !== "bearer";
  const canBearer = true;
  if (!record) {
    return {
      status: "required",
      mode,
      envKeys,
      canOAuth,
      canBearer,
      canEnv: false,
    };
  }
  if (isAccessTokenFresh(record)) {
    return {
      status: "connected",
      mode: record.type === "bearer" ? "bearer" : mode,
      envKeys,
      canOAuth,
      canBearer,
      canEnv: false,
    };
  }
  if (record.refreshToken && record.tokenEndpoint && record.clientId) {
    return {
      status: "expired",
      mode,
      envKeys,
      canOAuth,
      canBearer,
      canEnv: false,
    };
  }
  return {
    status: "required",
    mode,
    envKeys,
    canOAuth,
    canBearer,
    canEnv: false,
  };
}

export function saveMcpBearerToken(
  profileHome: string,
  serverName: string,
  token: string,
): McpAuthRecord {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Bearer token is empty");
  return upsertMcpAuthRecord(profileHome, {
    serverName,
    type: "bearer",
    bearerToken: trimmed,
    accessToken: trimmed,
    updatedAt: new Date().toISOString(),
  });
}

export function saveMcpEnvCredentials(
  profileHome: string,
  serverName: string,
  env: Record<string, string>,
): McpAuthRecord {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const key = String(k).trim();
    if (!key) continue;
    cleaned[key] = String(v ?? "");
  }
  if (Object.keys(cleaned).length === 0) {
    throw new Error("Provide at least one env value");
  }
  return upsertMcpAuthRecord(profileHome, {
    serverName,
    type: "env",
    env: cleaned,
    updatedAt: new Date().toISOString(),
  });
}

export function disconnectMcpAuth(
  profileHome: string,
  serverName: string,
): boolean {
  return deleteMcpAuthRecord(profileHome, serverName);
}

export async function connectMcpOAuth(options: {
  profileHome: string;
  serverName: string;
  cfg: McpServerConfigWithAuth;
  openUrl: (url: string) => Promise<void>;
}): Promise<McpAuthRecord> {
  const { profileHome, serverName, cfg, openUrl } = options;
  if (!cfg.url) {
    throw new Error("OAuth login requires an MCP server with a url");
  }
  const auth = asAuthConfig(cfg);
  const discovery = await discoverOAuthForResource(cfg.url, {
    authorizationUrl: auth.authorizationUrl,
    tokenUrl: auth.tokenUrl,
    scopes: auth.scopes,
  });
  const tokens = await runPkceLogin({
    discovery,
    openUrl,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    scopes: auth.scopes,
  });
  return upsertMcpAuthRecord(profileHome, {
    serverName,
    type: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    tokenEndpoint: tokens.tokenEndpoint,
    clientId: tokens.clientId,
    clientSecret: tokens.clientSecret,
    scopes: tokens.scopes,
    updatedAt: new Date().toISOString(),
  });
}

/** Refresh oauth token in place when expired; returns usable access token or null. */
export async function ensureFreshAccessToken(
  profileHome: string,
  serverName: string,
): Promise<string | null> {
  const record = getMcpAuthRecord(profileHome, serverName);
  if (!record) return null;
  if (isAccessTokenFresh(record)) {
    return accessTokenFromRecord(record);
  }
  if (
    record.type === "oauth" &&
    record.refreshToken &&
    record.tokenEndpoint &&
    record.clientId
  ) {
    try {
      const tokens = await refreshAccessToken({
        tokenEndpoint: record.tokenEndpoint,
        refreshToken: record.refreshToken,
        clientId: record.clientId,
        clientSecret: record.clientSecret,
      });
      upsertMcpAuthRecord(profileHome, {
        ...record,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? record.refreshToken,
        expiresAt: tokens.expiresAt,
        updatedAt: new Date().toISOString(),
      });
      return tokens.accessToken;
    } catch {
      return null;
    }
  }
  return accessTokenFromRecord(record);
}

/**
 * Merge stored credentials into an MCP connection config for MultiServerMCPClient.
 */
export async function applyMcpAuthToConnection(
  profileHome: string,
  serverName: string,
  cfg: McpServerConfigWithAuth,
  base: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mode = resolveMcpAuthMode(cfg);
  if (mode === "none") return base;

  if (mode === "env") {
    const record = getMcpAuthRecord(profileHome, serverName);
    if (record?.type === "env" && record.env) {
      const prev =
        base.env && typeof base.env === "object"
          ? (base.env as Record<string, string>)
          : {};
      return { ...base, env: { ...prev, ...record.env } };
    }
    return base;
  }

  const token = await ensureFreshAccessToken(profileHome, serverName);
  if (!token) return base;
  const prevHeaders =
    base.headers && typeof base.headers === "object"
      ? (base.headers as Record<string, string>)
      : {};
  return {
    ...base,
    headers: {
      ...prevHeaders,
      Authorization: `Bearer ${token}`,
    },
  };
}

export type { McpAuthType };
