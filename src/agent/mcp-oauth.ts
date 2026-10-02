/**
 * MCP remote OAuth helpers (PKCE + protected-resource / AS metadata discovery).
 */
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

export type OAuthDiscovery = {
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string[];
};

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

function originOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function resourceMetadataCandidates(mcpUrl: string): string[] {
  const u = new URL(mcpUrl);
  const origin = originOf(mcpUrl);
  const path = u.pathname.replace(/\/+$/, "") || "";
  const out = [
    `${origin}/.well-known/oauth-protected-resource`,
    `${origin}/.well-known/oauth-protected-resource${path}`,
  ];
  if (path && path !== "/") {
    out.push(`${origin}${path}/.well-known/oauth-protected-resource`);
  }
  return [...new Set(out)];
}

function asMetadataCandidates(issuer: string): string[] {
  const cleaned = issuer.replace(/\/+$/, "");
  return [
    `${cleaned}/.well-known/oauth-authorization-server`,
    `${originOf(cleaned)}/.well-known/oauth-authorization-server`,
  ];
}

export async function discoverOAuthForResource(
  mcpUrl: string,
  overrides?: {
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
  },
): Promise<OAuthDiscovery> {
  if (overrides?.authorizationUrl && overrides?.tokenUrl) {
    return {
      resource: mcpUrl,
      authorizationEndpoint: overrides.authorizationUrl,
      tokenEndpoint: overrides.tokenUrl,
      scopesSupported: overrides.scopes,
    };
  }

  let authServers: string[] = [];
  let resource = mcpUrl;

  for (const metaUrl of resourceMetadataCandidates(mcpUrl)) {
    const res = await fetchJson(metaUrl);
    if (!res.ok || !res.json || typeof res.json !== "object") continue;
    const body = res.json as {
      resource?: string;
      authorization_servers?: string[];
    };
    if (
      Array.isArray(body.authorization_servers) &&
      body.authorization_servers.length
    ) {
      authServers = body.authorization_servers.map(String);
      if (body.resource) resource = String(body.resource);
      break;
    }
  }

  if (authServers.length === 0) {
    authServers = [originOf(mcpUrl)];
  }

  for (const issuer of authServers) {
    for (const asUrl of asMetadataCandidates(issuer)) {
      const res = await fetchJson(asUrl);
      if (!res.ok || !res.json || typeof res.json !== "object") continue;
      const body = res.json as {
        authorization_endpoint?: string;
        token_endpoint?: string;
        registration_endpoint?: string;
        scopes_supported?: string[];
      };
      if (body.authorization_endpoint && body.token_endpoint) {
        return {
          resource,
          authorizationEndpoint: String(body.authorization_endpoint),
          tokenEndpoint: String(body.token_endpoint),
          registrationEndpoint: body.registration_endpoint
            ? String(body.registration_endpoint)
            : undefined,
          scopesSupported: Array.isArray(body.scopes_supported)
            ? body.scopes_supported.map(String)
            : overrides?.scopes,
        };
      }
    }
  }

  throw new Error(
    `Could not discover OAuth endpoints for ${mcpUrl}. Set auth.authorizationUrl + auth.tokenUrl in mcp.json, or paste a bearer token.`,
  );
}

async function registerPublicClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  const res = await fetchJson(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Agent Terminal",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!res.ok || !res.json || typeof res.json !== "object") {
    throw new Error(`Dynamic client registration failed (HTTP ${res.status})`);
  }
  const body = res.json as { client_id?: string; client_secret?: string };
  if (!body.client_id) throw new Error("DCR response missing client_id");
  return {
    clientId: String(body.client_id),
    clientSecret: body.client_secret ? String(body.client_secret) : undefined,
  };
}

async function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  verifier: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (opts.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64")}`;
  }
  const res = await fetchJson(opts.tokenEndpoint, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok || !res.json || typeof res.json !== "object") {
    throw new Error(`Token exchange failed (HTTP ${res.status})`);
  }
  const json = res.json as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new Error("Token response missing access_token");
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt:
      typeof json.expires_in === "number"
        ? Date.now() + json.expires_in * 1000
        : undefined,
    tokenEndpoint: opts.tokenEndpoint,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: json.scope
      ? String(json.scope).split(/\s+/).filter(Boolean)
      : undefined,
  };
}

export async function refreshAccessToken(opts: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (opts.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64")}`;
  }
  const res = await fetchJson(opts.tokenEndpoint, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok || !res.json || typeof res.json !== "object") {
    throw new Error(`Token refresh failed (HTTP ${res.status})`);
  }
  const json = res.json as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("Refresh response missing access_token");
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token
      ? String(json.refresh_token)
      : opts.refreshToken,
    expiresAt:
      typeof json.expires_in === "number"
        ? Date.now() + json.expires_in * 1000
        : undefined,
    tokenEndpoint: opts.tokenEndpoint,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: json.scope
      ? String(json.scope).split(/\s+/).filter(Boolean)
      : undefined,
  };
}

type CallbackServer = {
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
};

function startCallbackServer(opts: {
  expectedState: string;
  timeoutMs: number;
}): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let settleCode!: (code: string) => void;
    let rejectCode!: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      settleCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const err = reqUrl.searchParams.get("error");
        const st = reqUrl.searchParams.get("state") || "";
        const code = reqUrl.searchParams.get("code") || "";
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<html><body><h3>MCP login failed</h3><p>${err}</p></body></html>`,
          );
          rejectCode(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code || st !== opts.expectedState) {
          res.writeHead(400);
          res.end("Invalid OAuth callback");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body><h3>Connected</h3><p>Return to Agent Terminal.</p></body></html>`,
        );
        settleCode(code);
      } catch (e) {
        rejectCode(e instanceof Error ? e : new Error(String(e)));
      }
    });

    const timer = setTimeout(() => {
      close();
      rejectCode(
        new Error(
          "OAuth timed out — finish login in the browser, then try again.",
        ),
      );
    }, opts.timeoutMs);

    const close = () => {
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* ignore */
      }
    };

    server.once("error", (e) => {
      close();
      reject(e);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        close();
        reject(new Error("Failed to bind OAuth callback server"));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      resolve({
        redirectUri,
        waitForCode: () => codePromise,
        close,
      });
    });
  });
}

/** Full browser PKCE login. `openUrl` should open the system browser. */
export async function runPkceLogin(options: {
  discovery: OAuthDiscovery;
  openUrl: (url: string) => Promise<void>;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  timeoutMs?: number;
}): Promise<OAuthTokens> {
  const { verifier, challenge } = createPkcePair();
  const state = b64url(crypto.randomBytes(16));
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const callback = await startCallbackServer({
    expectedState: state,
    timeoutMs,
  });

  try {
    let clientId = options.clientId?.trim() || "";
    let clientSecret = options.clientSecret;
    if (!clientId) {
      if (!options.discovery.registrationEndpoint) {
        throw new Error(
          "No clientId and server does not support dynamic registration. Set auth.clientId in mcp.json or paste a bearer token.",
        );
      }
      const reg = await registerPublicClient(
        options.discovery.registrationEndpoint,
        callback.redirectUri,
      );
      clientId = reg.clientId;
      clientSecret = reg.clientSecret;
    }

    const scopes =
      options.scopes?.length
        ? options.scopes
        : (options.discovery.scopesSupported?.slice(0, 8) ?? []);

    const authUrl = new URL(options.discovery.authorizationEndpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callback.redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", options.discovery.resource);
    if (scopes.length) authUrl.searchParams.set("scope", scopes.join(" "));

    await options.openUrl(authUrl.toString());
    const code = await callback.waitForCode();
    return await exchangeCode({
      tokenEndpoint: options.discovery.tokenEndpoint,
      code,
      redirectUri: callback.redirectUri,
      clientId,
      clientSecret,
      verifier,
    });
  } finally {
    callback.close();
  }
}
