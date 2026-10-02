/**
 * Model Hub IPC helpers — talk to the *copied* engine HTTP API (no dashboard
 * login, no BrowserView embed of upstream UI).
 */
import type { BrowserWindow as BW } from "electron";
import * as electron from "electron";
const shell = electron.shell || (electron as any).default?.shell;
import {
  getModelHubBaseUrl,
  getModelHubStatus,
  type ModelHubStatus,
} from "./model-hub-runtime.js";

export type ModelHubPage = "providers" | "combos" | "usage" | "quota";

export const MODEL_HUB_PAGES: Record<
  ModelHubPage,
  { path: string; title: string; blurb: string }
> = {
  providers: {
    path: "/api/providers",
    title: "Providers",
    blurb: "Koneksi OAuth / API key (Antigravity, Codex, Cursor, …)",
  },
  combos: {
    path: "/api/combos",
    title: "Combo & Vision Adapter",
    blurb: "Fallback / Round Robin / Fusion + vision adapter",
  },
  usage: {
    path: "/api/usage/stats",
    title: "Usage",
    blurb: "Requests, tokens, cost, recent calls",
  },
  quota: {
    path: "/api/usage/stats",
    title: "Quota Tracker",
    blurb: "Sisa kuota per akun & model (via usage + provider status)",
  },
};

function requireBaseUrl(): string {
  const base = getModelHubBaseUrl();
  if (!base) {
    throw new Error("Model Hub is not running");
  }
  return base;
}

export async function probeModelHub(): Promise<{
  ok: boolean;
  online: boolean;
  authenticated: boolean;
  requireLogin: boolean;
  error?: string;
}> {
  const st = getModelHubStatus();
  if (!st.ready || !st.baseUrl) {
    return {
      ok: false,
      online: false,
      authenticated: false,
      requireLogin: false,
      error: st.error || "Model Hub not ready",
    };
  }
  try {
    const res = await fetch(`${st.baseUrl}/api/auth/status`);
    const data = (await res.json()) as {
      authenticated?: boolean;
      requireLogin?: boolean;
    };
    return {
      ok: true,
      online: true,
      authenticated: data.authenticated !== false,
      requireLogin: false,
    };
  } catch (e) {
    return {
      ok: false,
      online: false,
      authenticated: false,
      requireLogin: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** No-op session — Model Hub runs without dashboard password. */
export async function ensureModelHubSession(): Promise<{
  ok: boolean;
  authenticated?: boolean;
  error?: string;
}> {
  const probe = await probeModelHub();
  if (!probe.online) {
    return { ok: false, error: probe.error || "offline" };
  }
  return { ok: true, authenticated: true };
}

export async function openModelHubPanel(options: {
  page: ModelHubPage;
  parent?: BW | null;
}): Promise<{ ok: boolean; error?: string }> {
  void options.parent;
  try {
    const base = requireBaseUrl();
    const meta = MODEL_HUB_PAGES[options.page];
    // Open raw JSON API in browser as a debug affordance (native UI is primary).
    await shell.openExternal(`${base}${meta.path}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Embed removed — Settings uses native React against management APIs. */
export async function showModelHubEmbed(_options: {
  page: ModelHubPage;
  parent: BW;
  bounds: { x: number; y: number; width: number; height: number };
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Embed disabled — use native Model Hub panels" };
}

export function hideModelHubEmbed(): void {
  /* no-op */
}

export function updateModelHubEmbedBounds(_bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  /* no-op */
}

export async function fetchModelHubUsage(
  period = "7d",
): Promise<unknown> {
  const base = requireBaseUrl();
  const res = await fetch(
    `${base}/api/usage/stats?period=${encodeURIComponent(period)}`,
  );
  if (!res.ok) throw new Error(`usage ${res.status}`);
  return res.json();
}

export type ModelHubChartBucket = {
  label: string;
  tokens: number;
  cost: number;
};

/** Chart buckets; period `all` maps to `60d` (API max). */
export async function fetchModelHubUsageChart(
  period = "7d",
): Promise<ModelHubChartBucket[]> {
  const base = requireBaseUrl();
  const allowed = new Set(["today", "24h", "7d", "30d", "60d"]);
  const chartPeriod = period === "all" ? "60d" : allowed.has(period) ? period : "7d";
  const res = await fetch(
    `${base}/api/usage/chart?period=${encodeURIComponent(chartPeriod)}`,
  );
  if (!res.ok) throw new Error(`chart ${res.status}`);
  const data = (await res.json()) as ModelHubChartBucket[] | { error?: string };
  if (!Array.isArray(data)) {
    throw new Error((data as { error?: string }).error || "Invalid chart data");
  }
  return data;
}

export async function fetchModelHubModels(): Promise<{
  data: Array<{
    id: string;
    owned_by?: string;
    context_length?: number;
    capabilities?: Record<string, unknown>;
  }>;
}> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/v1/models`);
  if (!res.ok) throw new Error(`models ${res.status}`);
  return res.json() as Promise<{
    data: Array<{
      id: string;
      owned_by?: string;
      context_length?: number;
      capabilities?: Record<string, unknown>;
    }>;
  }>;
}

export async function createModelHubCombo(payload: {
  name: string;
  models: string[];
  kind?: string | null;
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/combos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error || `create ${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function deleteModelHubCombo(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/combos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `delete ${res.status}` };
  }
  return { ok: true };
}

export async function updateModelHubCombo(
  id: string,
  payload: {
    name?: string;
    models?: string[];
    kind?: string | null;
  },
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/combos/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error || `update ${res.status}`,
    };
  }
  return { ok: true, data };
}

export type CapacityAdapterCap = {
  enabled?: boolean;
  roundRobin?: boolean;
  models?: string[];
};

export type CapacityAdapterSettings = {
  vision?: CapacityAdapterCap;
  pdf?: CapacityAdapterCap;
  audioInput?: CapacityAdapterCap;
  videoInput?: CapacityAdapterCap;
};

export async function fetchModelHubSettings(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/settings`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error || `settings ${res.status}`,
    };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

export async function patchModelHubSettings(
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error || `settings ${res.status}`,
    };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

export async function fetchModelHubConnectionQuota(
  connectionId: string,
): Promise<unknown> {
  const base = requireBaseUrl();
  const res = await fetch(
    `${base}/api/usage/${encodeURIComponent(connectionId)}?force=1`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `quota ${res.status}`,
    );
  }
  return data;
}

export async function fetchModelHubProviders(): Promise<unknown> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/providers`);
  if (!res.ok) throw new Error(`providers ${res.status}`);
  return res.json();
}

export async function fetchModelHubCombos(): Promise<unknown> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/combos`);
  if (!res.ok) throw new Error(`combos ${res.status}`);
  return res.json();
}

export async function fetchModelHubCatalog(): Promise<{
  providers: Array<{
    id: string;
    name: string;
    kind: string;
    hasOAuth?: boolean;
    flowType?: string | null;
    color?: string | null;
    website?: string | null;
    deprecated?: boolean;
  }>;
}> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/providers/catalog`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json() as Promise<{
    providers: Array<{
      id: string;
      name: string;
      kind: string;
      hasOAuth?: boolean;
      flowType?: string | null;
      color?: string | null;
      website?: string | null;
      deprecated?: boolean;
    }>;
  }>;
}

export async function deleteModelHubConnection(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `delete ${res.status}` };
  }
  return { ok: true };
}

export async function updateModelHubConnection(
  id: string,
  patch: { isActive?: boolean; name?: string },
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error || `update ${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function fetchModelHubDisabledModels(): Promise<{
  ok: boolean;
  disabled?: Record<string, string[]>;
  error?: string;
}> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/disabled-models`);
  const data = (await res.json().catch(() => ({}))) as {
    disabled?: Record<string, string[]>;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `disabled ${res.status}` };
  }
  return { ok: true, disabled: data.disabled || {} };
}

/** Enable/disable bare model ids under a provider alias (e.g. ag + gemini-…). */
export async function setModelHubModelEnabled(payload: {
  alias: string;
  modelIds: string[];
  enabled: boolean;
}): Promise<{ ok: boolean; disabled?: string[]; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/disabled-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    disabled?: string[];
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `disabled ${res.status}` };
  }
  return { ok: true, disabled: data.disabled };
}

const MODEL_SOFT_FAIL_RE =
  /no longer available|not found|not supported|deprecated|please switch to|model.*(unavailable|invalid|retired)|requested entity was not found/i;

export type ConnectionTestResult = {
  ok: boolean;
  valid: boolean;
  error?: string | null;
  latencyMs?: number;
  refreshed?: boolean;
  testedAt?: string;
};

/** POST /api/providers/:id/test — probe one account/connection. */
export async function testModelHubConnection(
  connectionId: string,
): Promise<ConnectionTestResult> {
  const base = requireBaseUrl();
  const started = Date.now();
  const res = await fetch(
    `${base}/api/providers/${encodeURIComponent(connectionId)}/test`,
    { method: "POST" },
  );
  const data = (await res.json().catch(() => ({}))) as {
    valid?: boolean;
    error?: string;
    refreshed?: boolean;
    latencyMs?: number;
    testedAt?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      valid: false,
      error: data.error || `test ${res.status}`,
      latencyMs: Date.now() - started,
      testedAt: new Date().toISOString(),
    };
  }
  return {
    ok: true,
    valid: Boolean(data.valid),
    error: data.error || null,
    refreshed: Boolean(data.refreshed),
    latencyMs: data.latencyMs ?? Date.now() - started,
    testedAt: data.testedAt || new Date().toISOString(),
  };
}

export type ModelTestResult = {
  ok: boolean;
  modelId: string;
  latencyMs: number;
  status?: number;
  error?: string | null;
  preview?: string | null;
  testedAt: string;
};

/**
 * Tiny non-streaming chat ping via OpenAI-compatible /v1 — proves the model
 * routes and returns (or surfaces the upstream error).
 */
export async function testModelHubModel(
  modelId: string,
): Promise<ModelTestResult> {
  const base = requireBaseUrl();
  const apiKey = getModelHubStatus().apiKey || "local-model-hub";
  const started = Date.now();
  const testedAt = new Date().toISOString();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    let json: {
      error?: { message?: string } | string;
      choices?: Array<{ message?: { content?: string } }>;
    } = {};
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      /* keep raw */
    }
    if (!res.ok) {
      const errMsg =
        typeof json.error === "string"
          ? json.error
          : json.error?.message || raw.slice(0, 240) || `HTTP ${res.status}`;
      return {
        ok: false,
        modelId,
        latencyMs,
        status: res.status,
        error: errMsg,
        testedAt,
      };
    }
    const preview =
      json.choices?.[0]?.message?.content?.trim()?.slice(0, 160) || null;
    const softFailText = [preview, raw].filter(Boolean).join("\n");
    if (MODEL_SOFT_FAIL_RE.test(softFailText)) {
      return {
        ok: false,
        modelId,
        latencyMs,
        status: res.status,
        error: preview || softFailText.slice(0, 240),
        preview,
        testedAt,
      };
    }
    return {
      ok: true,
      modelId,
      latencyMs,
      status: res.status,
      error: null,
      preview,
      testedAt,
    };
  } catch (e) {
    return {
      ok: false,
      modelId,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      testedAt,
    };
  }
}

export type BatchTestResult = {
  ok: boolean;
  error?: string;
  summary?: { total: number; passed: number; failed: number };
  results?: Array<{
    connectionId: string;
    connectionName?: string;
    valid: boolean;
    latencyMs?: number;
    error?: string | null;
  }>;
};

/** POST /api/providers/test-batch — test all active connections for a provider. */
export async function testModelHubProviderBatch(
  providerId: string,
): Promise<BatchTestResult> {
  const base = requireBaseUrl();
  const res = await fetch(`${base}/api/providers/test-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "provider", providerId }),
  });
  const data = (await res.json().catch(() => ({}))) as BatchTestResult & {
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `batch ${res.status}` };
  }
  return {
    ok: true,
    summary: data.summary,
    results: data.results,
  };
}

function redirectUriFor(
  provider: string,
  baseUrl: string,
  port: string,
): string {
  if (provider === "codex") return "http://localhost:1455/auth/callback";
  if (provider === "xai") return "http://127.0.0.1:56121/callback";
  // Prefer localhost hostname — many OAuth clients allow http://localhost:* 
  return `http://localhost:${port}/callback`;
}

/**
 * Start OAuth (or device-code) for a provider. Opens system browser when authUrl exists.
 */
export async function startModelHubOAuth(provider: string): Promise<{
  ok: boolean;
  error?: string;
  flowType?: string;
  authUrl?: string | null;
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  interval?: number;
  openedBrowser?: boolean;
}> {
  const base = requireBaseUrl();
  const port = new URL(base).port || "27128";
  const st = getModelHubStatus();

  try {
    // Probe flow via authorize (device_code returns flowType without authUrl)
    const redirectUri = redirectUriFor(provider, base, port);
    const authUrl = new URL(
      `${base}/api/oauth/${encodeURIComponent(provider)}/authorize`,
    );
    authUrl.searchParams.set("redirect_uri", redirectUri);
    const res = await fetch(authUrl.toString());
    const data = (await res.json()) as {
      error?: string;
      authUrl?: string | null;
      state?: string;
      codeVerifier?: string;
      redirectUri?: string;
      flowType?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || `authorize ${res.status}` };
    }

    if (data.flowType === "device_code") {
      const dcUrl = new URL(
        `${base}/api/oauth/${encodeURIComponent(provider)}/device-code`,
      );
      const dcRes = await fetch(dcUrl.toString());
      const dc = (await dcRes.json()) as {
        error?: string;
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        verification_uri_complete?: string;
        interval?: number;
        codeVerifier?: string;
      };
      if (!dcRes.ok) {
        return { ok: false, error: dc.error || `device-code ${dcRes.status}` };
      }
      const verify =
        dc.verification_uri_complete || dc.verification_uri || null;
      if (verify) {
        await shell.openExternal(verify);
      }
      return {
        ok: true,
        flowType: "device_code",
        deviceCode: dc.device_code,
        userCode: dc.user_code,
        verificationUri: verify || undefined,
        interval: dc.interval || 5,
        codeVerifier: dc.codeVerifier,
        openedBrowser: Boolean(verify),
      };
    }

    // Codex / xAI: start fixed-port proxy with server-side session when possible
    if (provider === "codex" || provider === "xai") {
      try {
        const proxyUrl = new URL(
          `${base}/api/oauth/${provider}/start-proxy`,
        );
        proxyUrl.searchParams.set("app_port", String(st.port || port));
        if (data.state) proxyUrl.searchParams.set("state", data.state);
        if (data.codeVerifier)
          proxyUrl.searchParams.set("code_verifier", data.codeVerifier);
        proxyUrl.searchParams.set("redirect_uri", redirectUri);
        await fetch(proxyUrl.toString());
      } catch {
        /* fall through — user can paste */
      }
    }

    if (!data.authUrl) {
      return { ok: false, error: "No authorization URL from provider" };
    }
    await shell.openExternal(data.authUrl);
    return {
      ok: true,
      flowType: data.flowType || "authorization_code",
      authUrl: data.authUrl,
      state: data.state,
      codeVerifier: data.codeVerifier,
      redirectUri: data.redirectUri || redirectUri,
      openedBrowser: true,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function pollModelHubOAuthCallback(state: string): Promise<{
  status: "waiting" | "done" | "error";
  code?: string;
  token?: string;
  fullUrl?: string;
  error?: string;
}> {
  const base = requireBaseUrl();
  const res = await fetch(
    `${base}/api/oauth/pending?state=${encodeURIComponent(state)}`,
  );
  const data = (await res.json()) as {
    status?: string;
    code?: string;
    token?: string;
    fullUrl?: string;
    error?: string;
  };
  if (data.status === "done") {
    return {
      status: data.error ? "error" : "done",
      code: data.code || data.token,
      token: data.token,
      fullUrl: data.fullUrl,
      error: data.error,
    };
  }
  return { status: "waiting" };
}

export async function exchangeModelHubOAuth(options: {
  provider: string;
  code: string;
  redirectUri?: string;
  codeVerifier?: string;
  state?: string;
}): Promise<{ ok: boolean; connection?: unknown; error?: string }> {
  const base = requireBaseUrl();
  const res = await fetch(
    `${base}/api/oauth/${encodeURIComponent(options.provider)}/exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: options.code,
        redirectUri: options.redirectUri,
        codeVerifier: options.codeVerifier,
        state: options.state,
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    connection?: unknown;
    error?: string;
  };
  if (!res.ok || data.success === false) {
    return { ok: false, error: data.error || `exchange ${res.status}` };
  }
  return { ok: true, connection: data.connection };
}

export async function pollModelHubDeviceToken(options: {
  provider: string;
  deviceCode: string;
  codeVerifier?: string;
}): Promise<{
  status: "pending" | "done" | "error";
  connection?: unknown;
  error?: string;
}> {
  const base = requireBaseUrl();
  const res = await fetch(
    `${base}/api/oauth/${encodeURIComponent(options.provider)}/poll`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceCode: options.deviceCode,
        codeVerifier: options.codeVerifier,
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    success?: boolean;
    connection?: unknown;
    error?: string;
  };
  if (data.status === "pending" || data.status === "authorization_pending") {
    return { status: "pending" };
  }
  if (!res.ok || data.error) {
    return { status: "error", error: data.error || `poll ${res.status}` };
  }
  if (data.success || data.connection) {
    return { status: "done", connection: data.connection };
  }
  return { status: "pending" };
}

export function modelHubStatusPayload(): ModelHubStatus & {
  pages: typeof MODEL_HUB_PAGES;
} {
  return {
    ...getModelHubStatus(),
    pages: MODEL_HUB_PAGES,
  };
}
