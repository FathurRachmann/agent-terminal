import "dotenv/config";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentBundle } from "../agent/create-agent.js";
import type { AgentUiEvent } from "../cli/run-agent.js";
import { getBots, getBot, initializeBots, botThreadId, isBotThreadId, isSpecializedBot, parseBotIdFromThread } from "../agent/bot-manager.js";
import { buildBotScopeInstruction } from "../agent/bot-scope-middleware.js";
import {
  resolveWorkingScope,
  workingScopeAbs,
  workingScopeInstruction,
  type WorkingScope,
} from "../agent/working-paths.js";
import {
  registerKanbanIpc,
  startCronScheduler,
  startKanbanDispatcher,
  stopKanbanServices,
} from "./kanban-service.js";
import { createRouterModel } from "../model/9router.js";
import { createDeepAgent } from "deepagents";
import { FilesystemBackend } from "deepagents";
import { openBoardStore } from "../agent/kanban/store.js";
import type { createKanbanWorkerTools } from "../agent/kanban/tools.js";
import {
  applySettingsEnvToProcess,
  loadStoredSettings,
} from "./settings-store.js";
import {
  applySettingsUpdate,
  buildSettingsSnapshot,
  ensureSettingsFile,
  type SettingsContext,
  type SettingsUpdatePayload,
} from "./settings-service.js";
import {
  createProfile,
  ensureProfileHome,
  getActiveProfileHome,
  isValidProfileId,
  listProfileSummaries,
  loadRegistry,
  migrateWorkspaceAgentToProfiles,
  profileDesktopLogPath,
  readSoul,
  setActiveProfile,
  setDefaultProfile,
  setGatewayMode,
  summarizeProfile,
  writeSoul,
  type GatewayMode,
} from "../agent/profiles/index.js";
import { LocalGatewayController } from "../agent/gateway/local.js";
import {
  createProject,
  deleteProject,
  getActiveProject,
  listProjectSummaries,
  loadProjectRegistry,
  primaryFolderOf,
  setActiveProject,
  updateProject,
  type ProjectRecord,
} from "../agent/projects/index.js";
import {
  isWorkspaceThreadId,
  registerWorkspaceIpc,
} from "./workspace-service.js";
import { softAllowProjectFolders } from "./soft-allow-project.js";
import {
  buildDeliverySearchRoots,
  sessionWorkspaceFields,
} from "./session-workspace.js";
import {
  resolveNewSessionProjectId,
  resolveSessionTurnProjectId,
} from "./session-project-binding.js";
import {
  loadMessagingConfig,
  resolveWhatsAppAccessRole,
  saveMessagingConfig,
  threadIdForWhatsAppJid,
  type MessagingConfig,
} from "./messaging-store.js";
import {
  WA_FRIEND_ALLOWED_TOOLS,
  buildWhatsAppRoleInstruction,
} from "./messaging-roles.js";
import {
  WhatsAppBridge,
  type WhatsAppBridgeEvent,
  type WhatsAppInboundMessage,
} from "./whatsapp-bridge.js";
import { collectDeliverablePaths } from "./file-delivery.js";
import {
  isWhatsAppAttachablePath,
  sanitizeWhatsAppOutboundText,
  WA_OUTBOUND_HYGIENE_INSTRUCTION,
} from "./whatsapp-outbound.js";
import { extractInterruptActionNames, isPlanApprovalInterrupt } from "../agent/interrupt-utils.js";
import { loadFolderAllowlist } from "../agent/folder-allowlist.js";
import { userHomeRoot, usersScopeRoot } from "../agent/default-sandbox-roots.js";
import {
  loadPrivacyMode,
  privacyModeInstruction,
  savePrivacyMode,
} from "../agent/privacy-mode.js";
import {
  buildSelfHealPrompt,
  parseSelfHealCommand,
  SelfHealController,
  SELF_HEAL_BOT_INSTRUCTION,
  type SelfHealTrigger,
} from "../agent/self-heal/index.js";
import { terminalService } from "./terminal-service.js";
import {
  AGENT_PREVIEW_SCHEME,
  decodeAgentPreviewUrl,
} from "./preview-protocol.js";
import { installMainProcessCrashGuards } from "./main-process-guards.js";

// Catch undici/fetch aborts before Electron paints a fatal dialog.
installMainProcessCrashGuards();

// Must run before app is ready — enables iframe/video PDF & media streaming in Canvas.
protocol.registerSchemesAsPrivileged([
  {
    scheme: AGENT_PREVIEW_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let workspacesWindow: BrowserWindow | null = null;
let agentBundle: AgentBundle | null = null;
let agentBootError: string | null = null;
/** True while createTerminalAgent is in flight (window may already be open). */
let agentBooting = false;
/** Threads currently executing a turn (supports parallel sessions). */
const busyThreadIds = new Set<string>();
let activeBotId = "general";
let activeThreadId = `desktop-${Date.now()}`;
/** Last general (non-bot) thread — restored when leaving a bot session. */
let lastGeneralThreadId = activeThreadId;
let workspaceRoot = "";
/** Active profile home (agent state root). */
let profileHome = "";
let profileId = "default";
/** When set, agent + UI are scoped to this project's folders. */
let activeProjectId: string | null = null;
const localGateway = new LocalGatewayController();
const pendingApprovals = new Map<
  string,
  (decision: { decisions: Array<{ type: "approve" | "reject" }> }) => void
>();
let whatsappBridge: WhatsAppBridge | null = null;
const selfHeal = new SelfHealController();

/** Ring buffer of recent PTY output for @Terminals mentions. */
const recentPtyChunks: string[] = [];
const RECENT_PTY_MAX = 24;
function appendRecentPty(chunk: string): void {
  if (!chunk) return;
  recentPtyChunks.push(chunk);
  while (recentPtyChunks.length > RECENT_PTY_MAX) recentPtyChunks.shift();
}
function recentTerminalLog(): string {
  return recentPtyChunks.join("").slice(-12_000);
}

function agentNotReadyMessage(): string {
  if (agentBootError) return agentBootError;
  if (agentBooting) {
    return "Agent engine is still starting (tools/MCP)… wait a moment and retry.";
  }
  return "Agent engine not ready. Check terminal for boot errors (ROUTER_API_KEY, etc).";
}

function settingsCtx(): SettingsContext {
  return { agentHome: profileHome || workspaceRoot, workspaceRoot, profileId };
}

function agentStateRoot(): string {
  return profileHome || workspaceRoot;
}

function syncActiveProjectFromDisk(): ProjectRecord | null {
  const project = getActiveProject(agentStateRoot());
  activeProjectId = project?.id ?? null;
  return project;
}

/** Primary cwd for agent tools / git / terminal when a project is active. */
function effectiveWorkspaceRoot(): string {
  const project = getActiveProject(agentStateRoot());
  return primaryFolderOf(project) || workspaceRoot;
}

function effectiveAllowedFolders(): string[] | undefined {
  const project = getActiveProject(agentStateRoot());
  const persisted = loadFolderAllowlist(agentStateRoot());
  const projectFolders = project?.folders?.length ? [...project.folders] : [];
  const home = userHomeRoot();
  const users = usersScopeRoot();
  const merged = [
    ...new Set([
      ...(users ? [users] : []),
      ...(home ? [home] : []),
      ...projectFolders,
      ...persisted,
    ]),
  ];
  return merged.length ? merged : undefined;
}

/**
 * Roots for Open / Save as / reveal of agent deliverables.
 * Always includes Agent artifact home so tmp/global|bots|project resolve.
 */
function deliverySearchRoots(): string[] {
  return buildDeliverySearchRoots({
    projectFolders: effectiveAllowedFolders() ?? null,
    toolWorkspaceRoot: effectiveWorkspaceRoot(),
    artifactHome: artifactHomeRoot(),
  });
}

/** Artifact root is always the Agent application repo. */
function artifactHomeRoot(): string {
  return workspaceRoot;
}

function turnWorkingScope(opts?: {
  threadId?: string | null;
  botId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
}): WorkingScope {
  const threadId = opts?.threadId ?? activeThreadId;
  const botSession = isBotThreadId(threadId);
  // Session meta is source of truth — not the global activeProjectId sticky flag.
  // Otherwise general sessions keep writing into the last project's tmp/ folder.
  const metaProjectId =
    !botSession && agentBundle?.sessionStore
      ? (agentBundle.sessionStore.readSessionMeta(threadId).projectId ?? null)
      : null;
  const resolvedProjectId = resolveSessionTurnProjectId({
    isBotThread: botSession,
    sessionMetaProjectId: metaProjectId,
    overrideProjectId: opts?.projectId,
  });
  const project =
    resolvedProjectId
      ? loadProjectRegistry(agentStateRoot()).projects.find(
          (p) => p.id === resolvedProjectId,
        ) ?? null
      : null;
  return resolveWorkingScope({
    threadId,
    botId:
      opts?.botId ??
      (botSession ? activeBotId || parseBotIdFromThread(threadId) : null),
    workspaceId: opts?.workspaceId ?? null,
    projectId: resolvedProjectId,
    projectName:
      opts?.projectName !== undefined
        ? opts.projectName
        : botSession
          ? null
          : project?.name ?? null,
  });
}

function ensureTurnWorkingDirs(scope: WorkingScope): {
  absDir: string;
  uploadsAbsDir: string;
  nudge: string;
} {
  const { absDir, uploadsAbsDir } = workingScopeAbs(artifactHomeRoot(), scope);
  fs.mkdirSync(absDir, { recursive: true });
  fs.mkdirSync(uploadsAbsDir, { recursive: true });
  return {
    absDir,
    uploadsAbsDir,
    nudge: workingScopeInstruction(scope, absDir),
  };
}

function isAbsInsideAnyRoot(abs: string, roots: string[]): boolean {
  const resolved = path.resolve(abs);
  for (const root of roots) {
    const r = path.resolve(root);
    const rel = path.relative(r, resolved);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
    if (resolved === r) return true;
  }
  return false;
}

function registerAgentPreviewProtocol() {
  protocol.handle(AGENT_PREVIEW_SCHEME, async (request) => {
    try {
      const abs = decodeAgentPreviewUrl(request.url);
      if (!abs) {
        return new Response("Bad preview URL", { status: 400 });
      }
      const roots = deliverySearchRoots();
      if (!isAbsInsideAnyRoot(abs, roots)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).href);
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 500,
      });
    }
  });
}

function listBusyThreadIds(): string[] {
  return [...busyThreadIds];
}

function primaryBusyThreadId(): string | null {
  return listBusyThreadIds()[0] ?? null;
}

function applyBotScope(botId: string) {
  const bot = getBot(agentStateRoot(), botId);
  activeBotId = bot.id;
  agentBundle?.botScope.setAllowedTools(
    isSpecializedBot(bot) ? (bot.tools ?? null) : null,
  );
  return bot;
}

/** Update active bot id without mutating in-flight tool allowlist. */
function selectBotWithoutScopeMutation(botId: string) {
  const bot = getBot(agentStateRoot(), botId);
  activeBotId = bot.id;
  return bot;
}

function listGeneralSessions() {
  return listSessionsSafe().filter(
    (s) => !isBotThreadId(s.threadId) && !isWorkspaceThreadId(s.threadId),
  );
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
  if (event.type === "error" && typeof event.message === "string") {
    selfHeal.recordTurnError(event.message, "turn");
  }
  for (const win of [mainWindow, workspacesWindow]) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send("agent:event", event);
  }
}

/** Prefer the IPC sender's window so dialogs aren't hidden behind Workspaces. */
function dialogParent(
  event?: { sender?: Electron.WebContents } | null,
): BrowserWindow | undefined {
  try {
    const fromSender = event?.sender
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
    if (fromSender && !fromSender.isDestroyed()) return fromSender;
  } catch {
    /* ignore */
  }
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  if (workspacesWindow && !workspacesWindow.isDestroyed()) return workspacesWindow;
  return undefined;
}

function workspacesWindowUrl(): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (devUrl) {
    const base = devUrl.replace(/\/$/, "");
    return `${base}/?view=workspaces`;
  }
  // file:// load — hash works without a server
  return "";
}

async function openWorkspacesWindow(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (workspacesWindow && !workspacesWindow.isDestroyed()) {
    if (workspacesWindow.isMinimized()) workspacesWindow.restore();
    workspacesWindow.focus();
    return { ok: true };
  }

  workspacesWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Workspaces — Agent Desktop",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#0a0a0b",
    webPreferences: {
      preload: resolvePreload(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  workspacesWindow.on("closed", () => {
    workspacesWindow = null;
  });

  const dev = workspacesWindowUrl();
  if (dev) {
    try {
      await workspacesWindow.loadURL(dev);
      return { ok: true };
    } catch (err) {
      console.error("Workspaces window: Vite unreachable, falling back", err);
    }
  }

  try {
    await workspacesWindow.loadFile(resolveRendererHtml(), {
      query: { view: "workspaces" },
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    workspacesWindow.close();
    workspacesWindow = null;
    return { ok: false, error: message };
  }
}

function emitTerminalData(sessionId: string, data: string) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("terminal:data", { id: sessionId, data });
}

function emitTerminalExit(
  sessionId: string,
  exitCode: number,
  signal?: number,
) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("terminal:exit", {
    id: sessionId,
    exitCode,
    signal,
  });
}

async function runSelfHealTurn(opts: {
  trigger: SelfHealTrigger;
  note?: string;
  threadId?: string;
}): Promise<{ ok: boolean; content?: string; error?: string; threadId: string }> {
  const turnThreadId = opts.threadId ?? activeThreadId;
  if (!agentBundle) {
    const error = agentNotReadyMessage();
    emitToRenderer({ type: "error", message: error });
    return { ok: false, error, threadId: turnThreadId };
  }

  const begin = selfHeal.begin(opts.trigger);
  if (!begin.ok) {
    emitToRenderer({
      type: "warning",
      message: begin.reason,
      threadId: turnThreadId,
    } as never);
    return { ok: false, error: begin.reason, threadId: turnThreadId };
  }

  if (busyThreadIds.has(turnThreadId)) {
    selfHeal.end("failed", "Session busy");
    return {
      ok: false,
      error: "This session is already running a turn.",
      threadId: turnThreadId,
    };
  }

  const prompt = buildSelfHealPrompt({
    recentErrors: selfHeal.errors.snapshot(),
    userNote: opts.note,
    maxIterations: selfHeal.maxIterations,
  });

  busyThreadIds.add(turnThreadId);
  selfHeal.setPhase("repairing");
  emitToRenderer({
    type: "status",
    phase: "thinking",
    detail: `self-heal (${opts.trigger}) started`,
    threadId: turnThreadId,
  } as never);
  emitToRenderer({
    type: "warning",
    message: `Self-heal ${opts.trigger}: diagnosing recent errors and repairing agent code…`,
    threadId: turnThreadId,
  } as never);

  try {
    const { runAgentTurn } = await import("../cli/run-agent.js");
    if (busyThreadIds.size === 1) {
      agentBundle.botScope.setAllowedTools(null);
    }
    const answer = await runAgentTurn({
      agent: agentBundle.agent,
      prompt,
      botInstruction: SELF_HEAL_BOT_INSTRUCTION,
      threadId: turnThreadId,
      autoApprove: loadStoredSettings(agentStateRoot()).agent.autoApproveDestructive,
      runMode: agentBundle.runMode,
      planGate: agentBundle.planGate,
      isPrivacyStrict: () =>
        agentBundle?.sandbox.isPrivacyStrict() ?? true,
      desktopEnabled: false,
      skipTurnScope: true,
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
        profileHome: agentBundle.profileHome,
        enableReflection: agentBundle.enableReflection,
      },
      onEvent: (ev) =>
        emitToRenderer({ ...ev, threadId: turnThreadId } as never),
    });
    selfHeal.end("done");
    emitToRenderer({
      type: "warning",
      message: "Self-heal finished. Review the repair summary above, then Continue to resume the original task.",
      threadId: turnThreadId,
    } as never);
    // Offer Continue with the last real user prompt (not the self-heal prompt).
    const lastUser = (() => {
      try {
        const rows = agentBundle.sessionStore.readTranscript(turnThreadId, 40);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const r = rows[i]!;
          if (r.role !== "user") continue;
          const text = String(r.content || "").trim();
          if (!text) continue;
          if (/self-heal|SELF_HEAL|diagnosing recent errors/i.test(text)) {
            continue;
          }
          return text;
        }
      } catch {
        /* ignore */
      }
      return opts.note?.trim() || "";
    })();
    if (lastUser) {
      emitToRenderer({
        type: "continue_available",
        reason: "self_heal",
        prompt: lastUser,
        notice: "Self-heal finished — continue the original task.",
        threadId: turnThreadId,
      } as never);
    }
    return {
      ok: true,
      content: answer,
      threadId: turnThreadId,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    selfHeal.end("failed", error);
    emitToRenderer({
      type: "error",
      message: `Self-heal failed: ${error}`,
      threadId: turnThreadId,
    } as never);
    return { ok: false, error, threadId: turnThreadId };
  } finally {
    busyThreadIds.delete(turnThreadId);
    const pending = pendingApprovals.get(turnThreadId);
    if (pending) {
      pendingApprovals.delete(turnThreadId);
      pending({ decisions: [{ type: "reject" }] });
    }
    if (busyThreadIds.size === 0) {
      applyBotScope(activeBotId);
    }
  }
}

function emitMessagingToRenderer(event: WhatsAppBridgeEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("messaging:event", event);
}

function ensureWhatsAppBridge(): WhatsAppBridge {
  if (!whatsappBridge) {
    whatsappBridge = new WhatsAppBridge(
      agentStateRoot(),
      (ev) => {
        emitMessagingToRenderer(ev);
        if (ev.type === "message_in") {
          void handleWhatsAppInbound(ev.payload);
        }
      },
      artifactHomeRoot() || effectiveWorkspaceRoot(),
    );
  } else {
    whatsappBridge.setMediaSaveRoot(artifactHomeRoot());
  }
  return whatsappBridge;
}

/** WhatsApp HITL: friends only auto-approve workspace file writes; reject shell/folder/plan. */
function decideWhatsAppApproval(
  role: "user" | "friend",
  interrupt: unknown,
): { decisions: Array<{ type: "approve" | "reject" }> } {
  if (isPlanApprovalInterrupt(interrupt)) {
    return { decisions: [{ type: "reject" }] };
  }
  const tools = extractInterruptActionNames(interrupt);
  if (role === "user") {
    return { decisions: [{ type: "approve" }] };
  }
  const friendOk = new Set(["write_file", "edit_file"]);
  const ok = tools.length > 0 && tools.every((t) => friendOk.has(t));
  return { decisions: [{ type: ok ? "approve" : "reject" }] };
}

async function handleWhatsAppInbound(msg: WhatsAppInboundMessage) {
  const bridge = ensureWhatsAppBridge();
  const config = loadMessagingConfig(agentStateRoot());
  const identity = msg.identityJid || msg.jid;
  const turnThreadId = threadIdForWhatsAppJid(identity);
  const role = resolveWhatsAppAccessRole(identity, config.whatsapp);

  if (!role) {
    emitMessagingToRenderer({
      type: "ignored",
      payload: {
        jid: identity,
        reason: "Not in User/Friends allowlist (main guard).",
      },
    });
    return;
  }

  if (!agentBundle) {
    const error = agentBooting
      ? "Agent engine is still starting… try again in a moment."
      : agentBootError ?? "Agent engine not ready; cannot reply on WhatsApp.";
    emitMessagingToRenderer({ type: "error", payload: { message: error } });
    await bridge.sendText(
      msg.jid,
      agentBooting
        ? "Agent masih starting, kirim ulang sebentar lagi ya."
        : "Agent belum siap. Coba lagi sebentar ya.",
    );
    return;
  }
  const waBundle = agentBundle;

  if (busyThreadIds.has(turnThreadId)) {
    await bridge.sendText(
      msg.jid,
      "Masih memproses pesan sebelumnya — tunggu sebentar lalu kirim lagi.",
    );
    return;
  }

  busyThreadIds.add(turnThreadId);
  emitToRenderer({
    type: "status",
    phase: "thinking",
    detail: `turn started (wa:${role})`,
    threadId: turnThreadId,
  } as never);

  await bridge.startTyping(msg.jid);

  try {
    const { runAgentTurn } = await import("../cli/run-agent.js");
    const {
      buildMultimodalUserContent,
      composePromptWithAttachments,
    } = await import("./inbound-attachments.js");

    // Apply role tool scope for this WA turn.
    selectBotWithoutScopeMutation("general");
    const hasImages = (msg.attachments ?? []).some((a) => a.kind === "image");
    if (role === "friend") {
      const tools = hasImages
        ? [...WA_FRIEND_ALLOWED_TOOLS, "vision_analyze"]
        : [...WA_FRIEND_ALLOWED_TOOLS];
      waBundle.botScope.setAllowedTools(tools);
    } else {
      waBundle.botScope.setAllowedTools(null);
    }

    const botInstruction = [
      buildWhatsAppRoleInstruction(
        role,
        config.whatsapp.conciseReplies,
      ),
      WA_OUTBOUND_HYGIENE_INSTRUCTION,
    ]
      .filter(Boolean)
      .join("\n\n");

    const attachments = msg.attachments ?? [];
    const prompt = await composePromptWithAttachments(msg.text, attachments);
    const userContent = await buildMultimodalUserContent(prompt, attachments);

    const writtenDuringTurn: string[] = [];
    const harvestedFromTools: string[] = [];
    const answer = await runAgentTurn({
      agent: waBundle.agent,
      prompt,
      userContent,
      botInstruction,
      threadId: turnThreadId,
      // Owner can proceed through tool interrupts; friends use selective approve.
      autoApprove: false,
      desktopEnabled: false,
      isPrivacyStrict: () => waBundle.sandbox.isPrivacyStrict(),
      toolScope: {
        get: () => waBundle.botScope.getAllowedTools(),
        set: (tools) => waBundle.botScope.setAllowedTools(tools),
      },
      requestApproval: async (interrupt) =>
        decideWhatsAppApproval(role, interrupt),
      memory: {
        sessionStore: waBundle.sessionStore,
        memoryStore: waBundle.memoryStore,
        embedder: waBundle.embedder,
        model: waBundle.model,
        workspaceRoot: waBundle.workspaceRoot,
        profileHome: waBundle.profileHome,
        enableReflection: waBundle.enableReflection,
      },
      onEvent: (ev) => {
        if (
          ev.type === "tool_start" &&
          (ev.name === "write_file" || ev.name === "edit_file")
        ) {
          const input = (ev.input ?? {}) as Record<string, unknown>;
          const p = String(
            input.path ?? input.file_path ?? input.filename ?? "",
          ).trim();
          if (p) writtenDuringTurn.push(p);
        }
        if (ev.type === "tool_end" && ev.output) {
          for (const p of collectDeliverablePaths([String(ev.output)])) {
            harvestedFromTools.push(p);
          }
        }
        emitToRenderer({ ...ev, threadId: turnThreadId } as never);
      },
    });

    const text = (answer || "").trim() || "(empty response)";
    const forChat = sanitizeWhatsAppOutboundText(text) || "(empty response)";
    const clipped =
      forChat.length > 3500
        ? `${forChat.slice(0, 3490)}\n…(truncated)`
        : forChat;
    const pauseMs = Math.min(1_800, Math.max(400, Math.floor(clipped.length * 12)));
    await new Promise((r) => setTimeout(r, pauseMs));
    await bridge.sendText(msg.jid, clipped);

    // Attach deliverable files mentioned in the answer (agent → user upload).
    try {
      const { prepareFileForDelivery } = await import("./file-delivery.js");
      const explicitWrites = new Set(
        writtenDuringTurn
          .map((p) => path.basename(p.trim()))
          .filter((b) => b && isWhatsAppAttachablePath(b)),
      );
      const paths = collectDeliverablePaths(
        [text],
        [...writtenDuringTurn, ...harvestedFromTools],
      )
        .filter((p) => isWhatsAppAttachablePath(p))
        .slice(0, 3);
      const roots = deliverySearchRoots();
      for (const rel of paths) {
        const file = prepareFileForDelivery(roots, rel);
        if (!file.ok) {
          // Text-scraped false positives — stay quiet.
          // Only tell the user when an explicit write/edit deliverable failed.
          if (explicitWrites.has(path.basename(rel))) {
            await bridge.sendText(
              msg.jid,
              `File tidak bisa dikirim (${path.basename(rel)}): ${file.error}`,
            );
          }
          continue;
        }
        const sent = await bridge.sendDocument(msg.jid, {
          filePath: file.abs,
          fileName: file.basename,
          mimetype: file.mime,
          caption: file.basename,
        });
        if (!sent.ok) {
          await bridge.sendText(
            msg.jid,
            `Gagal kirim file ${file.basename}: ${sent.error}`,
          );
        }
      }
    } catch {
      /* file attach is best-effort */
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    emitToRenderer({
      type: "error",
      message: error,
      threadId: turnThreadId,
    } as never);
    emitMessagingToRenderer({ type: "error", payload: { message: error } });
    await bridge.sendText(
      msg.jid,
      "Maaf, terjadi error saat memproses pesan. Coba lagi nanti.",
    );
  } finally {
    await bridge.stopTyping(msg.jid);
    busyThreadIds.delete(turnThreadId);
    if (busyThreadIds.size === 0) {
      applyBotScope(activeBotId);
    }
  }
}

function listSessionsSafe() {
  if (!agentBundle) return [];
  // Return all general sessions; UI splits global vs per-project.
  return agentBundle.sessionStore.listSessions();
}

async function bootAgentEngine(options?: { disposePrevious?: boolean }) {
  const { createTerminalAgent } = await import("../agent/create-agent.js");
  syncActiveProjectFromDisk();
  const toolRoot = effectiveWorkspaceRoot();
  const artifactHome = workspaceRoot;
  const projectFolders = effectiveAllowedFolders() ?? [];
  // Home + projects + persisted grants — createTerminalAgent also merges home.
  const allowedFolders = [...new Set([...projectFolders, artifactHome])];
  agentBooting = true;
  agentBootError = null;
  localGateway.markStarting({
    profileId,
    profileHome: agentStateRoot(),
    workspaceRoot: toolRoot,
  });
  applySettingsEnvToProcess(agentStateRoot());
  const prefs = loadStoredSettings(agentStateRoot());
  const previous = agentBundle;
  try {
    const next = await createTerminalAgent({
      workspaceRoot: toolRoot,
      allowedFolders,
      artifactHome,
      profileHome: agentStateRoot(),
      profileId,
      agentKind: prefs.agent.agentKind,
      autoApprove: prefs.agent.autoApproveDestructive,
      runMode: prefs.agent.runMode,
      toolAllowlist: prefs.agent.toolAllowlist,
      requirePlanApproval: prefs.agent.requirePlanApproval,
      enableCheckpointer: prefs.agent.enableCheckpointer,
      enableReflection: prefs.agent.enableReflection,
      privacyMode: loadPrivacyMode(agentStateRoot()),
      onPtyOutput: (chunk: string) => {
        if (!chunk) return;
        appendRecentPty(chunk);
        const owners = listBusyThreadIds();
        const threadId =
          owners.length === 1
            ? owners[0]!
            : (primaryBusyThreadId() ?? activeThreadId);
        emitToRenderer({
          type: "pty",
          text: chunk,
          threadId,
        } as never);
      },
    });
    agentBundle = next;
    agentBootError = null;
    agentBooting = false;
    localGateway.markReady();
    emitToRenderer({
      type: "status",
      phase: "idle",
      detail: "agent ready",
    } as never);
    if (options?.disposePrevious && previous) {
      try {
        previous.sandbox.dispose();
      } catch {
        /* ignore */
      }
      try {
        await previous.closeMcp();
      } catch {
        /* ignore */
      }
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    agentBootError = message;
    agentBooting = false;
    localGateway.markError(message);
    emitToRenderer({
      type: "error",
      message: `Failed to boot agent engine: ${message}`,
    } as never);
    throw err;
  }
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
    backgroundColor: "#0a0a0b",
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
  registerAgentPreviewProtocol();

  const kanbanDeps = {
    getMainWindow: () => mainWindow,
    isAgentReady: () => Boolean(agentBundle) && !agentBootError,
    getProfileHome: () => profileHome || workspaceRoot,
    getArtifactHome: () => workspaceRoot,
    runWorkerTurn: async (opts: {
      boardSlug: string;
      taskId: string;
      profileId: string;
      prompt: string;
      tools: ReturnType<typeof createKanbanWorkerTools>;
      workspaceCwd: string;
      goalMode: boolean;
      goalMaxTurns: number;
      store: ReturnType<typeof openBoardStore>;
      projectId?: string | null;
      artifactDir?: string | null;
    }) => {
      const threadId = `kanban-${opts.boardSlug}-${opts.taskId}`;
      if (busyThreadIds.has(threadId)) {
        throw new Error(`Kanban worker already running for ${opts.taskId}`);
      }
      busyThreadIds.add(threadId);
      try {
        process.env.AGENT_KANBAN_TASK = opts.taskId;
        process.env.AGENT_KANBAN_BOARD = opts.boardSlug;
        if (opts.projectId) {
          process.env.AGENT_KANBAN_PROJECT = opts.projectId;
        }
        const model = createRouterModel();
        // Confine FS tools to the project (or scratch) cwd. Artifact dir is
        // mentioned in the prompt; keep virtual root at workspaceCwd.
        const backend = new FilesystemBackend({
          rootDir: opts.workspaceCwd,
          virtualMode: true,
        });
        const scopeHint = opts.projectId
          ? ` You are bound to project ${opts.projectId}. Stay inside ${opts.workspaceCwd}${opts.artifactDir ? ` (artifacts: ${opts.artifactDir})` : ""}.`
          : "";
        const worker = await Promise.resolve(
          createDeepAgent({
            model,
            systemPrompt:
              "You are a Kanban worker. Use kanban_* tools to read and close out your assigned task. Prefer concrete evidence in summaries." +
              scopeHint,
            backend,
            tools: opts.tools as never[],
            name: `kanban-worker-${opts.taskId}`,
          }),
        );
        const { runAgentTurn } = await import("../cli/run-agent.js");
        await runAgentTurn({
          agent: worker as never,
          prompt: opts.prompt,
          threadId,
          autoApprove: true,
          onEvent: (event: AgentUiEvent) => {
            emitToRenderer({ ...event, threadId } as never);
          },
          memory: agentBundle
            ? {
                sessionStore: agentBundle.sessionStore,
                memoryStore: agentBundle.memoryStore,
                embedder: agentBundle.embedder,
                model: createRouterModel(),
                workspaceRoot: opts.workspaceCwd,
                enableReflection: false,
              }
            : undefined,
        });
      } finally {
        delete process.env.AGENT_KANBAN_TASK;
        delete process.env.AGENT_KANBAN_BOARD;
        delete process.env.AGENT_KANBAN_PROJECT;
        busyThreadIds.delete(threadId);
      }
    },
  };
  registerKanbanIpc(kanbanDeps);
  startKanbanDispatcher(kanbanDeps);
  startCronScheduler(kanbanDeps);
  workspaceRoot = path.resolve(__dirname, "../../");
  const migrated = migrateWorkspaceAgentToProfiles(workspaceRoot);
  profileId = migrated.profileId;
  profileHome = migrated.home;
  ensureSettingsFile(profileHome);
  applySettingsEnvToProcess(profileHome);
  initializeBots(profileHome);
  // Every app launch starts detached: sticky project must not leak into
  // Files / terminal / general sessions across restarts.
  setActiveProject(agentStateRoot(), null);
  activeProjectId = null;

  ipcMain.handle("agent:getSettings", async () => {
    const folders = agentBundle?.sandbox.getAllowedRoots() ?? [workspaceRoot];
    return buildSettingsSnapshot(settingsCtx(), folders);
  });

  ipcMain.handle("agent:selfHealStatus", async () => selfHeal.getStatus());

  ipcMain.handle(
    "agent:selfHeal",
    async (_event, payload?: { note?: string; threadId?: string }) => {
      return runSelfHealTurn({
        trigger: "manual",
        note: payload?.note,
        threadId: payload?.threadId || activeThreadId,
      });
    },
  );

  ipcMain.handle(
    "agent:updateSettings",
    async (_event, payload: SettingsUpdatePayload) => {
      try {
        const { snapshot, needsReload } = applySettingsUpdate(
          settingsCtx(),
          payload ?? {},
        );
        // Live-update Run Mode without full agent reboot.
        if (agentBundle && snapshot.agent) {
          const mode = snapshot.agent.runMode;
          if (
            mode === "auto-review" ||
            mode === "allowlist" ||
            mode === "run-everything"
          ) {
            agentBundle.runMode.setRunMode(mode);
          }
          agentBundle.runMode.setAllowlist(snapshot.agent.toolAllowlist ?? []);
        }
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
          snapshot: buildSettingsSnapshot(settingsCtx(), folders),
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
    const bots = getBots(agentStateRoot());
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
          content: "WHEN generating files/scripts -> DO place all output inside tmp/ folder",
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
    agentBooting,
    error: agentBootError,
    model: process.env.AGENT_MODEL ?? "unknown",
    workspaceRoot: effectiveWorkspaceRoot(),
    defaultWorkspaceRoot: workspaceRoot,
    profileId,
    profileHome: agentStateRoot(),
    activeProjectId,
    projectFolders: effectiveAllowedFolders() ?? null,
    privacyMode: agentBundle?.sandbox.isPrivacyStrict()
      ? true
      : loadPrivacyMode(agentStateRoot()),
    allowedRoots: agentBundle?.sandbox.getAllowedRoots() ?? null,
    gateway: localGateway.getStatus(),
    busy: busyThreadIds.size > 0,
    busyThreadIds: listBusyThreadIds(),
    busyThreadId: primaryBusyThreadId(),
    activeThreadId,
    activeBotId,
  }));

  ipcMain.handle(
    "agent:setPrivacyMode",
    async (_event, payload?: { enabled?: boolean } | boolean) => {
      const enabled =
        typeof payload === "boolean"
          ? payload
          : Boolean(payload && typeof payload === "object" && payload.enabled);
      try {
        savePrivacyMode(agentStateRoot(), enabled);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      if (!agentBundle?.sandbox) {
        return {
          ok: true,
          privacyMode: enabled,
          deferred: true,
          detail: "Saved; applies when agent engine is ready.",
        };
      }
      const result = agentBundle.sandbox.setPrivacyMode(enabled);
      emitToRenderer({
        type: "status",
        phase: "idle",
        detail: enabled
          ? "Privacy ON — project confinement"
          : "Privacy OFF — full machine access",
      } as never);
      return {
        ok: true,
        privacyMode: result.privacyStrict,
        allowedRoots: result.allowedRoots,
      };
    },
  );

  ipcMain.handle("agent:getGitSummary", async () => {
    const { getWorkspaceGitSummary } = await import("./workspace-git.js");
    return getWorkspaceGitSummary(effectiveWorkspaceRoot());
  });

  ipcMain.handle(
    "agent:searchMentionPaths",
    async (_event, payload?: { query?: string }) => {
      const q = String(payload?.query ?? "").trim().toLowerCase();
      const root = effectiveWorkspaceRoot();
      const items: Array<{
        id: string;
        label: string;
        insert: string;
        kind: "file" | "folder";
        detail?: string;
      }> = [];
      try {
        const { execFileSync } = await import("node:child_process");
        // Prefer git ls-files for speed; fall back to shallow readdir.
        let files: string[] = [];
        try {
          const out = execFileSync(
            "git",
            ["ls-files", "--cached", "--others", "--exclude-standard"],
            {
              cwd: root,
              encoding: "utf8",
              maxBuffer: 4_000_000,
              timeout: 4_000,
            },
          );
          files = out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          files = fs
            .readdirSync(root)
            .filter((n) => !n.startsWith("."))
            .slice(0, 200);
        }
        for (const rel of files) {
          if (q && !rel.toLowerCase().includes(q)) continue;
          const abs = path.join(root, rel);
          let isDir = rel.endsWith("/");
          try {
            isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
          } catch {
            /* ignore */
          }
          items.push({
            id: `path:${rel}`,
            label: isDir ? `@folder:${rel}` : `@file:${rel}`,
            insert: isDir ? `@folder:${rel}` : `@file:${rel}`,
            kind: isDir ? "folder" : "file",
            detail: rel,
          });
          if (items.length >= 8) break;
        }
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          items: [],
        };
      }
      return { ok: true, items };
    },
  );

  ipcMain.handle("agent:getPermissions", async () => {
    const {
      loadMergedPermissions,
      permissionsPaths,
    } = await import("../agent/permissions-store.js");
    const root = effectiveWorkspaceRoot();
    const profile = agentStateRoot();
    const merged = loadMergedPermissions({
      workspaceRoot: root,
      profileHome: profile,
    });
    const paths = permissionsPaths({
      workspaceRoot: root,
      profileHome: profile,
    });
    let projectRaw = null;
    try {
      if (fs.existsSync(paths.project)) {
        projectRaw = JSON.parse(fs.readFileSync(paths.project, "utf8"));
      }
    } catch {
      projectRaw = null;
    }
    let teamRaw = null;
    try {
      if (fs.existsSync(paths.team)) {
        teamRaw = JSON.parse(fs.readFileSync(paths.team, "utf8"));
      }
    } catch {
      teamRaw = null;
    }
    return {
      ok: true,
      merged,
      paths,
      project: projectRaw,
      team: teamRaw,
    };
  });

  ipcMain.handle(
    "agent:updatePermissions",
    async (
      _event,
      payload?: {
        scope?: "project" | "team";
        data?: Record<string, unknown> | null;
      },
    ) => {
      const {
        writeProjectPermissions,
        writeTeamPermissions,
        loadMergedPermissions,
      } = await import("../agent/permissions-store.js");
      const root = effectiveWorkspaceRoot();
      const scope = payload?.scope === "team" ? "team" : "project";
      if (scope === "team") {
        writeTeamPermissions(
          root,
          payload?.data === null
            ? null
            : ((payload?.data as never) ?? null),
        );
      } else if (payload?.data && typeof payload.data === "object") {
        writeProjectPermissions(root, payload.data as never);
      }
      // Refresh allowlist on live agent
      if (agentBundle) {
        const merged = loadMergedPermissions({
          workspaceRoot: root,
          profileHome: agentStateRoot(),
        });
        const settingsAllow =
          loadStoredSettings(agentStateRoot()).agent.toolAllowlist ?? [];
        agentBundle.runMode.setAllowlist([
          ...settingsAllow,
          ...merged.terminalAllowlist,
        ]);
      }
      return { ok: true };
    },
  );

  ipcMain.handle("agent:listGitBranches", async () => {
    const { listWorkspaceBranches } = await import("./workspace-git.js");
    return listWorkspaceBranches(effectiveWorkspaceRoot());
  });

  ipcMain.handle(
    "agent:checkoutGitBranch",
    async (_event, payload?: { branch?: string }) => {
      const { checkoutWorkspaceBranch } = await import("./workspace-git.js");
      return checkoutWorkspaceBranch(
        effectiveWorkspaceRoot(),
        String(payload?.branch || ""),
      );
    },
  );

  ipcMain.handle("agent:listProcesses", async () => {
    const { listManagedProcesses } = await import("../agent/process-manage.js");
    return { processes: listManagedProcesses() };
  });

  terminalService.setHandlers({
    onData: emitTerminalData,
    onExit: emitTerminalExit,
  });

  ipcMain.handle(
    "terminal:create",
    async (
      _event,
      opts?: { cols?: number; rows?: number; cwd?: string; shell?: string },
    ) => {
      try {
        const session = terminalService.create({
          cols: opts?.cols,
          rows: opts?.rows,
          cwd: opts?.cwd || effectiveWorkspaceRoot() || process.cwd(),
          shell: opts?.shell,
        });
        return { ok: true, session };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "terminal:write",
    async (_event, payload?: { id?: string; data?: string }) => {
      const id = String(payload?.id || "").trim();
      if (!id) return { ok: false, error: "id required" };
      return terminalService.write(id, String(payload?.data ?? ""));
    },
  );

  ipcMain.handle(
    "terminal:resize",
    async (
      _event,
      payload?: { id?: string; cols?: number; rows?: number },
    ) => {
      const id = String(payload?.id || "").trim();
      if (!id) return { ok: false, error: "id required" };
      return terminalService.resize(
        id,
        Number(payload?.cols) || 80,
        Number(payload?.rows) || 24,
      );
    },
  );

  ipcMain.handle("terminal:kill", async (_event, id?: string) => {
    const sessionId = String(id || "").trim();
    if (!sessionId) return { ok: false, error: "id required" };
    return terminalService.kill(sessionId);
  });

  ipcMain.handle("terminal:list", async () => ({
    sessions: terminalService.list(),
  }));

  ipcMain.handle("agent:listCapabilities", async () => {
    const { listCapabilities } = await import("../agent/capabilities-catalog.js");
    return listCapabilities({
      workspaceRoot: agentStateRoot(),
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
      setCapabilityEnabled(agentStateRoot(), id, Boolean(payload.enabled));
      const reload = await reloadAgentForCapabilities();
      return {
        ok: true,
        reloaded: reload.reloaded,
        reloadReason: reload.reason,
        ...listCapabilities({
          workspaceRoot: agentStateRoot(),
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
      const { readWorkspacePreviewMulti } = await import("./workspace-preview.js");
      const filePath = String(payload?.path || "").trim();
      if (!filePath) return { ok: false, error: "path required" };
      const roots = deliverySearchRoots();
      return readWorkspacePreviewMulti(roots, filePath);
    },
  );

  ipcMain.handle(
    "agent:listWorkspaceDir",
    async (_event, payload: { path?: string } = {}) => {
      const { listWorkspaceDirMulti } = await import("./workspace-preview.js");
      const roots = deliverySearchRoots();
      return listWorkspaceDirMulti(roots, String(payload?.path || ""));
    },
  );

  ipcMain.handle("agent:listWorkspaceChanges", async () => {
    const { listWorkspaceChanges } = await import("./workspace-git.js");
    return listWorkspaceChanges(effectiveWorkspaceRoot());
  });

  ipcMain.handle(
    "agent:discoverDeliverables",
    async (
      _event,
      payload: { texts?: string[]; command?: string; maxAgeMs?: number },
    ) => {
      const { discoverDeliverables } = await import("./workspace-preview.js");
      return discoverDeliverables(effectiveWorkspaceRoot(), {
        texts: Array.isArray(payload?.texts)
          ? payload.texts.map(String)
          : [],
        command: payload?.command ? String(payload.command) : undefined,
        maxAgeMs: payload?.maxAgeMs,
      });
    },
  );

  ipcMain.handle(
    "agent:exportWorkspaceFile",
    async (event, payload: { path?: string }) => {
      const { resolveExistingWorkspaceFile } = await import(
        "./file-delivery.js"
      );
      const filePath = String(payload?.path || "").trim();
      if (!filePath) return { ok: false, error: "path required" };
      const roots = deliverySearchRoots();
      const resolved = resolveExistingWorkspaceFile(roots, filePath);
      if (!resolved.ok) return resolved;
      const opts = {
        title: "Save file as",
        defaultPath: resolved.basename,
      };
      const parent = dialogParent(event);
      const result = parent
        ? await dialog.showSaveDialog(parent, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) {
        return { ok: false, error: "canceled" };
      }
      try {
        fs.copyFileSync(resolved.abs, result.filePath);
        return { ok: true, savedAs: result.filePath };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle(
    "agent:revealWorkspaceFile",
    async (_event, payload: { path?: string }) => {
      const { resolveExistingWorkspaceFile } = await import(
        "./file-delivery.js"
      );
      const filePath = String(payload?.path || "").trim();
      if (!filePath) return { ok: false, error: "path required" };
      const roots = deliverySearchRoots();
      const resolved = resolveExistingWorkspaceFile(roots, filePath);
      if (!resolved.ok) return resolved;
      shell.showItemInFolder(resolved.abs);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "agent:openWorkspaceFile",
    async (_event, payload: { path?: string }) => {
      const { resolveExistingWorkspaceFile } = await import(
        "./file-delivery.js"
      );
      const filePath = String(payload?.path || "").trim();
      if (!filePath) return { ok: false, error: "path required" };
      const roots = deliverySearchRoots();
      const resolved = resolveExistingWorkspaceFile(roots, filePath);
      if (!resolved.ok) return resolved;
      const err = await shell.openPath(resolved.abs);
      return err ? { ok: false, error: err } : { ok: true };
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
      !isWorkspaceThreadId(activeThreadId) &&
      !sessions.some((s) => s.threadId === activeThreadId)
    ) {
      sessions.unshift({
        threadId: activeThreadId,
        updatedAt: new Date().toISOString(),
        preview: "(current session)",
        turnCount: 0,
        projectId: activeProjectId,
        workspaceId: null,
        chatId: null,
      });
    }
    return {
      activeThreadId,
      activeBotId,
      activeProjectId,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
      sessions,
    };
  });

  ipcMain.handle(
    "agent:newSession",
    async (
      _event,
      payload?: { projectId?: string | null },
    ) => {
    // Allow creating/viewing another session while a turn runs in the background.
    if (busyThreadIds.size > 0) {
      selectBotWithoutScopeMutation("general");
    } else {
      applyBotScope("general");
    }

    const wantProject = resolveNewSessionProjectId(
      payload && "projectId" in payload ? payload.projectId : null,
    );

    if (wantProject === null && activeProjectId) {
      // Soft-clear sticky project so "New session" is not "in appgw".
      await activateProjectAndReboot(null, { preserveThreadId: null });
    } else if (wantProject && wantProject !== activeProjectId) {
      const switched = await activateProjectAndReboot(wantProject, {
        preserveThreadId: null,
      });
      if (!switched.ok) {
        // Soft-allow folders if busy; still tag the new session to the project.
        softAllowProjectFolders(agentBundle, agentStateRoot(), wantProject);
      }
    }

    activeThreadId = `desktop-${Date.now()}`;
    lastGeneralThreadId = activeThreadId;
    agentBundle?.sessionStore.writeSessionMeta(activeThreadId, {
      projectId: wantProject,
    });
    return {
      ok: true,
      threadId: activeThreadId,
      activeBotId,
      ...sessionWorkspaceFields({
        workspaceRoot: effectiveWorkspaceRoot(),
        projectFolders: effectiveAllowedFolders() ?? null,
        activeProjectId: wantProject,
        projectId: wantProject,
      }),
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
    };
  },
  );

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

    const meta = agentBundle?.sessionStore.readSessionMeta(id) ?? {
      projectId: null,
    };
    const sessionProjectId = meta.projectId ?? null;

    // Opening a general session must clear sticky project UI/sandbox flag.
    if (!isBotThreadId(id) && !sessionProjectId && activeProjectId) {
      await activateProjectAndReboot(null, { preserveThreadId: id });
    } else if (
      !isBotThreadId(id) &&
      sessionProjectId &&
      sessionProjectId !== activeProjectId
    ) {
      const switched = await activateProjectAndReboot(sessionProjectId, {
        preserveThreadId: id,
      });
      if (!switched.ok) {
        softAllowProjectFolders(
          agentBundle,
          agentStateRoot(),
          sessionProjectId,
        );
      }
    }
    // Ensure prompts still target the opened session (reboot must not steal focus).
    activeThreadId = id;
    if (!isBotThreadId(id)) lastGeneralThreadId = id;

    const events = agentBundle?.sessionStore.readTranscript(id, 800) ?? [];
    return {
      ok: true,
      threadId: id,
      activeBotId,
      events,
      ...sessionWorkspaceFields({
        workspaceRoot: effectiveWorkspaceRoot(),
        projectFolders: effectiveAllowedFolders() ?? null,
        // Session meta is the UI source of truth (not sticky registry while soft-aligned).
        activeProjectId: sessionProjectId,
        projectId: sessionProjectId,
      }),
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
      busy: busyThreadIds.has(id),
    };
  });

  ipcMain.handle("agent:clearSession", async (_event, threadId: string) => {
    const id = String(threadId || "").trim();
    if (!id) return { ok: false, error: "threadId required" };
    if (!agentBundle?.sessionStore) return { ok: false, error: "Agent not ready" };
    agentBundle.sessionStore.clearTranscript(id);
    const events =
      activeThreadId === id
        ? agentBundle.sessionStore.readTranscript(id, 800)
        : undefined;
    return {
      ok: true,
      threadId: id,
      events,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
    };
  });

  ipcMain.handle("agent:deleteSession", async (_event, threadId: string) => {
    const id = String(threadId || "").trim();
    if (!id) return { ok: false, error: "threadId required" };
    if (!agentBundle?.sessionStore) return { ok: false, error: "Agent not ready" };
    if (isBotThreadId(id)) {
      return { ok: false, error: "Bot sessions cannot be deleted here" };
    }
    const wasActive = activeThreadId === id;
    agentBundle.sessionStore.deleteSession(id);
    let nextThreadId = activeThreadId;
    if (wasActive) {
      const remaining = listGeneralSessions();
      if (remaining[0]?.threadId) {
        nextThreadId = remaining[0].threadId;
        activeThreadId = nextThreadId;
        lastGeneralThreadId = nextThreadId;
      } else {
        activeThreadId = `desktop-${Date.now()}`;
        lastGeneralThreadId = activeThreadId;
        nextThreadId = activeThreadId;
        agentBundle.sessionStore.writeSessionMeta(activeThreadId, {
          projectId: activeProjectId,
        });
      }
    }
    const events =
      agentBundle.sessionStore.readTranscript(nextThreadId, 800) ?? [];
    return {
      ok: true,
      threadId: id,
      activeThreadId: nextThreadId,
      events: wasActive ? events : undefined,
      switched: wasActive,
      busyThreadIds: listBusyThreadIds(),
      busyThreadId: primaryBusyThreadId(),
    };
  });

  ipcMain.handle(
    "agent:moveSessionToProject",
    async (
      _event,
      payload: { threadId?: string; projectId?: string | null },
    ) => {
      const id = String(payload?.threadId || "").trim();
      if (!id) return { ok: false, error: "threadId required" };
      if (!agentBundle?.sessionStore) {
        return { ok: false, error: "Agent not ready" };
      }
      if (isBotThreadId(id)) {
        return { ok: false, error: "Bot sessions cannot be moved" };
      }
      const projectId =
        payload?.projectId == null || payload.projectId === ""
          ? null
          : String(payload.projectId);
      agentBundle.sessionStore.setSessionProject(id, projectId);
      return {
        ok: true,
        threadId: id,
        projectId,
        busyThreadIds: listBusyThreadIds(),
        busyThreadId: primaryBusyThreadId(),
      };
    },
  );

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

  ipcMain.handle("messaging:getConfig", async () => {
    const bridge = ensureWhatsAppBridge();
    const config = bridge.reloadConfig();
    return {
      ok: true,
      config,
      whatsapp: bridge.getStatus(),
    };
  });

  ipcMain.handle(
    "messaging:saveConfig",
    async (_event, payload: Partial<MessagingConfig> | MessagingConfig) => {
      try {
        const current = loadMessagingConfig(agentStateRoot());
        const next = saveMessagingConfig(agentStateRoot(), {
          version: 1,
          whatsapp: {
            ...current.whatsapp,
            ...(payload && typeof payload === "object" && "whatsapp" in payload
              ? (payload as MessagingConfig).whatsapp
              : {}),
          },
        });
        const bridge = ensureWhatsAppBridge();
        bridge.reloadConfig();
        if (next.whatsapp.enabled && bridge.getStatus().status === "disconnected") {
          // Don't auto-start on save — user presses Start; only refresh status.
        }
        if (!next.whatsapp.enabled) {
          await bridge.stop();
        }
        return { ok: true, config: next, whatsapp: bridge.getStatus() };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  ipcMain.handle("messaging:whatsappStatus", async () => {
    const bridge = ensureWhatsAppBridge();
    return { ok: true, whatsapp: bridge.getStatus() };
  });

  ipcMain.handle("messaging:whatsappStart", async () => {
    const bridge = ensureWhatsAppBridge();
    bridge.reloadConfig();
    return bridge.start();
  });

  ipcMain.handle("messaging:whatsappStop", async () => {
    const bridge = ensureWhatsAppBridge();
    return bridge.stop();
  });

  ipcMain.handle("messaging:whatsappLogout", async () => {
    const bridge = ensureWhatsAppBridge();
    return bridge.logout();
  });

  async function activateProjectAndReboot(
    projectId: string | null,
    opts?: { force?: boolean; preserveThreadId?: string | null },
  ) {
    const target =
      projectId === null || projectId === undefined || projectId === ""
        ? null
        : String(projectId).trim() || null;

    // Already on this project — do not dispose terminals / reboot agent / mint a
    // new desktop thread (that felt like the chat room "refreshing" on a loop).
    if (activeProjectId === target && agentBundle) {
      return {
        ok: true as const,
        registry: loadProjectRegistry(agentStateRoot()),
        project: getActiveProject(agentStateRoot()),
        activeProjectId,
        threadId: activeThreadId,
        workspaceRoot: effectiveWorkspaceRoot(),
        projectFolders: effectiveAllowedFolders() ?? null,
        projects: listProjectSummaries(agentStateRoot()),
        reused: true as const,
      };
    }

    if (busyThreadIds.size > 0) {
      if (!opts?.force) {
        // Leaving a project for general sessions must not wait on background turns.
        // Soft-detach: clear active project; dispose user terminals so cwd resets.
        // Keep agent sandbox alive for in-flight turns.
        if (target === null) {
          const result = setActiveProject(agentStateRoot(), null);
          if (!result.ok) return result;
          activeProjectId = null;
          terminalService.disposeAll();
          return {
            ok: true as const,
            registry: result.registry,
            project: null,
            activeProjectId: null,
            threadId: activeThreadId,
            workspaceRoot: effectiveWorkspaceRoot(),
            projectFolders: effectiveAllowedFolders() ?? null,
            projects: listProjectSummaries(agentStateRoot()),
            softDetached: true as const,
          };
        }
        const busy = listBusyThreadIds();
        return {
          ok: false as const,
          error:
            "Finish or wait for running turns before switching projects." +
            (busy.length ? `\nBusy: ${busy.join(", ")}` : ""),
          busyThreadIds: busy,
        };
      }
      // Force-switch: drop HITL waiters and clear the busy set so reboot can proceed.
      for (const tid of [...busyThreadIds]) {
        const pending = pendingApprovals.get(tid);
        if (pending) {
          pendingApprovals.delete(tid);
          try {
            pending({ decisions: [{ type: "reject" }] });
          } catch {
            /* ignore */
          }
        }
        busyThreadIds.delete(tid);
      }
    }
    const result = setActiveProject(agentStateRoot(), target);
    if (!result.ok) return result;
    activeProjectId = result.registry.activeProjectId;
    terminalService.disposeAll();
    await bootAgentEngine({ disposePrevious: true });
    // preserveThreadId: keep opened session (openSession) or defer mint (newSession).
    if (typeof opts?.preserveThreadId === "string" && opts.preserveThreadId) {
      activeThreadId = opts.preserveThreadId;
      lastGeneralThreadId = activeThreadId;
    } else if (opts?.preserveThreadId === null) {
      // Caller will mint / set the thread — do not orphan an empty session here.
    } else {
      activeThreadId = `desktop-${Date.now()}`;
      lastGeneralThreadId = activeThreadId;
      agentBundle?.sessionStore.writeSessionMeta(activeThreadId, {
        projectId: activeProjectId,
      });
    }
    applyBotScope("general");
    return {
      ok: true as const,
      registry: result.registry,
      project: result.project,
      activeProjectId,
      threadId: activeThreadId,
      workspaceRoot: effectiveWorkspaceRoot(),
      projectFolders: effectiveAllowedFolders() ?? null,
      projects: listProjectSummaries(agentStateRoot()),
    };
  }

  registerWorkspaceIpc({
    agentStateRoot,
    getBundle: () => agentBundle,
    emitToRenderer,
    listBusyThreadIds,
    markThreadBusy: (id) => {
      busyThreadIds.add(id);
    },
    markThreadIdle: (id) => {
      busyThreadIds.delete(id);
    },
    activateProjectAndReboot,
    softAllowProjectFolders: (projectId) =>
      softAllowProjectFolders(agentBundle, agentStateRoot(), projectId),
    getActiveThreadId: () => activeThreadId,
    setActiveThreadId: (id) => {
      activeThreadId = id;
    },
    loadStoredAutoApprove: () =>
      loadStoredSettings(agentStateRoot()).agent.autoApproveDestructive,
    requestApproval: (threadId) =>
      new Promise((resolve) => {
        pendingApprovals.set(threadId, resolve);
      }),
    clearPendingApproval: (threadId) => {
      const pending = pendingApprovals.get(threadId);
      if (pending) {
        pendingApprovals.delete(threadId);
        pending({ decisions: [{ type: "reject" }] });
      }
    },
    restoreBotScope: () => {
      applyBotScope(activeBotId);
    },
    getGlobalActiveProjectId: () => activeProjectId,
  });

  ipcMain.handle("workspaces:openWindow", async () => openWorkspacesWindow());

  ipcMain.handle("projects:list", async () => {
    syncActiveProjectFromDisk();
    return {
      ok: true,
      activeProjectId,
      projects: listProjectSummaries(agentStateRoot()),
      registry: loadProjectRegistry(agentStateRoot()),
    };
  });

  ipcMain.handle(
    "projects:create",
    async (
      _event,
      payload?: {
        name?: string;
        folders?: string[];
        idea?: string;
        activate?: boolean;
      },
    ) => {
      const created = createProject(agentStateRoot(), {
        name: String(payload?.name || ""),
        folders: Array.isArray(payload?.folders) ? payload!.folders.map(String) : [],
        idea: payload?.idea,
        activate: payload?.activate !== false,
      });
      if (!created.ok) return created;
      if (payload?.activate === false) {
        return {
          ok: true,
          project: created.project,
          projects: listProjectSummaries(agentStateRoot()),
          activeProjectId,
        };
      }
      const switched = await activateProjectAndReboot(created.project.id);
      if (!switched.ok) {
        return {
          ok: true,
          project: created.project,
          projects: listProjectSummaries(agentStateRoot()),
          activeProjectId,
          warning: switched.error,
        };
      }
      return {
        ...switched,
        project: created.project,
      };
    },
  );

  ipcMain.handle(
    "projects:update",
    async (
      _event,
      payload?: { id?: string; name?: string; folders?: string[]; idea?: string },
    ) => {
      const id = String(payload?.id || "").trim();
      if (!id) return { ok: false, error: "id required" };
      const updated = updateProject(agentStateRoot(), id, {
        name: payload?.name,
        folders: payload?.folders,
        idea: payload?.idea,
      });
      if (!updated.ok) return updated;
      if (activeProjectId === id) {
        if (busyThreadIds.size > 0) {
          return {
            ok: true,
            project: updated.project,
            projects: listProjectSummaries(agentStateRoot()),
            warning: "Project updated; reboot after current turns finish.",
          };
        }
        terminalService.disposeAll();
        await bootAgentEngine({ disposePrevious: true });
      }
      return {
        ok: true,
        project: updated.project,
        projects: listProjectSummaries(agentStateRoot()),
        activeProjectId,
        workspaceRoot: effectiveWorkspaceRoot(),
      };
    },
  );

  ipcMain.handle("projects:delete", async (_event, id?: string) => {
    const target = String(id || "").trim();
    if (!target) return { ok: false, error: "id required" };
    const wasActive = activeProjectId === target;
    const deleted = deleteProject(agentStateRoot(), target);
    if (!deleted.ok) return deleted;
    if (wasActive) {
      const switched = await activateProjectAndReboot(null);
      if (!switched.ok) {
        activeProjectId = null;
        return {
          ok: true,
          projects: listProjectSummaries(agentStateRoot()),
          activeProjectId: null,
          warning: switched.error,
        };
      }
      return switched;
    }
    return {
      ok: true,
      projects: listProjectSummaries(agentStateRoot()),
      activeProjectId,
    };
  });

  ipcMain.handle(
    "projects:setActive",
    async (
      _event,
      idOrPayload?:
        | string
        | null
        | { id?: string | null; force?: boolean },
      maybeOpts?: { force?: boolean },
    ) => {
      let raw: string | null | undefined;
      let force = false;
      if (
        idOrPayload &&
        typeof idOrPayload === "object" &&
        !Array.isArray(idOrPayload)
      ) {
        raw = idOrPayload.id;
        force = Boolean(idOrPayload.force);
      } else {
        raw = idOrPayload as string | null | undefined;
        force = Boolean(maybeOpts?.force);
      }
      const target =
        raw === null || raw === undefined || raw === ""
          ? null
          : String(raw).trim();
      return activateProjectAndReboot(target, { force });
    },
  );

  ipcMain.handle("projects:pickFolder", async (event) => {
    const opts = {
      properties: ["openDirectory", "createDirectory"] as Array<
        "openDirectory" | "createDirectory"
      >,
      title: "Add project folder",
    };
    const parent = dialogParent(event);
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, cancelled: true };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("profiles:list", async () => {
    const registry = loadRegistry();
    return {
      ok: true,
      registry,
      profiles: listProfileSummaries(),
      activeProfileId: profileId,
    };
  });

  ipcMain.handle("profiles:get", async (_event, id?: string) => {
    const target = String(id || profileId || "default").trim();
    try {
      const summary = summarizeProfile(target);
      const soul = readSoul(summary.home);
      return { ok: true, profile: summary, soul };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(
    "profiles:create",
    async (
      _event,
      payload?: { id?: string; cloneFrom?: string; soul?: string; name?: string },
    ) => {
      try {
        const created = createProfile({
          id: String(payload?.id || "").trim(),
          cloneFrom: payload?.cloneFrom,
          soul: payload?.soul,
          name: payload?.name,
        });
        return { ok: true, profile: created, profiles: listProfileSummaries() };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    "profiles:updateSoul",
    async (_event, payload?: { id?: string; soul?: string }) => {
      try {
        const target = String(payload?.id || profileId || "default").trim();
        const summary = summarizeProfile(target);
        writeSoul(summary.home, String(payload?.soul ?? ""));
        const needsReload = target === profileId && busyThreadIds.size === 0;
        let reloaded = false;
        if (needsReload) {
          const reload = await reloadAgentForCapabilities();
          reloaded = reload.reloaded;
        }
        return {
          ok: true,
          profile: summarizeProfile(target),
          soul: readSoul(summary.home),
          reloaded,
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle("profiles:setDefault", async (_event, id?: string) => {
    try {
      const registry = setDefaultProfile(String(id || "").trim());
      return { ok: true, registry, profiles: listProfileSummaries() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("profiles:switch", async (_event, id?: string) => {
    const target = String(id || "").trim();
    if (!target) return { ok: false, error: "profile id required" };
    if (busyThreadIds.size > 0) {
      return {
        ok: false,
        error: "Finish or wait for running turns before switching profiles.",
      };
    }
    const previousId = profileId;
    const previousHome = profileHome;
    try {
      if (!isValidProfileId(target)) {
        return { ok: false, error: "Invalid profile id" };
      }
      const listed = loadRegistry().profiles.some((p) => p.id === target);
      if (!listed) {
        return { ok: false, error: `Unknown profile: ${target}` };
      }
      const nextHome = ensureProfileHome(target);
      // Boot against the target home before persisting registry / mutating globals.
      profileId = target;
      profileHome = nextHome;
      ensureSettingsFile(profileHome);
      applySettingsEnvToProcess(profileHome);
      initializeBots(profileHome);
      terminalService.disposeAll();
      await bootAgentEngine({ disposePrevious: true });
      setActiveProfile(target);
      if (whatsappBridge) {
        await whatsappBridge.stop();
        whatsappBridge = null;
      }
      activeBotId = "general";
      activeThreadId = `desktop-${Date.now()}`;
      lastGeneralThreadId = activeThreadId;
      const newestGeneral = listGeneralSessions()[0];
      if (newestGeneral) {
        lastGeneralThreadId = newestGeneral.threadId;
        activeThreadId = newestGeneral.threadId;
      }
      applyBotScope(activeBotId);
      return {
        ok: true,
        profileId,
        profileHome,
        threadId: activeThreadId,
        activeBotId,
        profiles: listProfileSummaries(),
        gateway: localGateway.getStatus(),
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      profileId = previousId;
      profileHome = previousHome;
      try {
        applySettingsEnvToProcess(agentStateRoot());
        if (previousId) setActiveProfile(previousId);
        await bootAgentEngine({ disposePrevious: true });
      } catch (rollbackErr) {
        localGateway.markError(
          `${error}; rollback also failed: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }`,
        );
      }
      localGateway.markError(error);
      return { ok: false, error };
    }
  });

  ipcMain.handle("gateway:getStatus", async () => localGateway.getStatus());

  ipcMain.handle("gateway:testLocal", async () => localGateway.test());

  ipcMain.handle(
    "gateway:setMode",
    async (_event, payload?: { mode?: GatewayMode }) => {
      const mode = payload?.mode ?? "local";
      if (mode !== "local") {
        return {
          ok: false,
          error:
            "Only the local gateway is supported in this build. Cloud, remote, and SSH are placeholders.",
          registry: loadRegistry(),
          status: localGateway.getStatus(),
        };
      }
      const registry = setGatewayMode("local");
      return { ok: true, registry, status: localGateway.getStatus() };
    },
  );

  ipcMain.handle("gateway:openLogs", async () => {
    const logPath = profileDesktopLogPath(agentStateRoot());
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, "", "utf8");
      }
      const { shell } = await import("electron");
      await shell.showItemInFolder(logPath);
      return { ok: true, path: logPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const attachmentPreviewDataUrl = (
    absPath: string,
    mime: string,
    kind: "image" | "file",
  ): string | undefined => {
    if (kind !== "image") return undefined;
    try {
      const st = fs.statSync(absPath);
      if (st.size > 1_500_000) return undefined;
      const buf = fs.readFileSync(absPath);
      const safeMime = mime || "image/png";
      return `data:${safeMime};base64,${buf.toString("base64")}`;
    } catch {
      return undefined;
    }
  };

  const serializeImportedAttachment = (attachment: {
    relPath: string;
    absPath: string;
    basename: string;
    mime: string;
    size: number;
    kind: "image" | "file";
  }) => ({
    path: attachment.relPath,
    absPath: attachment.absPath,
    basename: attachment.basename,
    mime: attachment.mime,
    size: attachment.size,
    kind: attachment.kind,
    previewUrl: attachmentPreviewDataUrl(
      attachment.absPath,
      attachment.mime,
      attachment.kind,
    ),
  });

  const importPathsAsAttachments = async (
    filePaths: string[],
  ): Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    warnings?: string[];
    files: Array<ReturnType<typeof serializeImportedAttachment>>;
  }> => {
    const { importLocalAttachment } = await import("./inbound-attachments.js");
    const root = artifactHomeRoot();
    const scope = turnWorkingScope();
    const files: Array<ReturnType<typeof serializeImportedAttachment>> = [];
    const errors: string[] = [];
    for (const p of filePaths) {
      const imported = importLocalAttachment(
        root,
        p,
        "desktop",
        undefined,
        scope.uploadsRelDir,
      );
      if (!imported.ok) {
        errors.push(`${path.basename(p)}: ${imported.error}`);
        continue;
      }
      files.push(serializeImportedAttachment(imported.attachment));
    }
    if (!files.length) {
      return {
        ok: false,
        error: errors[0] || "Could not import files",
        files: [],
      };
    }
    return {
      ok: true,
      files,
      warnings: errors.length ? errors : undefined,
    };
  };

  ipcMain.handle(
    "agent:pickAttachments",
    async (
      event,
      options?: {
        imagesOnly?: boolean;
        directories?: boolean;
      },
    ) => {
      if (options?.directories) {
        const dirOpts = {
          properties: ["openDirectory"] as Array<"openDirectory">,
          title: "Attach folder",
        };
        const parent = dialogParent(event);
        const dirResult = parent
          ? await dialog.showOpenDialog(parent, dirOpts)
          : await dialog.showOpenDialog(dirOpts);
        if (dirResult.canceled || !dirResult.filePaths.length) {
          return { ok: false, cancelled: true, files: [] as never[] };
        }
        const folder = dirResult.filePaths[0]!;
        let entries: string[] = [];
        try {
          entries = fs
            .readdirSync(folder, { withFileTypes: true })
            .filter((d) => d.isFile())
            .map((d) => path.join(folder, d.name))
            .slice(0, 40);
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            files: [],
          };
        }
        if (!entries.length) {
          return { ok: false, error: "Folder has no files to attach", files: [] };
        }
        return importPathsAsAttachments(entries);
      }

      const opts = {
        properties: ["openFile", "multiSelections"] as Array<
          "openFile" | "multiSelections"
        >,
        title: options?.imagesOnly ? "Attach images" : "Attach files or images",
        filters: options?.imagesOnly
          ? [
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"],
              },
            ]
          : [
              { name: "All files", extensions: ["*"] },
              {
                name: "Images",
                extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"],
              },
              {
                name: "Documents",
                extensions: [
                  "pdf",
                  "doc",
                  "docx",
                  "xls",
                  "xlsx",
                  "csv",
                  "txt",
                  "md",
                  "json",
                  "html",
                  "zip",
                ],
              },
            ],
      };
      const parent = dialogParent(event);
      const result = parent
        ? await dialog.showOpenDialog(parent, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || !result.filePaths.length) {
        return { ok: false, cancelled: true, files: [] as never[] };
      }
      return importPathsAsAttachments(result.filePaths);
    },
  );

  ipcMain.handle(
    "agent:importAttachmentPaths",
    async (_event, payload?: { paths?: string[] }) => {
      const paths = Array.isArray(payload?.paths)
        ? payload!.paths!.map((p) => String(p || "").trim()).filter(Boolean)
        : [];
      if (!paths.length) {
        return { ok: false, error: "No paths", files: [] as never[] };
      }
      return importPathsAsAttachments(paths.slice(0, 40));
    },
  );

  ipcMain.handle(
    "agent:importAttachmentBuffer",
    async (
      _event,
      payload?: {
        base64?: string;
        fileName?: string;
        mime?: string;
        label?: string;
      },
    ) => {
      const base64 = String(payload?.base64 || "");
      const fileName = String(payload?.fileName || "attachment.bin").trim();
      const mime = payload?.mime ? String(payload.mime) : undefined;
      if (!base64) {
        return { ok: false, error: "Empty attachment", file: null };
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, "base64");
      } catch {
        return { ok: false, error: "Invalid attachment data", file: null };
      }
      const { saveAttachmentBuffer } = await import("./inbound-attachments.js");
      const scope = turnWorkingScope();
      const saved = saveAttachmentBuffer(artifactHomeRoot(), {
        buffer,
        fileName,
        mime,
        source: "desktop",
        uploadsRelDir: scope.uploadsRelDir,
      });
      if (!saved.ok) {
        return { ok: false, error: saved.error, file: null };
      }
      const file = {
        ...serializeImportedAttachment(saved.attachment),
        label: payload?.label ? String(payload.label) : undefined,
      };
      return { ok: true, file };
    },
  );

  ipcMain.handle(
    "agent:sendPrompt",
    async (
      _event,
      promptOrPayload:
        | string
        | {
            prompt?: string;
            attachments?: Array<{ path?: string; absPath?: string }>;
            chatMode?: string;
          },
    ) => {
    const payload =
      typeof promptOrPayload === "string"
        ? {
            prompt: promptOrPayload,
            attachments: [] as Array<{ path?: string; absPath?: string }>,
            chatMode: undefined as string | undefined,
          }
        : promptOrPayload || {};
    const prompt = String(payload.prompt ?? "").trim();
    const attachmentRefs = Array.isArray(payload.attachments)
      ? payload.attachments
      : [];
    const { parseAgentChatMode } = await import("../agent/chat-mode.js");
    const chatMode = parseAgentChatMode(payload.chatMode, "agent");

    if (!agentBundle) {
      const error = agentNotReadyMessage();
      emitToRenderer({ type: "error", message: error });
      return { ok: false, error };
    }
    const bundle = agentBundle;

    const {
      buildMultimodalUserContent,
      composePromptWithAttachments,
      resolveWorkspaceUploadAttachment,
    } = await import("./inbound-attachments.js");
    type InboundAttachment = import("./inbound-attachments.js").InboundAttachment;

    const attachments: InboundAttachment[] = [];
    for (const ref of attachmentRefs) {
      const resolved = resolveWorkspaceUploadAttachment(
        artifactHomeRoot(),
        ref,
      );
      if (resolved.ok) attachments.push(resolved.attachment);
    }

    if (!prompt && attachments.length === 0) {
      return { ok: false, error: "Empty prompt" };
    }

    const composedPrompt = await composePromptWithAttachments(
      prompt,
      attachments,
    );
    const userContent = await buildMultimodalUserContent(
      composedPrompt,
      attachments,
    );

    const healCmd = parseSelfHealCommand(composedPrompt);
    if (healCmd) {
      return runSelfHealTurn({
        trigger: "manual",
        note: healCmd.note,
        threadId: activeThreadId,
      });
    }

    const turnThreadId = activeThreadId;
    const turnBotId = activeBotId;
    const scope = turnWorkingScope({ threadId: turnThreadId, botId: turnBotId });
    const { nudge: workingScopeNudgeBase } = ensureTurnWorkingDirs(scope);
    const privacyOn = agentBundle?.sandbox.isPrivacyStrict()
      ? true
      : loadPrivacyMode(agentStateRoot());
    const workingScopeNudge = [
      workingScopeNudgeBase,
      privacyModeInstruction(privacyOn),
    ]
      .filter(Boolean)
      .join("\n\n");
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
    let autoHealQueued = false;
    let turnResult: {
      ok: boolean;
      content?: string;
      error?: string;
      threadId: string;
      activeBotId?: string;
      busyThreadIds?: string[];
    } = { ok: false, threadId: turnThreadId };
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
        const current = bundle.botScope.getAllowedTools();
        const same =
          wanted === null
            ? current === null
            : Array.isArray(current) &&
              wanted.length === current.length &&
              wanted.every((t) => current.includes(t));
        if (!same && wanted === null) {
          // Prefer unlocking tools when a general turn joins specialized ones.
          bundle.botScope.setAllowedTools(null);
        }
      }
      const specialized = isSpecializedBot(currentBot);
      const botInstruction = specialized
        ? buildBotScopeInstruction(currentBot)
        : undefined;

      const toolScope = {
        get: () => bundle.botScope.getAllowedTools(),
        set: (tools: string[] | null) =>
          bundle.botScope.setAllowedTools(tools),
      };

      const prefs = loadStoredSettings(agentStateRoot()).agent;
      // Keep live Run Mode in sync with settings (no full agent reboot).
      if (prefs.runMode) {
        bundle.runMode.setRunMode(prefs.runMode);
      }
      bundle.runMode.setAllowlist(prefs.toolAllowlist ?? []);

      // Plan mode starts locked until Build (task_todos Approve).
      if (chatMode === "plan") {
        bundle.planGate.lock();
      }

      const answer = await runAgentTurn({
        agent: bundle.agent,
        prompt: composedPrompt,
        userContent,
        botInstruction,
        workingScopeNudge,
        threadId: turnThreadId,
        projectId: isBotThreadId(turnThreadId)
          ? null
          : (bundle.sessionStore.readSessionMeta(turnThreadId).projectId ??
            null),
        autoApprove: prefs.autoApproveDestructive,
        chatMode,
        runMode: bundle.runMode,
        planGate: bundle.planGate,
        isPrivacyStrict: () => bundle.sandbox.isPrivacyStrict(),
        terminalLog: recentTerminalLog(),
        chatTranscript: (() => {
          try {
            const rows = bundle.sessionStore
              .readTranscript(turnThreadId, 16)
              .slice(-12);
            return rows
              .map((r) => `${r.role}: ${String(r.content ?? "").slice(0, 800)}`)
              .join("\n");
          } catch {
            return undefined;
          }
        })(),
        // Desktop fast-path is general-mode only — specialized bots stay scoped.
        desktopEnabled: bundle.desktopEnabled && !specialized,
        toolScope,
        requestApproval: () =>
          new Promise((resolve) => {
            pendingApprovals.set(turnThreadId, resolve);
          }),
        memory: {
          sessionStore: bundle.sessionStore,
          memoryStore: bundle.memoryStore,
          embedder: bundle.embedder,
          model: bundle.model,
          workspaceRoot: bundle.workspaceRoot,
          profileHome: bundle.profileHome,
          enableReflection: bundle.enableReflection,
        },
        onEvent: (ev) =>
          emitToRenderer({ ...ev, threadId: turnThreadId } as never),
      });
      turnResult = {
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
      const prefs = loadStoredSettings(agentStateRoot()).agent;
      if (
        prefs.autoSelfHeal &&
        selfHeal.shouldAutoTrigger(true, prefs.selfHealErrorThreshold)
      ) {
        autoHealQueued = true;
      }
      turnResult = {
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

    if (autoHealQueued) {
      emitToRenderer({
        type: "warning",
        message:
          "Repeated turn errors detected — starting automatic self-heal…",
        threadId: turnThreadId,
      } as never);
      void runSelfHealTurn({
        trigger: "auto",
        note: "auto-triggered after repeated turn errors",
        threadId: turnThreadId,
      });
    }

    return turnResult;
  },
  );

  try {
    await createWindow();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    app.quit();
    return;
  }

  agentBooting = true;
  emitToRenderer({
    type: "status",
    phase: "boot",
    detail: "starting agent engine",
  } as never);

  try {
    await bootAgentEngine();
    terminalService.disposeAll();
    // Fresh general session on every launch (old sessions stay in the sidebar).
    activeThreadId = `desktop-${Date.now()}`;
    lastGeneralThreadId = activeThreadId;
    agentBundle?.sessionStore.writeSessionMeta(activeThreadId, {
      projectId: null,
    });
    applyBotScope("general");
    console.log("Agent engine ready");
    // Prefetch Laya so the first chat turn does not pay cold HF/torch load.
    try {
      const { warmLayaInBackground } = await import("../decision/warm.js");
      warmLayaInBackground();
    } catch {
      /* optional */
    }
    // Resume WhatsApp if previously enabled + has auth.
    try {
      const cfg = loadMessagingConfig(agentStateRoot());
      if (cfg.whatsapp.enabled) {
        const bridge = ensureWhatsAppBridge();
        void bridge.start();
      }
    } catch (err) {
      console.error("WhatsApp auto-start failed:", err);
    }
  } catch (err) {
    agentBootError = err instanceof Error ? err.message : String(err);
    agentBooting = false;
    console.error("Failed to boot agent engine:", err);
    emitToRenderer({
      type: "error",
      message: `Failed to boot agent engine: ${agentBootError}`,
    } as never);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  void whatsappBridge?.stop();
  terminalService.disposeAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  terminalService.disposeAll();
  stopKanbanServices();
});
