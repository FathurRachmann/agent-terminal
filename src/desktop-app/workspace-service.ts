import { ipcMain } from "electron";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AgentBundle } from "../agent/create-agent.js";
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
  excludeSupervisorFromQueue,
  formatSupervisorSystemNote,
  parseSupervisorVerdict,
  pickSupervisorBot,
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
  getActiveThreadId: () => string;
  setActiveThreadId: (id: string) => void;
  loadStoredAutoApprove: () => boolean;
  requestApproval: (
    threadId: string,
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

      // Hard-align sandbox to workspace project before group turns.
      if (ctx.getGlobalActiveProjectId() !== projectId) {
        if (ctx.listBusyThreadIds().length > 0) {
          return {
            ok: false,
            error:
              "Finish running turns before this workspace can switch to its active project sandbox.",
          };
        }
        const switched = await ctx.activateProjectAndReboot(projectId);
        if (!switched.ok) {
          return { ok: false, error: switched.error };
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
          };
        }

        const { runAgentTurn } = await import("../cli/run-agent.js");
        const {
          looksLikeIncompleteReasoning,
          looksLikeToolPlanNarration,
        } = await import("../agent/sanitize-output.js");
        const replies: Array<{
          botId: string;
          botName: string;
          content: string;
        }> = [];

        // Grow shared PTY pool so several bots can run execute() concurrently.
        try {
          activeBundle.sandbox.ensurePoolSize(GROUP_CHAT_PTY_POOL);
        } catch (err) {
          console.warn(
            "[workspaces] ensurePoolSize failed:",
            err instanceof Error ? err.message : err,
          );
        }

        // Same tool surface for all bots — set once before parallel turns.
        activeBundle.botScope.setAllowedTools(null);

        const claimUserTranscript = createClaimGate();
        const withApprovalLock = createApprovalMutex();
        const autoApprove = ctx.loadStoredAutoApprove();
        const desktopEnabled = Boolean(activeBundle.desktopEnabled);
        const artifactHome =
          activeBundle.artifactHome || activeBundle.workspaceRoot;

        ctx.emitToRenderer({
          type: "status",
          phase: "thinking",
          detail: `${workerBotIds.length} bot(s) responding in parallel…`,
          threadId,
        } as never);

        const botJobs = workerBotIds.map(async (botId, index) => {
          // Stagger starts so parallel bots don't thundering-herd the router.
          if (index > 0) {
            await new Promise((r) => setTimeout(r, index * 200));
          }
          const bot = getWorkspaceBot(home(), workspaceId, botId);
          if (!bot) return null;

          const scopeTags = memoryTagsForScope({ workspaceId, botId: bot.id });
          const instruction = buildWorkspaceBotInstruction(bot, {
            // Parallel: teammates may still be answering — stay complementary.
            priorBotNames: workerBotIds
              .filter((id) => id !== bot.id)
              .map((id) => getWorkspaceBot(home(), workspaceId, id)?.name)
              .filter((n): n is string => Boolean(n)),
            project: projectCtx,
            parallelGroup: true,
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
          const workingScopeNudge = workingScopeInstruction(workScope, absDir);
          const runThreadId = workspaceBotRunThreadId(threadId, bot.id);
          const writeUser = claimUserTranscript();

          ctx.emitToRenderer({
            type: "status",
            phase: "thinking",
            detail: `${bot.name} responding…`,
            threadId,
          } as never);

          const forwardEvent = (ev: AgentUiEvent) => {
            ctx.emitToRenderer({
              ...ev,
              // UI filters on the group thread; keep checkpointer on runThreadId.
              threadId,
              botId: bot.id,
              botName: bot.name,
            } as never);
          };

          const requestApproval = () =>
            withApprovalLock(() => ctx.requestApproval(threadId));

          return activeBundle.memoryScope.runWithTags(scopeTags, async () => {
            try {
              let answer = await runAgentTurn({
                agent: activeBundle.agent,
                prompt,
                userContent,
                botInstruction: instruction,
                workingScopeNudge,
                threadId,
                checkpointThreadId: runThreadId,
                projectId,
                workspaceId,
                chatId: chat.id,
                autoApprove,
                requestApproval,
                desktopEnabled,
                skipUserTranscript: !writeUser,
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
                    prompt,
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
                  requestApproval,
                  desktopEnabled,
                  skipUserTranscript: true,
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
        });

        const settled = await Promise.allSettled(botJobs);
        for (const result of settled) {
          if (result.status !== "fulfilled" || !result.value) continue;
          // Don't surface unresolved tool-plan CoT as a team reply.
          if (
            looksLikeToolPlanNarration(result.value.content) ||
            looksLikeIncompleteReasoning(result.value.content)
          ) {
            continue;
          }
          replies.push(result.value);
        }

        const nextRound = replies.length > 0 ? chat.roundCount + 1 : chat.roundCount;
        let supervisorVerdict: SupervisorVerdict | null = null;
        let supervisorNote: string | null = null;

        if (runSupervisorReview && supervisor && replies.length > 0) {
          ctx.emitToRenderer({
            type: "status",
            phase: "thinking",
            detail: `Supervisor (${supervisor.name}) reviewing…`,
            threadId,
          } as never);

          const instruction = buildSupervisorInstruction(supervisor);
          const supervisorPrompt = buildSupervisorUserPrompt({
            userPrompt: prompt,
            workerReplies: replies,
            round: nextRound,
            maxRounds: chat.maxRounds,
          });

          try {
            // Lightweight judge call — no tools / agent loop (avoids double bubbles + cost).
            const rawVerdict = await llmInvokeFromModel(activeBundle.model)(
              instruction,
              supervisorPrompt,
            );

            supervisorVerdict = applyRoundBudget(
              parseSupervisorVerdict(rawVerdict),
              nextRound,
              chat.maxRounds,
            );
            supervisorNote = formatSupervisorSystemNote(
              supervisorVerdict,
              supervisor.name,
            );

            activeBundle.sessionStore.appendTranscript({
              threadId,
              role: "system",
              content: supervisorNote,
            });

            ctx.emitToRenderer({
              type: "status",
              phase: "done",
              detail: supervisorNote.split("\n")[0] || "Supervisor done",
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
          }
        } else if (
          replies.length > 0 &&
          chat.roundCount + 1 >= chat.maxRounds
        ) {
          supervisorVerdict = applyRoundBudget(
            {
              status: "needs_more",
              summary: "Batas putaran diskusi tercapai.",
              gaps: [],
              nextActions: [],
              raw: "",
              parsed: false,
            },
            chat.roundCount + 1,
            chat.maxRounds,
          );
          supervisorNote = formatSupervisorSystemNote(
            supervisorVerdict,
            supervisor?.name ?? "system",
          );
          activeBundle.sessionStore.appendTranscript({
            threadId,
            role: "system",
            content: supervisorNote,
          });
        }

        // Advance round budget only when workers produced replies.
        // Reset after a clean "done" so the next user task starts fresh.
        const chatPatch: {
          projectId: string;
          roundCount?: number;
        } = { projectId };
        if (replies.length > 0) {
          chatPatch.roundCount =
            supervisorVerdict?.status === "done" ? 0 : nextRound;
        }
        updateGroupChat(home(), workspaceId, chat.id, chatPatch);

        return {
          ok: true,
          threadId,
          replies,
          queue: { ...queue, botIds: workerBotIds },
          projectId,
          workspaceRoot: activeBundle.workspaceRoot,
          supervisor: supervisorVerdict
            ? {
                botId: supervisor?.id ?? null,
                botName: supervisor?.name ?? null,
                ...supervisorVerdict,
                note: supervisorNote,
              }
            : null,
          note: supervisorNote,
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
