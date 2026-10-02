/**
 * Embedded Model Hub lifecycle — runs *copied* 9Router engine source under
 * src/model-hub/ (not the npm `9router` package, not an external dashboard).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ModelHubStatus = {
  running: boolean;
  ready: boolean;
  port: number | null;
  baseUrl: string | null;
  v1BaseUrl: string | null;
  apiKey: string | null;
  dataDir: string | null;
  error: string | null;
  pid: number | null;
};

type HubState = {
  child: ChildProcess | null;
  port: number | null;
  dataDir: string | null;
  apiKey: string | null;
  ready: boolean;
  error: string | null;
  restartAttempts: number;
  stopping: boolean;
};

const state: HubState = {
  child: null,
  port: null,
  dataDir: null,
  apiKey: null,
  ready: false,
  error: null,
  restartAttempts: 0,
  stopping: false,
};

const MAX_RESTARTS = 3;
const HEALTH_TIMEOUT_MS = 90_000;

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/desktop-app → repo root; also works from src via tsx
  const candidates = [
    path.resolve(here, "../.."),
    path.resolve(here, "../../.."),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "src", "model-hub", "server.mjs"))) {
      return c;
    }
  }
  return path.resolve(here, "../..");
}

export function resolveModelHubRoot(): string {
  const root = path.join(repoRoot(), "src", "model-hub");
  if (!fs.existsSync(path.join(root, "server.mjs"))) {
    throw new Error(`Model Hub source missing at ${root}`);
  }
  return root;
}

function findFreePort(preferred = 27128): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, remaining: number) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => {
        if (remaining <= 0) {
          reject(new Error("No free port for Model Hub"));
          return;
        }
        tryListen(port + 1, remaining - 1);
      });
      srv.listen(port, "127.0.0.1", () => {
        const addr = srv.address();
        const p = addr && typeof addr === "object" ? addr.port : preferred;
        srv.close(() => resolve(p));
      });
    };
    tryListen(preferred, 40);
  });
}

function httpJson(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body =
      options?.body !== undefined ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options?.method || "GET",
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          ...options?.headers,
        },
        timeout: options?.timeoutMs ?? 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr = "not ready";
  while (Date.now() - start < timeoutMs) {
    try {
      const { status, json } = await httpJson(`${baseUrl}/api/health`, {
        timeoutMs: 2000,
      });
      if (status === 200 && (json as { ok?: boolean })?.ok) return;
      lastErr = `health ${status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Model Hub health check failed: ${lastErr}`);
}

async function ensureApiKey(baseUrl: string): Promise<string> {
  const listed = await httpJson(`${baseUrl}/api/keys`).catch(() => null);
  if (listed && listed.status === 200) {
    const keys = (
      listed.json as { keys?: Array<{ key?: string; isActive?: boolean }> }
    )?.keys;
    const active = (keys || []).find((k) => k.isActive !== false && k.key);
    if (active?.key) return active.key;
    if (keys?.[0]?.key) return keys[0].key!;
  }

  const created = await httpJson(`${baseUrl}/api/keys`, {
    method: "POST",
    body: { name: "agent-desktop" },
  });
  const key = (created.json as { key?: string })?.key;
  if (created.status >= 200 && created.status < 300 && key) return key;
  return "local-model-hub";
}

function injectRouterEnv(baseUrl: string, apiKey: string): void {
  process.env.ROUTER_BASE_URL = `${baseUrl}/v1`;
  process.env.ROUTER_API_KEY = apiKey;
}

export function getModelHubStatus(): ModelHubStatus {
  const base =
    state.port != null ? `http://127.0.0.1:${state.port}` : null;
  return {
    running: Boolean(state.child && !state.child.killed),
    ready: state.ready,
    port: state.port,
    baseUrl: base,
    v1BaseUrl: base ? `${base}/v1` : null,
    apiKey: state.apiKey,
    dataDir: state.dataDir,
    error: state.error,
    pid: state.child?.pid ?? null,
  };
}

export function getModelHubBaseUrl(): string | null {
  return state.port != null ? `http://127.0.0.1:${state.port}` : null;
}

async function spawnHub(
  profileHome: string,
): Promise<{ baseUrl: string; apiKey: string }> {
  const hubRoot = resolveModelHubRoot();
  const repo = repoRoot();
  const dataDir = path.join(path.resolve(profileHome), ".agent", "model-hub");
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await findFreePort(27128);

  const register = path.join(hubRoot, "register-aliases.mjs");
  const server = path.join(hubRoot, "server.mjs");

  // Under Electron, process.execPath is the Electron binary — run it as Node.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    MODEL_HUB_NO_LOGIN: "1",
    NODE_ENV: process.env.NODE_ENV || "production",
  };

  const child = spawn(
    process.execPath,
    [
      "--dns-result-order=ipv4first",
      "--import",
      register,
      server,
    ],
    {
      cwd: repo,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
    },
  );

  state.child = child;
  state.port = port;
  state.dataDir = dataDir;
  state.ready = false;
  state.error = null;

  const logTail: string[] = [];
  const pushLog = (buf: Buffer) => {
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    logTail.push(...lines);
    if (logTail.length > 80) logTail.splice(0, logTail.length - 80);
    for (const line of lines) {
      console.log(`[model-hub-child] ${line}`);
    }
  };
  child.stdout?.on("data", pushLog);
  child.stderr?.on("data", pushLog);

  child.on("exit", (code, signal) => {
    if (state.stopping) return;
    state.ready = false;
    state.child = null;
    state.error = `Model Hub exited (${signal || code}). ${logTail.slice(-8).join(" | ")}`;
    if (state.restartAttempts < MAX_RESTARTS) {
      state.restartAttempts += 1;
      void startModelHub(profileHome).catch(() => undefined);
    }
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, HEALTH_TIMEOUT_MS);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const logs = logTail.slice(-12).join(" | ");
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    state.child = null;
    state.port = null;
    state.ready = false;
    throw new Error(
      `${detail}${logs ? ` — child: ${logs}` : " — child produced no output (check ELECTRON_RUN_AS_NODE)"}`,
    );
  }
  const apiKey = await ensureApiKey(baseUrl);
  state.apiKey = apiKey;
  state.ready = true;
  state.restartAttempts = 0;
  injectRouterEnv(baseUrl, apiKey);
  return { baseUrl, apiKey };
}

let startPromise: Promise<ModelHubStatus> | null = null;

export async function startModelHub(
  profileHome: string,
): Promise<ModelHubStatus> {
  if (state.ready && state.child) return getModelHubStatus();
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      if (state.child) {
        await stopModelHub();
      }
      state.stopping = false;
      await spawnHub(profileHome);
      return getModelHubStatus();
    } catch (e) {
      state.ready = false;
      state.error = e instanceof Error ? e.message : String(e);
      try {
        state.child?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      state.child = null;
      return getModelHubStatus();
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
}

export async function stopModelHub(): Promise<void> {
  state.stopping = true;
  const child = state.child;
  state.child = null;
  state.ready = false;
  if (!child || child.killed) {
    state.port = null;
    return;
  }
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      done();
      return;
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      done();
    }, 2500);
  });
  state.port = null;
}
