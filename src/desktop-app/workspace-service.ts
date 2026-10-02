import { ipcMain } from "electron";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AgentBundle } from "../agent/create-agent.js";
import {
  loadPrivacyMode,
  privacyModeInstruction,
} from "../agent/privacy-mode.js";
import {
  activeWorkspaceBots,
  assignProjectToWorkspace,
  buildReplyQueueWithOptionalLlm,
  buildWorkspaceBotInstruction,
  createGroupChat,
  createWorkspaceBot,
  createWorkspaceWithSeed,
  deleteGroupChat,
  deleteWorkspace,
  deleteWorkspaceBot,
  ensureDefaultGroupChat,
  getGroupChat,
  getWorkspace,
  getWorkspaceBot,
  listGroupChats,
  listWorkspaceSummaries,
  loadWorkspaceBots,
  memoryTagsForScope,
  resolveBotToolAllowlist,
  setWorkspaceActiveProject,
  unassignProjectFromWorkspace,
  updateGroupChat,
  updateWorkspace,
  updateWorkspaceBot,
  workspaceThreadId,
  type GroupChatReplyMode,
} from "../agent/workspaces/index.js";
import {
  applyRoundBudget,
  buildSupervisorInstruction,
  buildSupervisorUserPrompt,
  buildSupervisorContinuePrompt,
  excludeSupervisorFromQueue,
  formatSupervisorSystemNote,
  MAX_SUPERVISOR_AUTO_CONTINUE,
  parseSupervisorVerdict,
  pickSupervisorBot,
  resolveContinueWorkerIds,
  shouldAutoContinue,
  looksLikeDeferredNextActions,
  type SupervisorVerdict,
} from "../agent/workspaces/supervisor.js";
import {
  getActiveProject,
  listProjectSummaries,
  loadProjectRegistry,
  primaryFolderOf,
} from "../agent/projects/index.js";
import type { AgentUiEvent } from "../cli/run-agent.js";
import {
  getOrCreateSemanticCacheStore,
} from "../memory/semantic-cache-store.js";
import { isSemanticCacheRoutingEnabled } from "../memory/semantic-cache.js";
import {
  resolveWorkingScope,
  workingScopeAbs,
  workingScopeInstruction,
} from "../agent/working-paths.js";
import fs from "node:fs";
import { GROUP_CHAT_PTY_POOL } from "../sandbox/pty-sandbox.js";
import {
  createApprovalMutex,
  createClaimGate,
  workspaceBotRunThreadId,
} from "./workspace-group-turn.js";

export type WorkspaceIpcContext = {
  agentStateRoot: () => string;
  getBundle: () => AgentBundle | null;
  emitToRenderer: (event: AgentUiEvent) => void;
  listBusyThreadIds: () => string[];
  markThreadBusy: (threadId: string) => void;
  markThreadIdle: (threadId: string) => void;
  activateProjectAndReboot: (
    projectId: string | null,
    opts?: { force?: boolean },
  ) => Promise<
    | {
        ok: true;
        activeProjectId: string | null;
        threadId: string;
        workspaceRoot: string;
        projectFolders: string[] | null;
        projects: ReturnType<typeof listProjectSummaries>;
        reused?: boolean;
      }
    | { ok: false; error: string; busyThreadIds?: string[] }
  >;
  /** Expand sandbox allowlist for a project without rebooting (safe while busy). */
  softAllowProjectFolders: (
    projectId: string,
  ) =>
    | {
        ok: true;
        projectId: string;
        folders: string[];
        added: string[];
        softAligned: true;
      }
    | { ok: false; error: string };
  getActiveThreadId: () => string;
  setActiveThreadId: (id: string) => void;
  loadStoredAutoApprove: () => boolean;
  requestApproval: (
    threadId: string,
    interrupt?: unknown,
  ) => Promise<{ decisions: Array<{ type: "approve" | "reject" }> }>;
  /** Reject/clear any pending HITL for a thread. */
  clearPendingApproval: (threadId: string) => void;
  /** Restore specialized/general bot tool scope after a group turn. */
  restoreBotScope: () => void;
  getGlobalActiveProjectId: () => string | null;
};

function llmInvokeFromModel(
  model: BaseChatModel,
): (system: string, user: string) => Promise<string> {
  return async (system, user) => {
    const res = await model.invoke([
      new SystemMessage(system),
      new HumanMessage(user),
    ]);
    const content = res.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) =>
          typeof p === "string"
            ? p
            : p && typeof p === "object" && "text" in p
              ? String((p as { text: unknown }).text)
              : "",
        )
        .join("");
    }
    return String(content ?? "");
  };
}

export function registerWorkspaceIpc(ctx: WorkspaceIpcContext): void {
  const home = () => ctx.agentStateRoot();

  ipcMain.handle("workspaces:list", async () => {
    return {
      ok: true,
      workspaces: listWorkspaceSummaries(home()),
      projects: listProjectSummaries(home()),
    };
  });

  ipcMain.handle(
    "workspaces:create",
    async (
      _event,
      payload?: {
        name?: string;
        description?: string;
        seedItRoles?: boolean;
        division?: string;
        projectIds?: string[];
      },
    ) => {
      const created = createWorkspaceWithSeed(home(), {
        name: String(payload?.name || ""),
        description: payload?.description,
        division: payload?.division,
        seedItRoles: payload?.seedItRoles,
        projectIds: Array.isArray(payload?.projectIds)
          ? payload!.projectIds.map(String)
          : [],
      });
      if (!created.ok) return created;
      return {
        ok: true,
        workspace: created.workspace,
        bots: created.bots,
        chat: created.chat,
        workspaces: listWorkspaceSummaries(home()),
      };
    },
  );

  ipcMain.handle(
    "workspaces:update",
    async (
      _event,
      payload?: { id?: string; name?: string; description?: string },
    ) => {
      const id = String(payload?.id || "").trim();
      if (!id) return { ok: false, error: "id required" };
      const updated = updateWorkspace(home(), id, {
        name: payload?.name,
        description: payload?.description,
      });
      if (!updated.ok) return updated;
      return {
        ok: true,
        workspace: updated.workspace,
        workspaces: listWorkspaceSummaries(home()),
      };
    },
  );

  ipcMain.handle("workspaces:delete", async (_event, id: string) => {
    const deleted = deleteWorkspace(home(), String(id || "").trim());
    if (!deleted.ok) return deleted;
    return { ok: true, workspaces: listWorkspaceSummaries(home()) };
  });

  ipcMain.handle(
    "workspaces:get",
    async (_event, workspaceId: string) => {
      const id = String(workspaceId || "").trim();
      const workspace = getWorkspace(home(), id);
      if (!workspace) return { ok: false, error: `Unknown workspace: ${id}` };
      ensureDefaultGroupChat(home(), id, workspace.activeProjectId);
      return {
        ok: true,
        workspace,
        bots: loadWorkspaceBots(home(), id),
        chats: listGroupChats(home(), id),
        projects: listProjectSummaries(home()),
      };
    },
  );

  ipcMain.handle(
    "workspaces:assignProject",
    async (
      _event,
      payload?: { workspaceId?: string; projectId?: string },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const projectId = String(payload?.projectId || "").trim();
      const result = assignProjectToWorkspace(home(), workspaceId, projectId);
      if (!result.ok) return result;

      // Make the assigned project active for this workspace and align sandbox/cwd
      // so the Files + Git rail can browse it immediately.
      const activated = setWorkspaceActiveProject(
        home(),
        workspaceId,
        result.workspace.activeProjectId ?? projectId,
      );
      const workspace = activated.ok ? activated.workspace : result.workspace;
      const switched = await ctx.activateProjectAndReboot(
        workspace.activeProjectId,
      );
      if (!switched.ok && workspace.activeProjectId) {
        // Busy mid-turn: keep assignment, soft-allow folders so Files/tools work.
        const soft = ctx.softAllowProjectFolders(workspace.activeProjectId);
        return {
          ok: true,
          workspace,
          workspaces: listWorkspaceSummaries(home()),
          ...(soft.ok
            ? {
                softAligned: true,
                projectFolders: soft.folders,
                warning: switched.error,
              }
            : { warning: switched.error }),
        };
      }
      return {
        ok: true,
        workspace,
        workspaces: listWorkspaceSummaries(home()),
        ...(switched.ok
          ? {
              activeProjectId: switched.activeProjectId,
              workspaceRoot: switched.workspaceRoot,
              projectFolders: switched.projectFolders,
              projects: switched.projects,
            }
          : { warning: switched.error }),
      };
    },
  );

  ipcMain.handle(
    "workspaces:unassignProject",
    async (
      _event,
      payload?: { workspaceId?: string; projectId?: string },
    ) => {
      const result = unassignProjectFromWorkspace(
        home(),
        String(payload?.workspaceId || "").trim(),
        String(payload?.projectId || "").trim(),
      );
      if (!result.ok) return result;
      return {
        ok: true,
        workspace: result.workspace,
        workspaces: listWorkspaceSummaries(home()),
      };
    },
  );

  ipcMain.handle(
    "workspaces:setActiveProject",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        projectId?: string | null;
        force?: boolean;
      },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const projectId =
        payload?.projectId === null || payload?.projectId === undefined
          ? null
          : String(payload.projectId).trim() || null;
      const force = Boolean(payload?.force);

      // Soft-allow before mutating workspace registry when turns are busy.
      if (
        !force &&
        projectId &&
        ctx.getGlobalActiveProjectId() !== projectId &&
        ctx.listBusyThreadIds().length > 0
      ) {
        const soft = ctx.softAllowProjectFolders(projectId);
        if (!soft.ok) {
          return {
            ok: false,
            error: soft.error,
            busyThreadIds: ctx.listBusyThreadIds(),
            workspaces: listWorkspaceSummaries(home()),
          };
        }
        const result = setWorkspaceActiveProject(home(), workspaceId, projectId);
        if (!result.ok) return result;
        return {
          ok: true,
          workspace: result.workspace,
          workspaces: listWorkspaceSummaries(home()),
          activeProjectId: ctx.getGlobalActiveProjectId(),
          softAligned: true,
          projectFolders: soft.folders,
          warning:
            "Turns still running — project folders were added to the sandbox without reboot. Full project switch happens when idle.",
        };
      }

      const result = setWorkspaceActiveProject(home(), workspaceId, projectId);
      if (!result.ok) return result;

      // Align global sandbox only when switching; reuse when already active.
      if (ctx.getGlobalActiveProjectId() === projectId) {
        return {
          ok: true,
          workspace: result.workspace,
          workspaces: listWorkspaceSummaries(home()),
          activeProjectId: projectId,
          reused: true,
        };
      }

      const switched = await ctx.activateProjectAndReboot(projectId, {
        force,
      });
      if (!switched.ok) {
        return {
          ok: false,
          error: switched.error,
          busyThreadIds: switched.busyThreadIds,
          workspace: result.workspace,
          workspaces: listWorkspaceSummaries(home()),
        };
      }
      return {
        ok: true,
        workspace: result.workspace,
        workspaces: listWorkspaceSummaries(home()),
        activeProjectId: switched.activeProjectId,
        workspaceRoot: switched.workspaceRoot,
        projectFolders: switched.projectFolders,
        projects: switched.projects,
      };
    },
  );

  // —— bots ——
  ipcMain.handle(
    "workspaces:listBots",
    async (_event, workspaceId: string) => {
      const id = String(workspaceId || "").trim();
      if (!getWorkspace(home(), id)) {
        return { ok: false, error: `Unknown workspace: ${id}` };
      }
      return { ok: true, bots: loadWorkspaceBots(home(), id) };
    },
  );

  ipcMain.handle(
    "workspaces:createBot",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        name?: string;
        role?: string;
        description?: string;
        systemPrompt?: string;
        tools?: string[];
        skills?: string[];
      },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const created = createWorkspaceBot(home(), workspaceId, {
        name: String(payload?.name || ""),
        role: payload?.role,
        description: payload?.description,
        systemPrompt: payload?.systemPrompt,
        tools: payload?.tools,
        skills: payload?.skills,
      });
      if (!created.ok) return created;
      return { ok: true, bot: created.bot, bots: created.bots };
    },
  );

  ipcMain.handle(
    "workspaces:updateBot",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        botId?: string;
        name?: string;
        role?: string;
        description?: string;
        systemPrompt?: string;
        tools?: string[];
        skills?: string[];
        active?: boolean;
      },
    ) => {
      const updated = updateWorkspaceBot(
        home(),
        String(payload?.workspaceId || "").trim(),
        String(payload?.botId || "").trim(),
        {
          name: payload?.name,
          role: payload?.role,
          description: payload?.description,
          systemPrompt: payload?.systemPrompt,
          tools: payload?.tools,
          skills: payload?.skills,
          active: payload?.active,
        },
      );
      if (!updated.ok) return updated;
      return { ok: true, bot: updated.bot, bots: updated.bots };
    },
  );

  ipcMain.handle(
    "workspaces:deleteBot",
    async (
      _event,
      payload?: { workspaceId?: string; botId?: string },
    ) => {
      const deleted = deleteWorkspaceBot(
        home(),
        String(payload?.workspaceId || "").trim(),
        String(payload?.botId || "").trim(),
      );
      if (!deleted.ok) return deleted;
      return { ok: true, bots: deleted.bots };
    },
  );

  // —— chats ——
  ipcMain.handle(
    "workspaces:listChats",
    async (_event, workspaceId: string) => {
      const id = String(workspaceId || "").trim();
      if (!getWorkspace(home(), id)) {
        return { ok: false, error: `Unknown workspace: ${id}` };
      }
      return { ok: true, chats: listGroupChats(home(), id) };
    },
  );

  ipcMain.handle(
    "workspaces:createChat",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        name?: string;
        replyMode?: GroupChatReplyMode;
        maxResponders?: number;
      },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const ws = getWorkspace(home(), workspaceId);
      if (!ws) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
      const created = createGroupChat(home(), workspaceId, {
        name: payload?.name,
        replyMode: payload?.replyMode,
        maxResponders: payload?.maxResponders,
        projectId: ws.activeProjectId,
      });
      if (!created.ok) return created;
      return {
        ok: true,
        chat: created.chat,
        threadId: workspaceThreadId(workspaceId, created.chat.id),
        chats: listGroupChats(home(), workspaceId),
      };
    },
  );

  ipcMain.handle(
    "workspaces:updateChat",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        chatId?: string;
        name?: string;
        replyMode?: GroupChatReplyMode;
        maxResponders?: number;
      },
    ) => {
      const updated = updateGroupChat(
        home(),
        String(payload?.workspaceId || "").trim(),
        String(payload?.chatId || "").trim(),
        {
          name: payload?.name,
          replyMode: payload?.replyMode,
          maxResponders: payload?.maxResponders,
        },
      );
      if (!updated.ok) return updated;
      return { ok: true, chat: updated.chat };
    },
  );

  ipcMain.handle(
    "workspaces:deleteChat",
    async (
      _event,
      payload?: { workspaceId?: string; chatId?: string },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const chatId = String(payload?.chatId || "").trim();
      const deleted = deleteGroupChat(home(), workspaceId, chatId);
      if (!deleted.ok) return deleted;
      return { ok: true, chats: listGroupChats(home(), workspaceId) };
    },
  );

  ipcMain.handle(
    "workspaces:openChat",
    async (
      _event,
      payload?: { workspaceId?: string; chatId?: string },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const chatId = String(payload?.chatId || "").trim();
      const ws = getWorkspace(home(), workspaceId);
      if (!ws) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
      let chat = getGroupChat(home(), workspaceId, chatId);
      if (!chat) {
        chat = ensureDefaultGroupChat(home(), workspaceId, ws.activeProjectId);
      }
      const threadId = workspaceThreadId(workspaceId, chat.id);
      const bundle = ctx.getBundle();
      if (bundle) {
        bundle.sessionStore.writeSessionMeta(threadId, {
          projectId: ws.activeProjectId,
          workspaceId,
          chatId: chat.id,
        });
      }
      // Do not mutate main-window activeThreadId — workspace chats use explicit threadId.
      const events = bundle?.sessionStore.readTranscript(threadId, 200) ?? [];
      return {
        ok: true,
        workspace: ws,
        chat,
        threadId,
        bots: loadWorkspaceBots(home(), workspaceId),
        events,
        activeProjectId: ws.activeProjectId,
      };
    },
  );

  ipcMain.handle(
    "workspaces:sendGroupPrompt",
    async (
      _event,
      payload?: {
        workspaceId?: string;
        chatId?: string;
        prompt?: string;
        attachments?: Array<{ path?: string; absPath?: string }>;
      },
    ) => {
      const workspaceId = String(payload?.workspaceId || "").trim();
      const chatId = String(payload?.chatId || "").trim();
      const promptRaw = String(payload?.prompt || "").trim();
      const attachmentRefs = Array.isArray(payload?.attachments)
        ? payload.attachments
        : [];

      const {
        buildMultimodalUserContent,
        composePromptWithAttachments,
        resolveWorkspaceUploadAttachment,
      } = await import("./inbound-attachments.js");
      type InboundAttachment =
        import("./inbound-attachments.js").InboundAttachment;

      const bundleEarly = ctx.getBundle();
      if (!bundleEarly) {
        return { ok: false, error: "Agent engine not ready" };
      }

      const attachments: InboundAttachment[] = [];
      const artifactHome =
        bundleEarly.artifactHome || bundleEarly.workspaceRoot;
      for (const ref of attachmentRefs) {
        const resolved = resolveWorkspaceUploadAttachment(artifactHome, ref);
        if (resolved.ok) attachments.push(resolved.attachment);
      }

      const composedPrompt = await composePromptWithAttachments(
        promptRaw,
        attachments,
      );
      const userContent = await buildMultimodalUserContent(
        composedPrompt,
        attachments,
      );
      const prompt = composedPrompt.trim();
      if (!prompt && attachments.length === 0) {
        return { ok: false, error: "Empty prompt" };
      }

      const bundle = ctx.getBundle();
      if (!bundle) {
        return { ok: false, error: "Agent engine not ready" };
      }

      const wsRaw = getWorkspace(home(), workspaceId);
      if (!wsRaw) return { ok: false, error: `Unknown workspace: ${workspaceId}` };
      let ws = wsRaw;

      // Prefer explicit active project; otherwise first assigned project.
      let projectId =
        ws.activeProjectId ||
        (ws.projectIds.length > 0 ? ws.projectIds[0]! : null);
      if (projectId && projectId !== ws.activeProjectId) {
        const pinned = setWorkspaceActiveProject(home(), workspaceId, projectId);
        if (pinned.ok) ws = pinned.workspace;
      }

      if (!projectId) {
        return {
          ok: false,
          error:
            "Assign a project to this workspace first (Projects → select → +), then ask again.",
        };
      }

      const chat =
        getGroupChat(home(), workspaceId, chatId) ??
        ensureDefaultGroupChat(home(), workspaceId, projectId);
      const bots = activeWorkspaceBots(loadWorkspaceBots(home(), workspaceId));
      if (bots.length === 0) {
        return { ok: false, error: "Add at least one active member bot first" };
      }

      const threadId = workspaceThreadId(workspaceId, chat.id);
      if (ctx.listBusyThreadIds().includes(threadId)) {
        return {
          ok: false,
          error: "This group chat is already running a turn.",
          threadId,
        };
      }

      // Align sandbox to workspace project. If another turn is busy, soft-allow
      // folders (no reboot) so session↔workspace can run concurrently.
      if (ctx.getGlobalActiveProjectId() !== projectId) {
        if (ctx.listBusyThreadIds().length > 0) {
          const soft = ctx.softAllowProjectFolders(projectId);
          if (!soft.ok) {
            return { ok: false, error: soft.error };
          }
        } else {
          const switched = await ctx.activateProjectAndReboot(projectId);
          if (!switched.ok) {
            return { ok: false, error: switched.error };
          }
        }
      }

      const projectRecord =
        loadProjectRegistry(home()).projects.find((p) => p.id === projectId) ??
        getActiveProject(home());
      const projectCtx = projectRecord
        ? {
            id: projectRecord.id,
            name: projectRecord.name,
            folders: [...projectRecord.folders],
            primaryFolder: primaryFolderOf(projectRecord),
          }
        : null;

      // Keep main-window activeThreadId untouched; group turns use explicit threadId.
      ctx.markThreadBusy(threadId);
      const bundleAfter = ctx.getBundle();
      if (!bundleAfter) {
        ctx.markThreadIdle(threadId);
        return { ok: false, error: "Agent engine not ready after project switch" };
      }
      const activeBundle = bundleAfter;
      activeBundle.sessionStore.writeSessionMeta(threadId, {
        projectId,
        workspaceId,
        chatId: chat.id,
      });

      try {
        const queue = await buildReplyQueueWithOptionalLlm({
          message: promptRaw || prompt,
          bots,
          replyMode: chat.replyMode,
          maxResponders: chat.maxResponders,
          llmInvoke: llmInvokeFromModel(activeBundle.model),
          semanticCache:
            isSemanticCacheRoutingEnabled() &&
            activeBundle.embedder.model !== "lexical-only"
              ? {
                  store: getOrCreateSemanticCacheStore(
                    activeBundle.profileHome,
                  ),
                  embedder: activeBundle.embedder,
                }
              : undefined,
        });

        const supervisor =
          chat.supervisorEnabled !== false
            ? pickSupervisorBot(bots, chat.supervisorBotId)
            : null;
        let workerBotIds = queue.botIds;
        let runSupervisorReview = Boolean(supervisor);
        if (supervisor) {
          const withoutSup = excludeSupervisorFromQueue(
            queue.botIds,
            supervisor.id,
          );
          if (withoutSup.length > 0) {
            workerBotIds = withoutSup;
          } else {
            // Supervisor was the only selected bot — answer as worker, skip review.
            workerBotIds = [supervisor.id];
            runSupervisorReview = false;
          }
        }

        if (workerBotIds.length === 0) {
          activeBundle.sessionStore.appendTranscript({
            threadId,
            role: "user",
            content: prompt,
          });
          activeBundle.sessionStore.appendTranscript({
            threadId,
            role: "system",
            content: queue.reason,
          });
          ctx.emitToRenderer({
            type: "status",
            phase: "done",
            detail: queue.reason,
            threadId,
          } as never);
          return {
            ok: true,
            threadId,
            replies: [],
            queue,
            note: queue.reason,
            autoContinue: false,
            autoContinuePrompt: null,
          };
        }

        const { runAgentTurn } = await import("../cli/run-agent.js");
        const {
          looksLikeIncompleteReasoning,
          looksLikeToolPlanNarration,
        } = await import("../agent/sanitize-output.js");

        // Grow shared PTY pool so several bots can run execute() if needed.
        try {
          activeBundle.sandbox.ensurePoolSize(GROUP_CHAT_PTY_POOL);
        } catch (err) {
          console.warn(
            "[workspaces] ensurePoolSize failed:",
            err instanceof Error ? err.message : err,
          );
        }

        const claimUserTranscript = createClaimGate();
        const withApprovalLock = createApprovalMutex();
        const autoApprove = ctx.loadStoredAutoApprove();
        const desktopEnabled = Boolean(activeBundle.desktopEnabled);
        const artifactHome =
          activeBundle.artifactHome || activeBundle.workspaceRoot;

        // Broadcast greetings stay parallel; specialist turns run sequentially
        // so each bot can build on prior replies (coherent thread).
        // Auto-continue rounds always run sequential (targeted follow-up).
        const baseSequential = queue.source !== "broadcast";

        const originalUserPrompt = prompt;
        let turnPromptText = prompt;
        let turnUserContent: typeof userContent | undefined = userContent;
        let isContinueRound = false;
        let autoContinueDepth = 0;
        let roundCursor = chat.roundCount;
        const allReplies: Array<{
          botId: string;
          botName: string;
          content: string;
        }> = [];
        let supervisorVerdict: SupervisorVerdict | null = null;
        let supervisorNote: string | null = null;
        const supervisorNotes: string[] = [];
        let lastWorkerBotIds = workerBotIds;

        const runOneBot = async (
          botId: string,
          priorReplies: Array<{
            botId: string;
            botName: string;
            content: string;
          }>,
          opts?: { limitTools?: boolean; sequential?: boolean },
        ): Promise<{
          botId: string;
          botName: string;
          content: string;
        } | null> => {
          const bot = getWorkspaceBot(home(), workspaceId, botId);
          if (!bot) return null;

          const sequential = opts?.sequential !== false;
          const limitTools = opts?.limitTools !== false;
          const allowedTools = limitTools
            ? resolveBotToolAllowlist(bot)
            : null;
          if (limitTools) {
            activeBundle.botScope.setAllowedTools(allowedTools);
          }

          const scopeTags = memoryTagsForScope({ workspaceId, botId: bot.id });
          const instruction = buildWorkspaceBotInstruction(bot, {
            priorBotNames: priorReplies.map((r) => r.botName),
            priorReplies: sequential
              ? priorReplies.map((r) => ({
                  botName: r.botName,
                  content: r.content,
                }))
              : undefined,
            parallelGroup: !sequential,
            allowedTools: limitTools ? allowedTools : null,
            project: projectCtx,
          });

          const workScope = resolveWorkingScope({
            threadId,
            workspaceId,
            projectId,
            projectName: projectCtx?.name ?? null,
            botId: bot.id,
          });
          const { absDir } = workingScopeAbs(artifactHome, workScope);
          fs.mkdirSync(absDir, { recursive: true });
          fs.mkdirSync(
            workingScopeAbs(artifactHome, workScope).uploadsAbsDir,
            { recursive: true },
          );
          const workingScopeNudge = [
            workingScopeInstruction(workScope, absDir),
            privacyModeInstruction(
              ctx.getBundle()?.sandbox.isPrivacyStrict()
                ? true
                : loadPrivacyMode(ctx.agentStateRoot()),
            ),
          ]
            .filter(Boolean)
            .join("\n\n");
          const runThreadId = workspaceBotRunThreadId(threadId, bot.id);
          // First user bubble only on the initial round; continue rounds are system handoffs.
          const writeUser = !isContinueRound && claimUserTranscript();

          ctx.emitToRenderer({
            type: "status",
            phase: "thinking",
            detail: `${bot.name} responding…`,
            threadId,
          } as never);

          const forwardEvent = (ev: AgentUiEvent) => {
            ctx.emitToRenderer({
              ...ev,
              threadId,
              botId: bot.id,
              botName: bot.name,
            } as never);
          };

          const requestApproval = () =>
            withApprovalLock(() => ctx.requestApproval(threadId));

          // Put teammate replies in the USER turn itself so the model continues
          // the thread (instruction-only handoff gets ignored too often).
          const turnPrompt =
            sequential && priorReplies.length > 0
              ? [
                  turnPromptText,
                  "",
                  "[TEAMMATES THIS TURN — continue from here; do not restart]",
                  ...priorReplies.map((r) => {
                    const body = r.content
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 2200);
                    return `### ${r.botName}\n${body}${r.content.length > 2200 ? "…" : ""}`;
                  }),
                  "",
                  `[YOUR TURN — ${bot.name}${bot.role ? ` / ${bot.role}` : ""}]`,
                  "Build on teammates, fill gaps for YOUR role, disagree only with evidence. Do not repeat them.",
                ].join("\n")
              : turnPromptText;

          return activeBundle.memoryScope.runWithTags(scopeTags, async () => {
            try {
              let answer = await runAgentTurn({
                agent: activeBundle.agent,
                prompt: turnPrompt,
                // Multimodal parts stay on the original user message only for the
                // first responder of the first round.
                userContent:
                  !isContinueRound &&
                  sequential &&
                  priorReplies.length > 0
                    ? undefined
                    : isContinueRound
                      ? undefined
                      : turnUserContent,
                botInstruction: instruction,
                workingScopeNudge,
                threadId,
                checkpointThreadId: runThreadId,
                projectId,
                workspaceId,
                chatId: chat.id,
                autoApprove,
                chatMode: "agent",
                runMode: activeBundle.runMode,
                planGate: activeBundle.planGate,
                isPrivacyStrict: () => activeBundle.sandbox.isPrivacyStrict(),
                requestApproval,
                desktopEnabled,
                skipUserTranscript: !writeUser,
                toolScope: {
                  get: () => activeBundle.botScope.getAllowedTools(),
                  set: (tools) => activeBundle.botScope.setAllowedTools(tools),
                },
                assistantMeta: {
                  botId: bot.id,
                  botName: bot.name,
                  botRole: bot.role ?? null,
                  workspaceId,
                  chatId: chat.id,
                  projectId,
                  projectName: projectCtx?.name ?? null,
                  projectFolder: projectCtx?.primaryFolder ?? null,
                },
                memoryScopeTags: scopeTags,
                memory: {
                  sessionStore: activeBundle.sessionStore,
                  memoryStore: activeBundle.memoryStore,
                  embedder: activeBundle.embedder,
                  model: activeBundle.model,
                  workspaceRoot: activeBundle.workspaceRoot,
                  profileHome: activeBundle.profileHome,
                  enableReflection: activeBundle.enableReflection,
                },
                onEvent: forwardEvent,
              });

              if (
                projectCtx &&
                (looksLikeToolPlanNarration(answer) ||
                  looksLikeIncompleteReasoning(answer))
              ) {
                ctx.emitToRenderer({
                  type: "warning",
                  message: `${bot.name}: jawaban masih rencana tool — retry dengan ls/read_file…`,
                  threadId,
                } as never);
                answer = await runAgentTurn({
                  agent: activeBundle.agent,
                  prompt: [
                    turnPrompt,
                    "",
                    "[SYSTEM NUDGE]",
                    "Jawaban sebelumnya hanya merencanakan eksplorasi — itu salah.",
                    "Sekarang WAJIB panggil tool `ls` (dan `grep`/`read_file` bila relevan), lalu jawab singkat dalam Bahasa Indonesia dengan bukti konkret.",
                    "Jangan tulis rencana berbahasa Inggris. Jangan bilang \"I need to use the available tools\", \"First, I should start by listing\", atau \"I need to remember to keep my response\".",
                    "Untuk cek bug: sebutkan risiko spesifik (file + alasan) dari hasil tool — bukan rencana eslint.",
                  ].join("\n"),
                  botInstruction: instruction,
                  workingScopeNudge,
                  threadId,
                  checkpointThreadId: runThreadId,
                  projectId,
                  workspaceId,
                  chatId: chat.id,
                  autoApprove,
                  chatMode: "agent",
                  runMode: activeBundle.runMode,
                  planGate: activeBundle.planGate,
                  isPrivacyStrict: () => activeBundle.sandbox.isPrivacyStrict(),
                  requestApproval,
                  desktopEnabled,
                  skipUserTranscript: true,
                  toolScope: {
                    get: () => activeBundle.botScope.getAllowedTools(),
                    set: (tools) => activeBundle.botScope.setAllowedTools(tools),
                  },
                  assistantMeta: {
                    botId: bot.id,
                    botName: bot.name,
                    botRole: bot.role ?? null,
                    workspaceId,
                    chatId: chat.id,
                    projectId,
                    projectName: projectCtx?.name ?? null,
                    projectFolder: projectCtx?.primaryFolder ?? null,
                    retry: "tool_plan_narration",
                  },
                  memoryScopeTags: scopeTags,
                  memory: {
                    sessionStore: activeBundle.sessionStore,
                    memoryStore: activeBundle.memoryStore,
                    embedder: activeBundle.embedder,
                    model: activeBundle.model,
                    workspaceRoot: activeBundle.workspaceRoot,
                    profileHome: activeBundle.profileHome,
                    enableReflection: false,
                  },
                  onEvent: forwardEvent,
                });
              }

              return {
                botId: bot.id,
                botName: bot.name,
                content: answer,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              ctx.emitToRenderer({
                type: "error",
                message: `${bot.name}: ${message}`,
                threadId,
              } as never);
              return null;
            }
          });
        };

        // Worker round → supervisor review → auto-continue (server-side) until
        // done/blocked/budget. UI must not need a second IPC hop for PERLU LANJUT.
        for (;;) {
          const sequentialHandoff = isContinueRound ? true : baseSequential;
          const roundReplies: Array<{
            botId: string;
            botName: string;
            content: string;
          }> = [];

          ctx.emitToRenderer({
            type: "status",
            phase: "thinking",
            detail: isContinueRound
              ? `Melanjutkan putaran ${autoContinueDepth + 1} (supervisor)…`
              : sequentialHandoff
                ? `${workerBotIds.length} bot(s) responding in sequence…`
                : `${workerBotIds.length} bot(s) responding in parallel…`,
            threadId,
          } as never);

          try {
            if (sequentialHandoff) {
              for (const botId of workerBotIds) {
                const result = await runOneBot(botId, roundReplies, {
                  sequential: true,
                });
                if (!result) continue;
                if (
                  looksLikeToolPlanNarration(result.content) ||
                  looksLikeIncompleteReasoning(result.content)
                ) {
                  continue;
                }
                roundReplies.push(result);
                allReplies.push(result);
              }
            } else {
              activeBundle.botScope.setAllowedTools(null);
              const botJobs = workerBotIds.map(async (botId, index) => {
                if (index > 0) {
                  await new Promise((r) => setTimeout(r, index * 200));
                }
                return runOneBot(botId, [], {
                  limitTools: false,
                  sequential: false,
                });
              });
              const settled = await Promise.allSettled(botJobs);
              for (const result of settled) {
                if (result.status !== "fulfilled" || !result.value) continue;
                if (
                  looksLikeToolPlanNarration(result.value.content) ||
                  looksLikeIncompleteReasoning(result.value.content)
                ) {
                  continue;
                }
                roundReplies.push(result.value);
                allReplies.push(result.value);
              }
            }
          } finally {
            activeBundle.botScope.setAllowedTools(null);
          }

          lastWorkerBotIds = workerBotIds;

          if (roundReplies.length === 0) {
            break;
          }

          roundCursor += 1;
          const reviewReplies = isContinueRound
            ? allReplies.slice(-Math.max(roundReplies.length, 6))
            : roundReplies;

          if (runSupervisorReview && supervisor) {
            ctx.emitToRenderer({
              type: "status",
              phase: "thinking",
              detail: `Supervisor (${supervisor.name}) reviewing…`,
              threadId,
            } as never);

            const instruction = buildSupervisorInstruction(supervisor);
            const supervisorPrompt = buildSupervisorUserPrompt({
              userPrompt: originalUserPrompt,
              workerReplies: reviewReplies,
              round: roundCursor,
              maxRounds: chat.maxRounds,
            });

            try {
              // Lightweight judge call — no tools / agent loop.
              const rawVerdict = await llmInvokeFromModel(activeBundle.model)(
                instruction,
                supervisorPrompt,
              );

              supervisorVerdict = applyRoundBudget(
                parseSupervisorVerdict(rawVerdict),
                roundCursor,
                chat.maxRounds,
              );

              // Workers that only listed "next" without editing files are not done.
              const deferredOnly =
                roundReplies.length > 0 &&
                roundReplies.every((r) =>
                  looksLikeDeferredNextActions(r.content),
                );
              if (
                deferredOnly &&
                supervisorVerdict.status === "done" &&
                roundCursor < chat.maxRounds
              ) {
                supervisorVerdict = {
                  ...supervisorVerdict,
                  status: "needs_more",
                  summary: `${supervisorVerdict.summary} (runtime: jawaban masih daftar next tanpa eksekusi — lanjut otomatis)`.trim(),
                  nextActions:
                    supervisorVerdict.nextActions.length > 0
                      ? supervisorVerdict.nextActions
                      : [
                          "Eksekusi perbaikan dengan write_file/edit_file sekarang — jangan audit ulang.",
                        ],
                };
              }

              supervisorNote = formatSupervisorSystemNote(
                supervisorVerdict,
                supervisor.name,
              );
              supervisorNotes.push(supervisorNote);

              activeBundle.sessionStore.appendTranscript({
                threadId,
                role: "system",
                content: supervisorNote,
              });

              ctx.emitToRenderer({
                type: "status",
                phase: "thinking",
                detail: supervisorNote.split("\n")[0] || "Supervisor review",
                threadId,
              } as never);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn("[workspaces] supervisor review failed:", message);
              ctx.emitToRenderer({
                type: "warning",
                message: `Supervisor review failed: ${message}`,
                threadId,
              } as never);
              break;
            }
          } else if (roundCursor >= chat.maxRounds) {
            supervisorVerdict = applyRoundBudget(
              {
                status: "needs_more",
                summary: "Batas putaran diskusi tercapai.",
                gaps: [],
                nextActions: [],
                raw: "",
                parsed: false,
              },
              roundCursor,
              chat.maxRounds,
            );
            supervisorNote = formatSupervisorSystemNote(
              supervisorVerdict,
              supervisor?.name ?? "system",
            );
            supervisorNotes.push(supervisorNote);
            activeBundle.sessionStore.appendTranscript({
              threadId,
              role: "system",
              content: supervisorNote,
            });
          }

          const canContinue =
            runSupervisorReview &&
            shouldAutoContinue(
              supervisorVerdict,
              roundCursor,
              chat.maxRounds,
              autoContinueDepth,
            );

          if (!canContinue || !supervisorVerdict) {
            break;
          }

          const continuePrompt = buildSupervisorContinuePrompt({
            originalPrompt: originalUserPrompt,
            verdict: supervisorVerdict,
            round: roundCursor,
            maxRounds: chat.maxRounds,
          });

          const nextWorkers = resolveContinueWorkerIds({
            previousWorkerIds: lastWorkerBotIds,
            bots,
            verdict: supervisorVerdict,
            supervisorId: supervisor?.id,
          });

          if (nextWorkers.length === 0) {
            break;
          }

          autoContinueDepth += 1;
          isContinueRound = true;
          turnPromptText = continuePrompt;
          turnUserContent = undefined;
          workerBotIds = nextWorkers;
          // If supervisor was pulled in as implementer, still review after
          // (judge call is tool-free). Solo-supervisor first-round skips review.

          const handoffNote = `Melanjutkan putaran ${autoContinueDepth + 1} — ${nextWorkers.join(", ")}`;
          supervisorNotes.push(handoffNote);
          activeBundle.sessionStore.appendTranscript({
            threadId,
            role: "system",
            content: handoffNote,
          });
          ctx.emitToRenderer({
            type: "status",
            phase: "thinking",
            detail: handoffNote,
            threadId,
          } as never);
        }

        if (
          supervisorVerdict?.status === "needs_more" &&
          autoContinueDepth >= MAX_SUPERVISOR_AUTO_CONTINUE
        ) {
          const budgetNote = `(auto-continue ${MAX_SUPERVISOR_AUTO_CONTINUE}x habis — kirim pesan baru untuk lanjut)`;
          supervisorNotes.push(budgetNote);
          supervisorNote = supervisorNote
            ? `${supervisorNote}\n${budgetNote}`
            : budgetNote;
          activeBundle.sessionStore.appendTranscript({
            threadId,
            role: "system",
            content: budgetNote,
          });
        }

        const combinedNote =
          supervisorNotes.length > 0
            ? supervisorNotes.join("\n---\n")
            : supervisorNote;

        // Advance round budget only when workers produced replies.
        // Reset after a clean "done" so the next user task starts fresh.
        const chatPatch: {
          projectId: string;
          roundCount?: number;
        } = { projectId };
        if (allReplies.length > 0) {
          chatPatch.roundCount =
            supervisorVerdict?.status === "done" ? 0 : roundCursor;
        }
        updateGroupChat(home(), workspaceId, chat.id, chatPatch);

        ctx.emitToRenderer({
          type: "status",
          phase: "done",
          detail:
            supervisorNote?.split("\n")[0] ||
            (allReplies.length
              ? `${allReplies.length} reply(ies)`
              : "Group turn done"),
          threadId,
        } as never);

        return {
          ok: true,
          threadId,
          replies: allReplies,
          queue: { ...queue, botIds: lastWorkerBotIds },
          projectId,
          workspaceRoot: activeBundle.workspaceRoot,
          supervisor: supervisorVerdict
            ? {
                botId: supervisor?.id ?? null,
                botName: supervisor?.name ?? null,
                ...supervisorVerdict,
                note: combinedNote,
              }
            : null,
          note: combinedNote,
          // Server already ran continue rounds; UI must not kick a second loop.
          autoContinue: false,
          autoContinuePrompt: null,
          autoContinueRounds: autoContinueDepth,
        };
      } finally {
        activeBundle.memoryScope.setRequiredTags(undefined);
        ctx.restoreBotScope();
        ctx.clearPendingApproval(threadId);
        ctx.markThreadIdle(threadId);
      }
    },
  );
}

/** Filter helper for session lists — hide workspace group threads from Sessions tab. */
export { isWorkspaceThreadId } from "../agent/workspaces/chats.js";
