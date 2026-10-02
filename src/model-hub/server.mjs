#!/usr/bin/env node
/**
 * Agent Model Hub HTTP server — copied 9Router engine source, no dashboard login.
 *
 * Env: PORT / HOSTNAME / DATA_DIR
 * Run: node --import ./src/model-hub/register-aliases.mjs ./src/model-hub/server.mjs
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 27128);
const HOST = process.env.HOSTNAME || process.env.HOST || "127.0.0.1";

if (!process.env.DATA_DIR) {
  console.error("DATA_DIR is required");
  process.exit(1);
}

process.env.MODEL_HUB_NO_LOGIN = "1";

const { handleChat } = await import("@/sse/handlers/chat.js");
const { initTranslators } = await import("open-sse/translator/index.js");
const providers = await import("@/app/api/providers/route.js");
const combos = await import("@/app/api/combos/route.js");
const usageStats = await import("@/app/api/usage/stats/route.js").catch(
  () => null,
);
const usageRoute = await import("@/app/api/usage/route.js").catch(() => null);
const keys = await import("@/app/api/keys/route.js");
const oauthRoute = await import("@/app/api/oauth/[provider]/[action]/route.js");
const providerById = await import("@/app/api/providers/[id]/route.js");
const { OAUTH_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, APIKEY_PROVIDERS } = await import(
  "@/shared/constants/providers.js"
);
const { getProviderNames, getProvider } = await import(
  "@/lib/oauth/providers/index.js"
);
const { updateSettings, getSettings } = await import("@/lib/localDb.js");
const { __setIncomingCookieHeader, __drainSetCookies } = await import(
  "./shims/next-headers.js"
);

/** @type {Map<string, { code?: string, token?: string, state?: string, error?: string, fullUrl?: string, at: number }>} */
const pendingCallbacks = new Map();

await initTranslators();

try {
  await updateSettings({ requireLogin: false });
} catch (e) {
  console.warn(
    "[model-hub] could not set requireLogin=false:",
    e?.message || e,
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function toWebRequest(req, bodyBuf) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  __setIncomingCookieHeader(headers.get("cookie") || "");
  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD" && bodyBuf?.length) {
    init.body = bodyBuf;
  }
  return new Request(url, init);
}

async function pipeWebResponse(webRes, res) {
  const setCookies = __drainSetCookies();
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  for (const [k, v] of Object.entries(CORS)) {
    if (!res.getHeader(k)) res.setHeader(k, v);
  }
  if (setCookies.length) {
    res.setHeader("Set-Cookie", setCookies);
  }
  if (webRes.body) {
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
}

async function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS,
  });
  res.end(JSON.stringify(body));
}

function match(pathname, method) {
  if (pathname === "/api/health" && method === "GET") {
    return async () => Response.json({ ok: true });
  }
  if (pathname === "/api/auth/status" && method === "GET") {
    return async () =>
      Response.json({
        authenticated: true,
        requireLogin: false,
        authMode: "none",
      });
  }

  // OAuth browser callback — store code for Agent to poll / paste.
  if (
    (pathname === "/callback" || pathname === "/auth/callback") &&
    method === "GET"
  ) {
    return async (request) => {
      const u = new URL(request.url);
      const code = u.searchParams.get("code") || undefined;
      const token = u.searchParams.get("token") || undefined;
      const state = u.searchParams.get("state") || undefined;
      const error = u.searchParams.get("error") || undefined;
      const errorDescription =
        u.searchParams.get("error_description") || undefined;
      if (state) {
        pendingCallbacks.set(state, {
          code,
          token,
          state,
          error,
          errorDescription,
          fullUrl: request.url,
          at: Date.now(),
        });
      }
      const ok = Boolean(code || token) && !error;
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Model Hub OAuth</title>
<style>body{font-family:system-ui;background:#0a0a0b;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:420px;padding:24px;border:1px solid #2a2a2e;border-radius:12px;background:#121214}
h1{font-size:16px;margin:0 0 8px}p{font-size:13px;color:#9a9aa0;line-height:1.5}code{font-size:11px;word-break:break-all}</style></head>
<body><div class="card"><h1>${ok ? "Login OK" : error ? "Login gagal" : "Callback"}</h1>
<p>${ok ? "Kamu bisa tutup tab ini. Agent akan menyelesaikan koneksi." : error ? String(errorDescription || error) : "Tidak ada code di URL. Paste full URL callback ke panel Providers di Agent."}</p>
${state ? `<p>state: <code>${state}</code></p>` : ""}
</div></body></html>`;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };
  }

  if (pathname === "/api/oauth/pending" && method === "GET") {
    return async (request) => {
      const u = new URL(request.url);
      const state = u.searchParams.get("state");
      if (!state) {
        return Response.json({ error: "Missing state" }, { status: 400 });
      }
      const hit = pendingCallbacks.get(state);
      if (!hit) return Response.json({ status: "waiting" });
      pendingCallbacks.delete(state);
      return Response.json({ status: "done", ...hit });
    };
  }

  if (pathname === "/api/providers/catalog" && method === "GET") {
    return async () => {
      const oauthIds = new Set(getProviderNames());
      const catalog = [];
      const push = (map, kind) => {
        for (const [id, p] of Object.entries(map || {})) {
          if (p.hidden) continue;
          const handler = oauthIds.has(id) ? getProvider(id) : null;
          catalog.push({
            id,
            name: p.name || id,
            kind,
            color: p.color || null,
            website: p.website || null,
            hasOAuth: Boolean(handler) || p.hasOAuth === true,
            flowType: handler?.flowType || null,
            noAuth: p.noAuth === true,
            authType: p.authType || kind,
            deprecated: p.deprecated === true,
          });
        }
      };
      push(OAUTH_PROVIDERS, "oauth");
      push(FREE_PROVIDERS, "free");
      push(FREE_TIER_PROVIDERS, "freeTier");
      push(APIKEY_PROVIDERS, "apikey");
      // Ensure every oauth handler appears even if missing from constants
      for (const id of oauthIds) {
        if (!catalog.some((c) => c.id === id)) {
          const handler = getProvider(id);
          catalog.push({
            id,
            name: id,
            kind: "oauth",
            color: null,
            website: null,
            hasOAuth: true,
            flowType: handler.flowType,
            noAuth: false,
            authType: "oauth",
            deprecated: false,
          });
        }
      }
      catalog.sort((a, b) => a.name.localeCompare(b.name));
      return Response.json({ providers: catalog });
    };
  }

  if (pathname === "/api/providers" && method === "GET" && providers.GET) {
    return () => providers.GET();
  }
  if (pathname === "/api/providers" && method === "POST" && providers.POST) {
    return (request) => providers.POST(request);
  }

  if (pathname === "/api/providers/test-batch" && method === "POST") {
    return async (request) => {
      const mod = await import("@/app/api/providers/test-batch/route.js");
      return mod.POST(request);
    };
  }

  {
    const m = pathname.match(/^\/api\/providers\/([^/]+)\/test$/);
    if (m && method === "POST") {
      const id = decodeURIComponent(m[1]);
      return async (request) => {
        const mod = await import("@/app/api/providers/[id]/test/route.js");
        return mod.POST(request, { params: Promise.resolve({ id }) });
      };
    }
  }

  {
    const m = pathname.match(/^\/api\/providers\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const params = Promise.resolve({ id });
      if (method === "GET" && providerById.GET) {
        return (request) => providerById.GET(request, { params });
      }
      if (method === "DELETE" && providerById.DELETE) {
        return (request) => providerById.DELETE(request, { params });
      }
      if (method === "PUT" && providerById.PUT) {
        return (request) => providerById.PUT(request, { params });
      }
      if (method === "PATCH" && providerById.PATCH) {
        return (request) => providerById.PATCH(request, { params });
      }
    }
  }

  if (pathname === "/api/disabled-models" && method === "GET") {
    return async () => {
      const { getDisabledModels } = await import("@/lib/disabledModelsDb.js");
      return Response.json({ disabled: await getDisabledModels() });
    };
  }
  if (pathname === "/api/disabled-models" && method === "POST") {
    return async (request) => {
      const body = await request.json().catch(() => ({}));
      const alias = String(body?.alias || "").trim();
      const modelIds = Array.isArray(body?.modelIds)
        ? body.modelIds.map(String).filter(Boolean)
        : [];
      if (!alias) {
        return Response.json({ error: "alias required" }, { status: 400 });
      }
      const { disableModels, enableModels } = await import(
        "@/lib/disabledModelsDb.js"
      );
      if (body?.enabled === true) {
        await enableModels(alias, modelIds);
      } else {
        await disableModels(alias, modelIds);
      }
      const { getDisabledByProvider } = await import("@/lib/disabledModelsDb.js");
      return Response.json({
        ok: true,
        alias,
        disabled: await getDisabledByProvider(alias),
      });
    };
  }

  {
    const m = pathname.match(/^\/api\/combos\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      return async (request) => {
        const mod = await import("@/app/api/combos/[id]/route.js");
        const params = Promise.resolve({ id });
        if (method === "GET" && mod.GET) return mod.GET(request, { params });
        if (method === "PUT" && mod.PUT) return mod.PUT(request, { params });
        if (method === "DELETE" && mod.DELETE)
          return mod.DELETE(request, { params });
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      };
    }
  }

  {
    const m = pathname.match(/^\/api\/usage\/([^/]+)$/);
    if (m && m[1] !== "stats" && m[1] !== "stream" && m[1] !== "history" && m[1] !== "logs" && m[1] !== "chart" && m[1] !== "providers" && m[1] !== "request-details" && m[1] !== "request-logs") {
      const connectionId = decodeURIComponent(m[1]);
      if (method === "GET") {
        return async (request) => {
          const mod = await import("@/app/api/usage/[connectionId]/route.js");
          return mod.GET(request, {
            params: Promise.resolve({ connectionId }),
          });
        };
      }
    }
  }

  {
    const m = pathname.match(/^\/api\/oauth\/([^/]+)\/([^/]+)$/);
    if (m) {
      const provider = decodeURIComponent(m[1]);
      const action = decodeURIComponent(m[2]);
      const params = Promise.resolve({ provider, action });
      if (method === "GET" && oauthRoute.GET) {
        return (request) => oauthRoute.GET(request, { params });
      }
      if (method === "POST" && oauthRoute.POST) {
        return (request) => oauthRoute.POST(request, { params });
      }
    }
  }

  if (pathname === "/api/combos" && method === "GET" && combos.GET) {
    return () => combos.GET();
  }
  if (pathname === "/api/combos" && method === "POST" && combos.POST) {
    return (request) => combos.POST(request);
  }
  if (pathname === "/api/keys" && method === "GET" && keys.GET) {
    return () => keys.GET();
  }
  if (pathname === "/api/keys" && method === "POST" && keys.POST) {
    return (request) => keys.POST(request);
  }
  if (pathname === "/api/usage/stats" && method === "GET" && usageStats?.GET) {
    return (request) => usageStats.GET(request);
  }
  if (pathname === "/api/usage/chart" && method === "GET") {
    return async (request) => {
      const mod = await import("@/app/api/usage/chart/route.js");
      return mod.GET(request);
    };
  }
  if (
    (pathname === "/api/usage/logs" || pathname === "/api/usage/request-logs") &&
    method === "GET"
  ) {
    return async () => {
      const mod = await import("@/app/api/usage/logs/route.js").catch(() => null);
      if (mod?.GET) return mod.GET();
      const alt = await import("@/app/api/usage/request-logs/route.js");
      return alt.GET();
    };
  }
  if (pathname === "/api/usage" && method === "GET" && usageRoute?.GET) {
    return (request) => usageRoute.GET(request);
  }
  if (
    (pathname === "/v1/chat/completions" ||
      pathname === "/api/v1/chat/completions") &&
    method === "POST"
  ) {
    return (request) => handleChat(request);
  }
  if (
    (pathname === "/v1/models" || pathname === "/api/v1/models") &&
    method === "GET"
  ) {
    return async (request) => {
      try {
        const mod = await import("@/app/api/v1/models/route.js");
        return mod.GET(request);
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    const bodyBuf = await readBody(req);
    const u = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const handler = match(u.pathname, req.method || "GET");
    if (!handler) {
      await json(res, 404, { error: `Not found: ${u.pathname}` });
      return;
    }
    const webReq = toWebRequest(req, bodyBuf);
    const webRes = await handler(webReq);
    if (!webRes) {
      await json(res, 500, { error: "Empty handler response" });
      return;
    }
    if (
      webRes.body &&
      typeof webRes.body.getReader === "function" &&
      webRes.headers.get("content-type")?.includes("text/event-stream")
    ) {
      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => res.setHeader(key, value));
      for (const [k, v] of Object.entries(CORS)) {
        if (!res.getHeader(k)) res.setHeader(k, v);
      }
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
      return;
    }
    await pipeWebResponse(webRes, res);
  } catch (e) {
    console.error("[model-hub]", e);
    if (!res.headersSent) {
      await json(res, 500, {
        error: e instanceof Error ? e.message : String(e),
      });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, async () => {
  let settings = null;
  try {
    settings = await getSettings();
  } catch {
    /* first boot */
  }
  console.log(
    `[model-hub] listening on http://${HOST}:${PORT} (requireLogin=${settings?.requireLogin === false ? "false" : "?"})`,
  );
  console.log(`[model-hub] DATA_DIR=${process.env.DATA_DIR}`);
  console.log(`[model-hub] root=${__dirname}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
