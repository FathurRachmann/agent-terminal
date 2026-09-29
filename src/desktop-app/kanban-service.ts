import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import {
  archiveBoard,
  createBoard,
  deleteBoard,
  getBoardMeta,
  getCurrentBoard,
  listBoards,
  renameBoard,
  setCurrentBoard,
  updateBoardMeta,
} from "../agent/kanban/boards.js";
import { isValidBoardSlug, normalizeBoardSlug } from "../agent/kanban/paths.js";
import { fallbackDecomposer } from "../agent/kanban/decompose.js";
import { layaAwareDecomposer } from "../decision/kanban-triage.js";
import { dispatchOnce, type SpawnRequest } from "../agent/kanban/dispatch.js";
import { runKanbanGoalLoop, heuristicGoalJudge } from "../agent/kanban/goal.js";
import {
  buildWorkerPrompt,
  createKanbanWorkerTools,
} from "../agent/kanban/tools.js";
import { requestReview } from "../agent/kanban/review.js";
import { createSwarm } from "../agent/kanban/swarm.js";
import {
  closeAllBoardStores,
  openBoardStore,
  type KanbanStore,
} from "../agent/kanban/store.js";
import { resolveWorkspace } from "../agent/kanban/workspace.js";
import type {
  BoardSettings,
  CreateTaskInput,
  KanbanStatus,
  SwarmSpec,
} from "../agent/kanban/types.js";
import { CronStore } from "../agent/cron/index.js";
import { listProfileSummaries } from "../agent/profiles/index.js";
import { UI_COLUMNS } from "../agent/kanban/types.js";

export type KanbanServiceDeps = {
  getMainWindow: () => BrowserWindow | null;
  isAgentReady: () => boolean;
  /** Active profile home (for project registry). */
  getProfileHome: () => string;
  /** Agent application root (for tmp/project/<name>). */
  getArtifactHome: () => string;
  runWorkerTurn: (opts: {
    boardSlug: string;
    taskId: string;
    profileId: string;
    prompt: string;
    tools: ReturnType<typeof createKanbanWorkerTools>;
    workspaceCwd: string;
    goalMode: boolean;
    goalMaxTurns: number;
    store: KanbanStore;
    projectId?: string | null;
    artifactDir?: string | null;
  }) => Promise<void>;
};

let dispatcherTimer: ReturnType<typeof setInterval> | null = null;
let cronTimer: ReturnType<typeof setInterval> | null = null;
let cronStore: CronStore | null = null;
let activeUiBoard = "default";
const inflight = new Set<string>();
let dispatchRunning = false;

function resolveSafeBoard(slug?: string | null): string {
  const normalized = normalizeBoardSlug(slug || activeUiBoard || getCurrentBoard());
  if (!isValidBoardSlug(normalized) || !getBoardMeta(normalized)) {
    throw new Error(`Invalid or unknown board: ${slug ?? "(empty)"}`);
  }
  return normalized;
}

function emitKanbanChanged(
  getMainWindow: () => BrowserWindow | null,
  board?: string,
): void {
  const win = getMainWindow();
  win?.webContents.send("kanban:changed", {
    board: board ?? activeUiBoard,
    at: new Date().toISOString(),
  });
}

function emitCronChanged(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow();
  win?.webContents.send("cron:changed", { at: new Date().toISOString() });
}

function boardOrThrow(slug?: string | null): KanbanStore {
  const board = resolveSafeBoard(slug);
  activeUiBoard = board;
  return openBoardStore(board);
}

export function registerKanbanIpc(deps: KanbanServiceDeps): void {
  cronStore ??= new CronStore();

  ipcMain.handle("kanban:boards:list", async () => listBoards());
  ipcMain.handle(
    "kanban:boards:create",
    async (_e, payload?: { slug?: string; name?: string; description?: string; icon?: string; switchTo?: boolean }) => {
      const meta = createBoard({
        slug: payload?.slug ?? "",
        name: payload?.name,
        description: payload?.description,
        icon: payload?.icon,
        switchTo: payload?.switchTo,
      });
      if (payload?.switchTo) activeUiBoard = meta.slug;
      emitKanbanChanged(deps.getMainWindow, meta.slug);
      return meta;
    },
  );
  ipcMain.handle("kanban:boards:switch", async (_e, slug?: string) => {
    activeUiBoard = setCurrentBoard(String(slug ?? "default"));
    emitKanbanChanged(deps.getMainWindow, activeUiBoard);
    return { slug: activeUiBoard };
  });
  ipcMain.handle(
    "kanban:boards:rename",
    async (_e, payload?: { slug?: string; name?: string }) => {
      const meta = renameBoard(String(payload?.slug), String(payload?.name ?? ""));
      emitKanbanChanged(deps.getMainWindow, meta.slug);
      return meta;
    },
  );
  ipcMain.handle(
    "kanban:boards:update",
    async (
      _e,
      payload?: { slug?: string; name?: string; description?: string; icon?: string },
    ) => {
      const meta = updateBoardMeta(String(payload?.slug), {
        name: payload?.name,
        description: payload?.description,
        icon: payload?.icon,
      });
      emitKanbanChanged(deps.getMainWindow, meta.slug);
      return meta;
    },
  );
  ipcMain.handle("kanban:boards:archive", async (_e, slug?: string) => {
    archiveBoard(String(slug));
    activeUiBoard = getCurrentBoard();
    emitKanbanChanged(deps.getMainWindow, activeUiBoard);
    return { ok: true };
  });
  ipcMain.handle(
    "kanban:boards:delete",
    async (_e, payload?: { slug?: string; hard?: boolean }) => {
      if (payload?.hard) deleteBoard(String(payload.slug));
      else archiveBoard(String(payload?.slug));
      activeUiBoard = getCurrentBoard();
      emitKanbanChanged(deps.getMainWindow, activeUiBoard);
      return { ok: true };
    },
  );
  ipcMain.handle("kanban:boards:current", async () => ({
    slug: activeUiBoard || getCurrentBoard(),
  }));

  ipcMain.handle(
    "kanban:list",
    async (
      _e,
      payload?: {
        board?: string;
        tenant?: string | null;
        includeArchived?: boolean;
      },
    ) => {
      const store = boardOrThrow(payload?.board);
      const tasks = store.listTasks({
        tenant: payload?.tenant,
        includeArchived: payload?.includeArchived,
      });
      const enriched = tasks.map((t) => {
        const parents = store.getParents(t.id);
        const children = store.getChildren(t.id);
        const childrenDone = children.filter(
          (cid) => store.getTask(cid)?.status === "done",
        ).length;
        return {
          ...t,
          parentIds: parents,
          childIds: children,
          childrenDone,
          childrenTotal: children.length,
        };
      });
      const byStatus: Record<string, typeof enriched> = {};
      for (const col of UI_COLUMNS) byStatus[col] = [];
      byStatus.archived = [];
      for (const t of enriched) {
        (byStatus[t.status] ??= []).push(t);
      }
      return {
        board: store.boardSlug,
        columns: UI_COLUMNS,
        byStatus,
        tasks: enriched,
        settings: store.getSettings(),
      };
    },
  );

  ipcMain.handle(
    "kanban:get",
    async (_e, payload?: { board?: string; id?: string }) => {
      const store = boardOrThrow(payload?.board);
      return store.getDetail(String(payload?.id ?? ""));
    },
  );

  ipcMain.handle(
    "kanban:create",
    async (
      _e,
      payload?: CreateTaskInput & { board?: string },
    ) => {
      const store = boardOrThrow(payload?.board);
      const { board: _b, ...input } = payload ?? { title: "" };
      const task = store.createTask(input as CreateTaskInput);
      store.recomputeReady();
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:update",
    async (
      _e,
      payload?: {
        board?: string;
        id?: string;
        patch?: Record<string, unknown>;
      },
    ) => {
      const store = boardOrThrow(payload?.board);
      const task = store.updateTask(String(payload?.id), payload?.patch as never);
      store.recomputeReady();
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:move",
    async (
      _e,
      payload?: { board?: string; id?: string; status?: KanbanStatus },
    ) => {
      const store = boardOrThrow(payload?.board);
      const task = store.updateTask(String(payload?.id), {
        status: payload?.status as KanbanStatus,
      });
      store.recomputeReady();
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:delete",
    async (_e, payload?: { board?: string; id?: string }) => {
      const store = boardOrThrow(payload?.board);
      store.deleteTask(String(payload?.id));
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "kanban:comment",
    async (
      _e,
      payload?: { board?: string; id?: string; body?: string; author?: string },
    ) => {
      const store = boardOrThrow(payload?.board);
      const comment = store.addComment(
        String(payload?.id),
        String(payload?.body ?? ""),
        payload?.author ?? "user",
      );
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return comment;
    },
  );

  ipcMain.handle(
    "kanban:getSettings",
    async (_e, payload?: { board?: string }) => {
      const store = boardOrThrow(payload?.board);
      return store.getSettings();
    },
  );

  ipcMain.handle(
    "kanban:setSettings",
    async (
      _e,
      payload?: { board?: string; patch?: Partial<BoardSettings> },
    ) => {
      const store = boardOrThrow(payload?.board);
      const settings = store.setSettings(payload?.patch ?? {});
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return settings;
    },
  );

  ipcMain.handle("kanban:dispatchNow", async (_e, payload?: { max?: number }) => {
    const result = await runDispatchTick(deps, payload?.max ?? 8);
    emitKanbanChanged(deps.getMainWindow);
    return result;
  });

  ipcMain.handle(
    "kanban:requestReview",
    async (
      _e,
      payload?: {
        board?: string;
        id?: string;
        implementer?: string;
        reviewer?: string;
        summary?: string;
      },
    ) => {
      const store = boardOrThrow(payload?.board);
      const task = requestReview(store, {
        taskId: String(payload?.id),
        implementer: String(payload?.implementer ?? "user"),
        reviewer: payload?.reviewer,
        summary: payload?.summary,
      });
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:swarm",
    async (_e, payload?: SwarmSpec & { board?: string }) => {
      const store = boardOrThrow(payload?.board);
      const { board: _b, ...spec } = payload ?? {
        title: "",
        workers: [],
        verifier: "",
        synthesizer: "",
      };
      const result = createSwarm(store, spec as SwarmSpec);
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return result;
    },
  );

  ipcMain.handle(
    "kanban:schedule",
    async (
      _e,
      payload?: {
        board?: string;
        id?: string;
        scheduledAt?: string | null;
        /** When true (default), promote triage/todo/blocked → ready in the same write */
        promoteToReady?: boolean;
      },
    ) => {
      const store = boardOrThrow(payload?.board);
      const id = String(payload?.id);
      const existing = store.getTask(id);
      if (!existing) throw new Error(`Task ${id} not found`);
      const promote = payload?.promoteToReady !== false;
      const patch: {
        scheduledAt: string | null;
        status?: import("../agent/kanban/types.js").KanbanStatus;
      } = {
        scheduledAt: payload?.scheduledAt ?? null,
      };
      if (
        promote &&
        payload?.scheduledAt &&
        (existing.status === "triage" ||
          existing.status === "todo" ||
          existing.status === "blocked")
      ) {
        patch.status = "ready";
      }
      const task = store.updateTask(id, patch);
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:complete",
    async (
      _e,
      payload?: { board?: string; id?: string; summary?: string },
    ) => {
      const store = boardOrThrow(payload?.board);
      const task = store.completeTask(String(payload?.id), {
        summary: payload?.summary,
      });
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:block",
    async (
      _e,
      payload?: { board?: string; id?: string; reason?: string },
    ) => {
      const store = boardOrThrow(payload?.board);
      const task = store.blockTask(
        String(payload?.id),
        String(payload?.reason ?? "blocked"),
      );
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  ipcMain.handle(
    "kanban:unblock",
    async (_e, payload?: { board?: string; id?: string }) => {
      const store = boardOrThrow(payload?.board);
      const task = store.unblockTask(String(payload?.id));
      emitKanbanChanged(deps.getMainWindow, store.boardSlug);
      return task;
    },
  );

  // Cron IPC
  ipcMain.handle("cron:list", async () => cronStore!.list());
  ipcMain.handle(
    "cron:create",
    async (
      _e,
      payload?: {
        name?: string;
        schedule?: import("../agent/cron/index.js").CronSchedule;
        action?: import("../agent/kanban/cron-bridge.js").CronKanbanAction;
        enabled?: boolean;
      },
    ) => {
      if (!payload?.schedule || !payload?.action) {
        throw new Error("cron:create requires schedule and action");
      }
      const board = resolveSafeBoard(payload.action.board);
      const action = { ...payload.action, board };
      const job = cronStore!.create({
        name: String(payload?.name ?? "job"),
        schedule: payload.schedule,
        action,
        enabled: payload?.enabled,
      });
      emitCronChanged(deps.getMainWindow);
      return job;
    },
  );
  ipcMain.handle(
    "cron:update",
    async (_e, payload?: { id?: string; patch?: Record<string, unknown> }) => {
      const job = cronStore!.update(String(payload?.id), payload?.patch as never);
      emitCronChanged(deps.getMainWindow);
      return job;
    },
  );
  ipcMain.handle("cron:remove", async (_e, id?: string) => {
    cronStore!.remove(String(id));
    emitCronChanged(deps.getMainWindow);
    return { ok: true };
  });
  ipcMain.handle("cron:tickNow", async () => {
    const results = cronStore!.tick();
    emitCronChanged(deps.getMainWindow);
    emitKanbanChanged(deps.getMainWindow);
    return results;
  });
}

async function spawnWorker(
  deps: KanbanServiceDeps,
  req: SpawnRequest,
): Promise<void> {
  const key = `${req.boardSlug}:${req.task.id}`;
  if (inflight.has(key)) {
    throw new Error(`Worker already in flight for ${key}`);
  }
  inflight.add(key);

  const store = openBoardStore(req.boardSlug);
  const settings = store.getSettings();
  const profileId = req.task.assignee || settings.defaultAssignee || "default";
  let terminated = false;

  const tools = createKanbanWorkerTools({
    store,
    taskId: req.task.id,
    boardSlug: req.boardSlug,
    profileId,
    mode: req.mode === "review" ? "review" : "implement",
    onTerminal: () => {
      terminated = true;
    },
  });

  let workspaceCwd = process.cwd();
  let artifactDir: string | null = null;
  try {
    const ws = resolveWorkspace(req.task, req.boardSlug, {
      defaultWorkdir: settings.defaultWorkdir || undefined,
      profileHome: deps.getProfileHome(),
      artifactHome: deps.getArtifactHome(),
    });
    workspaceCwd = ws.cwd;
    artifactDir = ws.artifactDir ?? null;
  } catch (err) {
    store.recordSpawnFailed(
      req.task.id,
      err instanceof Error ? err.message : String(err),
    );
    inflight.delete(key);
    return;
  }

  const prompt = buildWorkerPrompt({
    taskId: req.task.id,
    boardSlug: req.boardSlug,
    mode: req.mode,
    reviewRound: req.reviewRound,
    reviewLens: req.reviewLens,
    projectId: req.task.projectId,
    workspaceCwd,
    artifactDir,
  });

  try {
    if (req.task.goalMode && req.mode === "implement") {
      await runKanbanGoalLoop({
        store,
        taskId: req.task.id,
        initialPrompt: prompt,
        isTerminated: () => terminated || store.getTask(req.task.id)?.status !== "running",
        judge: heuristicGoalJudge(),
        runTurn: async ({ prompt: p }) => {
          await deps.runWorkerTurn({
            boardSlug: req.boardSlug,
            taskId: req.task.id,
            profileId,
            prompt: p,
            tools,
            workspaceCwd,
            goalMode: true,
            goalMaxTurns: req.task.goalMaxTurns,
            store,
            projectId: req.task.projectId,
            artifactDir,
          });
          return store.getTask(req.task.id)?.result ?? "turn finished";
        },
      });
    } else {
      await deps.runWorkerTurn({
        boardSlug: req.boardSlug,
        taskId: req.task.id,
        profileId,
        prompt,
        tools,
        workspaceCwd,
        goalMode: false,
        goalMaxTurns: req.task.goalMaxTurns,
        store,
        projectId: req.task.projectId,
        artifactDir,
      });
      // Protocol violation if still running after clean exit
      const after = store.getTask(req.task.id);
      if (after?.status === "running") {
        store.recordProtocolViolation(req.task.id);
      }
    }
  } catch (err) {
    store.recordSpawnFailed(
      req.task.id,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    inflight.delete(key);
    emitKanbanChanged(deps.getMainWindow, req.boardSlug);
  }
}

async function runDispatchTick(
  deps: KanbanServiceDeps,
  max = 8,
): Promise<unknown> {
  if (!deps.isAgentReady()) {
    return { skipped: true, reason: "agent not ready" };
  }
  if (dispatchRunning) {
    return { skipped: true, reason: "dispatch already running" };
  }
  dispatchRunning = true;
  try {
    const profiles = listProfileSummaries().map((p) => ({
      id: p.id,
      description: p.soulPreview?.slice(0, 200),
    }));
    return await dispatchOnce({
      maxPerTick: max,
      profiles,
      decomposer: layaAwareDecomposer(fallbackDecomposer()),
      spawn: (req) => spawnWorker(deps, req),
    });
  } finally {
    dispatchRunning = false;
  }
}

export function startKanbanDispatcher(deps: KanbanServiceDeps): void {
  if (dispatcherTimer) return;
  dispatcherTimer = setInterval(() => {
    void runDispatchTick(deps).then(() => {
      emitKanbanChanged(deps.getMainWindow);
    });
  }, 60_000);
  // First tick shortly after boot
  setTimeout(() => {
    void runDispatchTick(deps).then(() => {
      emitKanbanChanged(deps.getMainWindow);
    });
  }, 5_000);
}

export function startCronScheduler(deps: KanbanServiceDeps): void {
  cronStore ??= new CronStore();
  if (cronTimer) return;
  cronTimer = setInterval(() => {
    const results = cronStore!.tick();
    if (results.length) {
      emitCronChanged(deps.getMainWindow);
      emitKanbanChanged(deps.getMainWindow);
    }
  }, 30_000);
}

export function stopKanbanServices(): void {
  if (dispatcherTimer) {
    clearInterval(dispatcherTimer);
    dispatcherTimer = null;
  }
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
  try {
    cronStore?.close();
  } catch {
    /* ignore */
  }
  cronStore = null;
  closeAllBoardStores();
}
