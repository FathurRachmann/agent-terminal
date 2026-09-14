import "dotenv/config";
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentBundle } from "../agent/create-agent.js";
import type { AgentUiEvent } from "../cli/run-agent.js";
import { getBots, getBot, initializeBots, botThreadId, isBotThreadId, isSpecializedBot, parseBotIdFromThread } from "../agent/bot-manager.js";
import { buildBotScopeInstruction } from "../agent/bot-scope-middleware.js";
import {
  applySettingsEnvToProcess,
  loadStoredSettings,
} from "./settings-store.js";
import {
  applySettingsUpdate,
  buildSettingsSnapshot,
  ensureSettingsFile,
  type SettingsUpdatePayload,
} from "./settings-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let agentBundle: AgentBundle | null = null;
let agentBootError: string | null = null;
/** Threads currently executing a turn (supports parallel sessions). */
const busyThreadIds = new Set<string>();
let activeBotId = "general";
let activeThreadId = `desktop-${Date.now()}`;
/** Last general (non-bot) thread — restored when leaving a bot session. */
let lastGeneralThreadId = activeThreadId;
let workspaceRoot = "";
const pendingApprovals = new Map<
  string,
  (decision: { decisions: Array<{ type: "approve" | "reject" }> }) => void
>();

function listBusyThreadIds(): string[] {
  return [...busyThreadIds];
}

function primaryBusyThreadId(): string | null {
  return listBusyThreadIds()[0] ?? null;
}

function applyBotScope(botId: string) {
  const bot = getBot(workspaceRoot, botId);
  activeBotId = bot.id;
  agentBundle?.botScope.setAllowedTools(
    isSpecializedBot(bot) ? (bot.tools ?? null) : null,
  );
  return bot;
}

/** Update active bot id without mutating in-flight tool allowlist. */
function selectBotWithoutScopeMutation(botId: string) {
  const bot = getBot(workspaceRoot, botId);
  activeBotId = bot.id;
  return bot;
}

function listGeneralSessions() {
  return listSessionsSafe().filter((s) => !isBotThreadId(s.threadId));
}

function resolveRendererHtml(): string {
  const viteOut = path.join(__dirname, "../renderer/index.html");
  const sibling = path.join(__dirname, "renderer/index.html");
  if (fs.existsSync(viteOut)) return viteOut;
  if (fs.existsSync(sibling)) return sibling;
  throw new Error(
    `Renderer not found. Run \`npm run build\` first.\nLooked for:\n- ${viteOut}\n- ${sibling}`,
  );
}

function resolvePreload(): string {
  const cjs = path.join(__dirname, "preload.cjs");
  const js = path.join(__dirname, "preload.js");
  if (fs.existsSync(cjs)) return cjs;
  if (fs.existsSync(js)) return js;
  throw new Error(`Preload not found at ${cjs}`);
}

function emitToRenderer(event: AgentUiEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("agent:event", event);
}

function listSessionsSafe() {
  if (!agentBundle) return [];
  return agentBundle.sessionStore.listSessions();
}

async function bootAgentEngine(options?: { disposePrevious?: boolean }) {
  const { createTerminalAgent } = await import("../agent/create-agent.js");
  applySettingsEnvToProcess(workspaceRoot);
  const prefs = loadStoredSettings(workspaceRoot);
  const previous = agentBundle;
  const next = await createTerminalAgent({
    workspaceRoot,
    autoApprove: prefs.agent.autoApproveDestructive,
    requirePlanApproval: prefs.agent.requirePlanApproval,
    enableCheckpointer: prefs.agent.enableCheckpointer,
    enableReflection: prefs.agent.enableReflection,
  });
  agentBundle = next;
  agentBootError = null;
  if (options?.disposePrevious && previous) {
    try {
      previous.sandbox.dispose();
    } catch {
      /* ignore */
    }
  }
  return next;
}

async function reloadAgentForCapabilities(): Promise<{
  reloaded: boolean;
  reason?: string;
}> {
  if (busyThreadIds.size > 0) {
    return { reloaded: false, reason: "Agent is busy; filter applies on next reload." };
  }
  try {
    await bootAgentEngine({ disposePrevious: true });
    return { reloaded: true };
  } catch (err) {
    agentBootError = err instanceof Error ? err.message : String(err);
    return {
      reloaded: false,
      reason: agentBootError,
    };
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "Agent Desktop",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: resolvePreload(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`Failed to load UI (${code}): ${desc} — ${url}`);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (devUrl) {
    try {
      await mainWindow.loadURL(devUrl);
      return;
    } catch (err) {
      console.error(
        `Vite dev server unreachable at ${devUrl}. Falling back to built renderer.`,
        err,
      );
    }
  }

  await mainWindow.loadFile(resolveRendererHtml());
}

app.whenReady().then(async () => {
  workspaceRoot = path.resolve(__dirname, "../../");
  ensureSettingsFile(workspaceRoot);
  applySettingsEnvToProcess(workspaceRoot);
  initializeBots(workspaceRoot);

  ipcMain.handle("agent:getSettings", async () => {
    const folders = agentBundle?.sandbox.getAllowedRoots() ?? [workspaceRoot];
    return buildSettingsSnapshot(workspaceRoot, folders);
  });

  ipcMain.handle(
    "agent:updateSettings",
    async (_event, payload: SettingsUpdatePayload) => {
      try {
        const { snapshot, needsReload } = applySettingsUpdate(
          workspaceRoot,
          payload ?? {},
        );
        let reloaded = false;
        let reloadReason: string | undefined;
        if (needsReload) {
          const reload = await reloadAgentForCapabilities();
          reloaded = reload.reloaded;
          reloadReason = reload.reason;
          if (reloaded) {
            applyBotScope(activeBotId);
          }
        }
        const folders =
          agentBundle?.sandbox.getAllowedRoots() ?? [workspaceRoot];
        return {
          ok: true,
          reloaded,
          reloadReason,
          snapshot: buildSettingsSnapshot(workspaceRoot, folders),
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle("agent:getBots", async () => {
    const bots = getBots(workspaceRoot);
    return bots.map((b) => {
      if (!isSpecializedBot(b)) {
        return {
          ...b,
          specialized: false,
          threadId: null as string | null,
          preview: "",
          turnCount: 0,
          updatedAt: null as string | null,
        };
      }
      const threadId = botThreadId(b.id);
      const events = agentBundle?.sessionStore.readTranscript(threadId, 80) ?? [];
      const users = events.filter((e) => e.role === "user");
      const lastUser = users[users.length - 1];
      const lastAny = events[events.length - 1];
      return {
        ...b,
        specialized: true,
        threadId,
        preview: (lastUser?.content || lastAny?.content || "").slice(0, 80),
        turnCount: users.length,
        updatedAt: lastAny?.ts ?? null,
      };
    });
  });

  ipcMain.handle("agent:getLearnedRules", () => {
    if (!agentBundle) return [];
    const rules = agentBundle.memoryStore.list({ kind: "rule", limit: 200 });
    const episodes = agentBundle.memoryStore.list({ kind: "episode", limit: 100 });
    const items = [...rules, ...episodes].map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      updatedAt: r.updatedAt,
      tags: r.tags ?? [],
    }));

    // Fallback/Default system rules if memory is fresh
    if (items.length === 0) {
      return [
        {
          id: "rule-system-1",
          kind: "rule",
          title: "Working Directory Isolation",
          content: "WHEN generating files/scripts -> DO place all output inside working/ folder",
          updatedAt: new Date().toISOString(),
          tags: ["learned", "auto-reflection"],
        },
        {
          id: "rule-system-2",
          kind: "rule",
          title: "Error Self-Healing",
          content: "WHEN command fails with non-zero exit code -> DO analyze stack trace and auto-retry fix",
          updatedAt: new Date().toISOString(),
          tags: ["learned", "auto-reflection"],
        },
        {
          id: "rule-system-3",
          kind: "rule",
          title: "Node.js LangGraph Tools Extension",
          content: "WHEN extending agent capability -> DO define DynamicStructuredTool with Zod schema in src/agent/",
          updatedAt: new Date().toISOString(),
          tags: ["learned", "auto-reflection"],
        }
      ];
    }

    return items;
  });

  ipcMain.handle("agent:setActiveBot", async (_event, botId: string) => {
    // Allow switching bots/sessions while a turn continues in the background.
    const bot =
      busyThreadIds.size > 0
        ? selectBotWithoutScopeMutation(String(botId || "general").trim() || "general")
        : applyBotScope(String(botId || "general").trim() || "general");

    if (isSpecializedBot(bot)) {
      if (!isBotThreadId(activeThreadId)) {
        lastGeneralThreadId = activeThreadId;
      }
      activeThreadId = botThreadId(bot.id);
    } else {
      // General mode — restore last general session (do not share bot history).
      if (isBotThreadId(activeThreadId)) {
        const fallback =
          lastGeneralThreadId && !isBotThreadId(lastGeneralThreadId)
            ? lastGeneralThreadId
            : listGeneralSessions()[0]?.threadId;
        activeThreadId = fallback || `desktop-${Date.now()}`;
      }
      lastGeneralThreadId = activeThreadId;
    }

    const events =
      agentBundle?.sessionStore.readTranscript(activeThreadId, 800) ?? [];
    return {
      ok: true,
      activeBotId: bot.id,
      threadId: activeThreadId,
      events,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
      busy: busyThreadIds.has(activeThreadId),
    };
  });

  ipcMain.handle("agent:getStatus", async () => ({
    bridge: true,
    agentReady: Boolean(agentBundle),
    error: agentBootError,
    model: process.env.AGENT_MODEL ?? "unknown",
    workspaceRoot,
    busy: busyThreadIds.size > 0,
    busyThreadIds: listBusyThreadIds(),
    busyThreadId: primaryBusyThreadId(),
    activeThreadId,
    activeBotId,
  }));

  ipcMain.handle("agent:listProcesses", async () => {
    const { listManagedProcesses } = await import("../agent/process-manage.js");
    return { processes: listManagedProcesses() };
  });

  ipcMain.handle("agent:listCapabilities", async () => {
    const { listCapabilities } = await import("../agent/capabilities-catalog.js");
    return listCapabilities({
      workspaceRoot,
      desktopEnabled: Boolean(agentBundle?.desktopEnabled),
    });
  });

  ipcMain.handle(
    "agent:setCapabilityEnabled",
    async (_event, payload: { id: string; enabled: boolean }) => {
      const { setCapabilityEnabled, listCapabilities } = await import(
        "../agent/capabilities-catalog.js"
      );
      const id = String(payload?.id || "").trim();
      if (!id) return { ok: false, error: "id required" };
      setCapabilityEnabled(workspaceRoot, id, Boolean(payload.enabled));
      const reload = await reloadAgentForCapabilities();
      return {
        ok: true,
        reloaded: reload.reloaded,
        reloadReason: reload.reason,
        ...listCapabilities({
          workspaceRoot,
          desktopEnabled: Boolean(agentBundle?.desktopEnabled),
        }),
      };
    },
  );

  ipcMain.handle("agent:listArtifacts", async () => {
    if (!agentBundle) {
      return {
        artifacts: [],
        counts: { all: 0, images: 0, files: 0, links: 0 },
      };
    }
    const { listAllArtifacts } = await import("./artifacts-index.js");
    return listAllArtifacts({
      sessionStore: agentBundle.sessionStore,
      workspaceRoot,
      includeWorkingScan: true,
    });
  });

  ipcMain.handle(
    "agent:readWorkspacePreview",
    async (_event, payload: { path?: string }) => {
      const { readWorkspacePreview } = await import("./workspace-preview.js");
      const filePath = String(payload?.path || "").trim();
      if (!filePath) return { ok: false, error: "path required" };
      return readWorkspacePreview(workspaceRoot, filePath);
    },
  );

  ipcMain.handle(
    "agent:discoverDeliverables",
    async (
      _event,
      payload: { texts?: string[]; command?: string; maxAgeMs?: number },
    ) => {
      const { discoverDeliverables } = await import("./workspace-preview.js");
      return discoverDeliverables(workspaceRoot, {
        texts: Array.isArray(payload?.texts)
          ? payload.texts.map(String)
          : [],
        command: payload?.command ? String(payload.command) : undefined,
        maxAgeMs: payload?.maxAgeMs,
      });
    },
  );

  ipcMain.handle("agent:pollProcess", async (_event, pid: number) => {
    const { pollManagedProcess } = await import("../agent/process-manage.js");
    return pollManagedProcess(Number(pid));
  });

  ipcMain.handle("agent:killProcess", async (_event, pid: number) => {
    const { killManagedProcess } = await import("../agent/process-manage.js");
    return killManagedProcess(Number(pid));
  });

  ipcMain.handle("agent:listSessions", async () => {
    const sessions = listGeneralSessions();
    if (
      !isBotThreadId(activeThreadId) &&
      !sessions.some((s) => s.threadId === activeThreadId)
    ) {
      sessions.unshift({
        threadId: activeThreadId,
        updatedAt: new Date().toISOString(),
        preview: "(current session)",
        turnCount: 0,
      });
    }
    return {
      activeThreadId,
      activeBotId,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
      sessions,
    };
  });

  ipcMain.handle("agent:newSession", async () => {
    // Allow creating/viewing another session while a turn runs in the background.
    if (busyThreadIds.size > 0) {
      selectBotWithoutScopeMutation("general");
    } else {
      applyBotScope("general");
    }
    activeThreadId = `desktop-${Date.now()}`;
    lastGeneralThreadId = activeThreadId;
    return {
      ok: true,
      threadId: activeThreadId,
      activeBotId,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
    };
  });

  ipcMain.handle("agent:openSession", async (_event, threadId: string) => {
    // Do not block navigation — background turns keep running on their thread ids.
    const id = String(threadId || "").trim();
    if (!id) return { ok: false, error: "threadId required" };
    activeThreadId = id;

    if (isBotThreadId(id)) {
      const botId = parseBotIdFromThread(id) ?? "general";
      if (busyThreadIds.size > 0) {
        selectBotWithoutScopeMutation(botId);
      } else {
        applyBotScope(botId);
      }
    } else {
      lastGeneralThreadId = id;
      if (busyThreadIds.size > 0) {
        selectBotWithoutScopeMutation("general");
      } else {
        applyBotScope("general");
      }
    }

    const events = agentBundle?.sessionStore.readTranscript(id, 800) ?? [];
    return {
      ok: true,
      threadId: id,
      activeBotId,
      events,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
      busy: busyThreadIds.has(id),
    };
  });

  ipcMain.handle(
    "agent:resolveApproval",
    async (_event, payload: { approve?: boolean; threadId?: string }) => {
      const tid =
        String(payload?.threadId || "").trim() ||
        activeThreadId ||
        primaryBusyThreadId();
      const resolve = tid ? pendingApprovals.get(tid) : undefined;
      if (!resolve || !tid) {
        return { ok: false, error: "No pending approval" };
      }
      pendingApprovals.delete(tid);
      const approve = payload?.approve !== false;
      resolve({
        decisions: [{ type: approve ? "approve" : "reject" }],
      });
      return { ok: true, approve, threadId: tid };
    },
  );

  ipcMain.handle("agent:sendPrompt", async (_event, prompt: string) => {
    if (!agentBundle) {
      const error =
        agentBootError ??
        "Agent engine not ready. Check terminal for boot errors (ROUTER_API_KEY, etc).";
      emitToRenderer({ type: "error", message: error });
      return { ok: false, error };
    }

    const turnThreadId = activeThreadId;
    const turnBotId = activeBotId;
    if (busyThreadIds.has(turnThreadId)) {
      return {
        ok: false,
        error: "This session is already running a turn.",
        threadId: turnThreadId,
        busyThreadIds: listBusyThreadIds(),
        busyThreadId: primaryBusyThreadId(),
      };
    }

    busyThreadIds.add(turnThreadId);
    emitToRenderer({
      type: "status",
      phase: "thinking",
      detail: "turn started",
      threadId: turnThreadId,
    } as never);
    try {
      const { runAgentTurn } = await import("../cli/run-agent.js");
      const currentBot =
        busyThreadIds.size === 1
          ? applyBotScope(turnBotId)
          : selectBotWithoutScopeMutation(turnBotId);
      // When another turn owns the tool allowlist, still scope the prompt text.
      if (busyThreadIds.size > 1) {
        const wanted = isSpecializedBot(currentBot)
          ? (currentBot.tools ?? null)
          : null;
        const current = agentBundle.botScope.getAllowedTools();
        const same =
          wanted === null
            ? current === null
            : Array.isArray(current) &&
              wanted.length === current.length &&
              wanted.every((t) => current.includes(t));
        if (!same && wanted === null) {
          // Prefer unlocking tools when a general turn joins specialized ones.
          agentBundle.botScope.setAllowedTools(null);
        }
      }
      const specialized = isSpecializedBot(currentBot);
      const botInstruction = specialized
        ? buildBotScopeInstruction(currentBot)
        : undefined;

      const answer = await runAgentTurn({
        agent: agentBundle.agent,
        prompt,
        botInstruction,
        threadId: turnThreadId,
        autoApprove: loadStoredSettings(workspaceRoot).agent.autoApproveDestructive,
        // Desktop fast-path is general-mode only — specialized bots stay scoped.
        desktopEnabled: agentBundle.desktopEnabled && !specialized,
        requestApproval: () =>
          new Promise((resolve) => {
            pendingApprovals.set(turnThreadId, resolve);
          }),
        memory: {
          sessionStore: agentBundle.sessionStore,
          memoryStore: agentBundle.memoryStore,
          embedder: agentBundle.embedder,
          model: agentBundle.model,
          workspaceRoot: agentBundle.workspaceRoot,
          enableReflection: agentBundle.enableReflection,
        },
        onEvent: (ev) =>
          emitToRenderer({ ...ev, threadId: turnThreadId } as never),
      });
      return {
        ok: true,
        content: answer,
        threadId: turnThreadId,
        activeBotId: turnBotId,
        busyThreadIds: listBusyThreadIds(),
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      emitToRenderer({
        type: "error",
        message: error,
        threadId: turnThreadId,
      } as never);
      return {
        ok: false,
        error,
        threadId: turnThreadId,
        busyThreadIds: listBusyThreadIds(),
      };
    } finally {
      busyThreadIds.delete(turnThreadId);
      const pending = pendingApprovals.get(turnThreadId);
      if (pending) {
        pendingApprovals.delete(turnThreadId);
        pending({
          decisions: [{ type: "reject" }],
        });
      }
      // Restore tool scope for the session the UI is currently viewing.
      if (busyThreadIds.size === 0) {
        applyBotScope(activeBotId);
      }
    }
  });

  try {
    await createWindow();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    app.quit();
    return;
  }

  try {
    await bootAgentEngine();
    // Prefer last real general transcript over a fresh empty desktop-* id.
    const newestGeneral = listGeneralSessions()[0];
    if (newestGeneral) {
      lastGeneralThreadId = newestGeneral.threadId;
      if (!isBotThreadId(activeThreadId)) {
        activeThreadId = newestGeneral.threadId;
      }
    }
    applyBotScope(activeBotId);
    console.log("Agent engine ready");
  } catch (err) {
    agentBootError = err instanceof Error ? err.message : String(err);
    console.error("Failed to boot agent engine:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
