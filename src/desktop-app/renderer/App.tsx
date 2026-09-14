import React, { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody.js";
import {
  CompactActivityChip,
  TraceCard,
  phaseColor,
  shouldMirrorInChat,
  groupActivityEntries,
  type AgentPhase,
  type AgentUiEvent,
} from "./ActivityChips.js";
import {
  PhasePill,
  StreamingCaret,
  TypingDots,
  WaitingCard,
} from "./WaitingIndicator.js";
import { ReasoningBlock } from "./ReasoningBlock.js";
import { CapabilitiesView } from "./CapabilitiesView.js";
import { ArtifactsView, type ArtifactRecord } from "./ArtifactsView.js";
import { SettingsView } from "./SettingsView.js";
import {
  ActivityCanvas,
  artifactToCanvasTab,
  type CanvasTab,
} from "./ActivityCanvas.js";
import {
  asRecord,
  canvasResultRank,
  inferPreviewKind,
  languageForExt,
  extensionOf,
  basenamePath,
  pickAutoFocusArtifact,
  preferCanvasPath,
  normalizeCanvasKey,
  resolveArtifactsFromTool,
  shouldAutoFocusCanvas,
  type ActivityArtifact,
} from "./activity-artifact.js";
import { isPlanApprovalInterrupt } from "../../agent/interrupt-utils.js";
import { shouldRenderAsReasoning } from "../../agent/sanitize-output.js";
import {
  emptySessionSnap,
  reduceSessionEvent,
  type SessionUiSnap,
} from "./session-ui-state.js";

type DesktopAgentEvent = AgentUiEvent & { threadId?: string };

declare global {
  interface Window {
    electronAgent?: {
      sendPrompt: (
        prompt: string,
      ) => Promise<{
        ok: boolean;
        content?: string;
        error?: string;
        threadId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
      }>;
      getStatus: () => Promise<{
        bridge: boolean;
        agentReady: boolean;
        error: string | null;
        model: string;
        workspaceRoot: string;
        busy?: boolean;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
      }>;
      getBots?: () => Promise<
        Array<{
          id: string;
          name: string;
          description: string;
          specialized?: boolean;
          threadId?: string | null;
          preview?: string;
          turnCount?: number;
          updatedAt?: string | null;
          tools?: string[];
        }>
      >;
      setActiveBot?: (id: string) => Promise<{
        ok: boolean;
        activeBotId: string;
        threadId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        events?: TranscriptRow[];
        error?: string;
      }>;
      getLearnedRules?: () => Promise<Array<{ id: string; kind: string; title: string; content: string; updatedAt: string; tags: string[] }>>;
      getSettings?: () => Promise<{
        model: {
          agentModel: string;
          routerBaseUrl: string;
          routerApiKeyConfigured: boolean;
          routerApiKeyMasked: string;
          embeddingModel: string;
          visionModel: string;
          contextWindowTokens: number;
        };
        agent: {
          autoApproveDestructive: boolean;
          requirePlanApproval: boolean;
          enableReflection: boolean;
          enableCheckpointer: boolean;
        };
        sandbox: {
          ptyTimeoutMs: number;
          ptyPoolSize: number;
          ptyShell: string;
          allowedFolders: string[];
        };
        desktop: { enabled: boolean; apps: string[] };
        memory: {
          enableReflection: boolean;
          agentsMd: string;
          agentsMdPath: string;
        };
        ui: {
          defaultRailOpen: boolean;
          defaultRailLayer: "trace" | "canvas";
          compactActivity: boolean;
        };
        bots: Array<{
          id: string;
          name: string;
          description: string;
          systemPrompt?: string;
          tools?: string[];
        }>;
        toolCatalog: Array<{
          name: string;
          category: string;
          description: string;
        }>;
        paths: Record<string, string>;
        reloadRequiredHint: string;
      }>;
      updateSettings?: (payload: unknown) => Promise<{
        ok: boolean;
        error?: string;
        reloaded?: boolean;
        reloadReason?: string;
        snapshot?: Awaited<
          NonNullable<Window["electronAgent"]>["getSettings"]
        > extends () => Promise<infer R>
          ? R
          : never;
      }>;
      listSessions?: () => Promise<{
        activeThreadId: string;
        activeBotId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        sessions: Array<{
          threadId: string;
          updatedAt: string;
          preview: string;
          turnCount: number;
        }>;
      }>;
      newSession?: () => Promise<{
        ok: boolean;
        threadId?: string;
        activeBotId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        error?: string;
      }>;
      openSession?: (
        threadId: string,
      ) => Promise<{
        ok: boolean;
        threadId?: string;
        activeBotId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        busy?: boolean;
        error?: string;
        events?: TranscriptRow[];
      }>;
      listProcesses?: () => Promise<{
        processes: ManagedProcessRow[];
      }>;
      pollProcess?: (
        pid: number,
      ) => Promise<{ ok: boolean; detail: string }>;
      killProcess?: (
        pid: number,
      ) => Promise<{ ok: boolean; detail: string }>;
      listCapabilities?: () => Promise<{
        skills: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        tools: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        mcp: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        counts: { skills: number; tools: number; mcp: number };
      }>;
      listArtifacts?: () => Promise<{
        artifacts: ArtifactRecord[];
        counts: {
          all: number;
          images: number;
          files: number;
          links: number;
        };
      }>;
      setCapabilityEnabled?: (
        id: string,
        enabled: boolean,
      ) => Promise<{
        ok: boolean;
        error?: string;
        skills?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        tools?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        mcp?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        counts?: { skills: number; tools: number; mcp: number };
        reloaded?: boolean;
        reloadReason?: string;
      }>;
      readWorkspacePreview?: (filePath: string) => Promise<{
        ok: boolean;
        error?: string;
        path?: string;
        basename?: string;
        ext?: string;
        kind?:
          | "markdown"
          | "code"
          | "html"
          | "csv"
          | "spreadsheet"
          | "document"
          | "image"
          | "text"
          | "unsupported";
        language?: string;
        text?: string;
        html?: string;
        dataUrl?: string;
        sheets?: Array<{ name: string; rows: string[][] }>;
        truncated?: boolean;
        note?: string;
      }>;
      discoverDeliverables?: (payload: {
        texts?: string[];
        command?: string;
        maxAgeMs?: number;
      }) => Promise<{ ok: boolean; paths: string[] }>;
      resolveApproval?: (
        approve: boolean,
        threadId?: string,
      ) => Promise<{
        ok: boolean;
        approve?: boolean;
        threadId?: string;
        error?: string;
      }>;
      onEvent: (callback: (event: DesktopAgentEvent) => void) => () => void;
    };
  }
}

type ManagedProcessRow = {
  pid: number;
  command: string;
  startedAt: string;
  source: "process_manage" | "pty";
  slot?: number;
  status: "running" | "exited" | "killed";
  logPreview: string;
};

type TranscriptRow = {
  ts: string;
  role: string;
  content: string;
  meta?: { uiEvent?: AgentUiEvent; [key: string]: unknown };
};

type ActivityRow = { id: string; event: AgentUiEvent; at: string };

type ChatItem =
  | { id: string; kind: "user"; text: string; at: string }
  | { id: string; kind: "assistant"; text: string; at: string }
  | { id: string; kind: "system"; text: string; at: string }
  | { id: string; kind: "reasoning"; text: string; at: string; label?: string }
  | { id: string; kind: "trace"; event: AgentUiEvent; at: string };

type BridgeStatus = {
  connected: boolean;
  agentReady: boolean;
  error: string | null;
  model: string;
  workspaceRoot: string;
};

function now() {
  return new Date().toLocaleTimeString();
}

export function App() {
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: "welcome",
      kind: "assistant",
      text: "Agent Desktop ready. Ask a task — thinking, reasoning, and tool calls stream live on the right.",
      at: now(),
    },
  ]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activeTab, setActiveTab] = useState<"sessions" | "bots" | "learned">("sessions");
  const [learnedRules, setLearnedRules] = useState<
    Array<{ id: string; kind: string; title: string; content: string; updatedAt: string; tags: string[] }>
  >([]);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [bots, setBots] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      specialized?: boolean;
      threadId?: string | null;
      preview?: string;
      turnCount?: number;
      updatedAt?: string | null;
      tools?: string[];
    }>
  >([]);
  const [selectedBotId, setSelectedBotId] = useState("general");
  const specializedBots = useMemo(
    () => bots.filter((b) => b.specialized === true),
    [bots],
  );
  const inBotSession = selectedBotId !== "general";
  const [sessions, setSessions] = useState<
    Array<{ threadId: string; updatedAt: string; preview: string; turnCount: number }>
  >([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [busyThreadIds, setBusyThreadIds] = useState<string[]>([]);
  const [threadPhases, setThreadPhases] = useState<
    Record<string, AgentPhase>
  >({});
  const [processes, setProcesses] = useState<ManagedProcessRow[]>([]);
  const [processPanelOpen, setProcessPanelOpen] = useState(false);
  const [processDetail, setProcessDetail] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [railLayer, setRailLayer] = useState<"trace" | "canvas">("trace");
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [planApprovalPending, setPlanApprovalPending] = useState(false);
  const [planApprovalBusy, setPlanApprovalBusy] = useState(false);
  const [mainView, setMainView] = useState<
    "chat" | "capabilities" | "artifacts" | "settings"
  >("chat");
  const stickToBottom = useRef(true);

  const openCanvas = (tab: CanvasTab, switchLayer = true) => {
    const key = normalizeCanvasKey(tab.path) || tab.id;
    setCanvasTabs((prev) => {
      const existing = prev.find(
        (t) =>
          t.id === key ||
          normalizeCanvasKey(t.path) === key ||
          t.id === tab.id,
      );
      if (existing) {
        return prev.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                id: key,
                path: preferCanvasPath(t.path, tab.path),
                basename: tab.basename || t.basename,
                inlineContent: tab.inlineContent ?? t.inlineContent,
                kind: tab.kind,
                language: tab.language,
              }
            : t,
        );
      }
      return [...prev, { ...tab, id: key }].slice(-12);
    });
    setActiveCanvasId(key);
    if (switchLayer) setRailLayer("canvas");
  };
  const openCanvasRef = useRef(openCanvas);
  openCanvasRef.current = openCanvas;

  const openDiscoveredDeliverables = async (payload: {
    texts?: string[];
    command?: string;
  }) => {
    const api = window.electronAgent?.discoverDeliverables;
    if (!api) return;
    try {
      const res = await api(payload);
      if (!res?.ok || !res.paths?.length) return;
      let first = true;
      for (const p of res.paths) {
        const ext = extensionOf(p);
        const kind = inferPreviewKind(ext);
        if (kind === "code" || kind === "unsupported") continue;
        openCanvasRef.current(
          {
            id: normalizeCanvasKey(p) || p,
            path: p,
            basename: basenamePath(p),
            kind,
            language: languageForExt(ext),
          },
          first && shouldAutoFocusCanvas(kind),
        );
        first = false;
      }
    } catch {
      /* ignore discovery errors */
    }
  };
  const openDiscoveredRef = useRef(openDiscoveredDeliverables);
  openDiscoveredRef.current = openDiscoveredDeliverables;

  const refreshBots = async () => {
    if (!window.electronAgent?.getBots) return;
    const b = await window.electronAgent.getBots();
    if (b) setBots(b);
  };

  useEffect(() => {
    void refreshBots();
    if (window.electronAgent?.getLearnedRules) {
      window.electronAgent.getLearnedRules().then((r) => r && setLearnedRules(r));
    }
    if (window.electronAgent?.getSettings) {
      void window.electronAgent.getSettings().then((s) => {
        if (!s?.ui) return;
        setRailOpen(s.ui.defaultRailOpen);
        setRailLayer(s.ui.defaultRailLayer);
      });
    }
  }, []);

  const refreshSessions = async () => {
    if (!window.electronAgent?.listSessions) return;
    const res = await window.electronAgent.listSessions();
    setSessions(res.sessions);
    setActiveThreadId(res.activeThreadId);
    if (res.activeBotId) setSelectedBotId(res.activeBotId);
    if (res.busyThreadIds !== undefined || res.busyThreadId !== undefined) {
      setBusyThreadIds(
        Array.isArray(res.busyThreadIds)
          ? res.busyThreadIds
          : res.busyThreadId
            ? [res.busyThreadId]
            : [],
      );
    }
    return res;
  };

  const refreshProcesses = async () => {
    if (!window.electronAgent?.listProcesses) return;
    const res = await window.electronAgent.listProcesses();
    setProcesses(res.processes ?? []);
  };

  useEffect(() => {
    void refreshProcesses();
    const id = window.setInterval(() => {
      void refreshProcesses();
    }, 2500);
    return () => window.clearInterval(id);
  }, []);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>("boot");
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    agentReady: false,
    error: null,
    model: "…",
    workspaceRoot: "…",
  });

  const streamRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  const pendingToolsRef = useRef<Array<{ name: string; input: unknown }>>([]);
  /** Deliverable paths (.docx etc.) referenced by generator scripts, opened after execute. */
  const pendingDeliverablesRef = useRef<string[]>([]);
  const activeThreadIdRef = useRef("");
  const busyThreadIdsRef = useRef<string[]>([]);
  const threadPhasesRef = useRef<Record<string, AgentPhase>>({});
  const sessionCacheRef = useRef<Map<string, SessionUiSnap>>(new Map());
  const liveUiRef = useRef({
    items,
    activity,
    phase: "boot" as AgentPhase,
    planApprovalPending: false,
    canvasTabs,
    activeCanvasId,
    railLayer,
    loading: false,
  });

  activeThreadIdRef.current = activeThreadId;
  busyThreadIdsRef.current = busyThreadIds;
  threadPhasesRef.current = threadPhases;
  liveUiRef.current = {
    items,
    activity,
    phase,
    planApprovalPending,
    canvasTabs,
    activeCanvasId,
    railLayer,
    loading,
  };

  const captureLiveSnap = (): SessionUiSnap => ({
    ...liveUiRef.current,
    draftAnswer: draftRef.current,
    pendingTools: [...pendingToolsRef.current],
    pendingDeliverables: [...pendingDeliverablesRef.current],
  });

  const applySessionSnap = (snap: SessionUiSnap) => {
    setItems(snap.items);
    setActivity(snap.activity);
    draftRef.current = snap.draftAnswer;
    setDraftAnswer(snap.draftAnswer);
    setPhase(snap.phase);
    setPlanApprovalPending(snap.planApprovalPending);
    setCanvasTabs(snap.canvasTabs);
    setActiveCanvasId(snap.activeCanvasId);
    setRailLayer(snap.railLayer);
    pendingToolsRef.current = [...snap.pendingTools];
    pendingDeliverablesRef.current = [...snap.pendingDeliverables];
    setLoading(snap.loading);
  };

  const stashCurrentSession = () => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    sessionCacheRef.current.set(id, captureLiveSnap());
  };

  const normalizeBusyIds = (
    ids?: string[] | null,
    legacy?: string | null,
  ): string[] => {
    if (Array.isArray(ids)) {
      return [...new Set(ids.filter(Boolean))];
    }
    if (legacy) return [legacy];
    return [];
  };

  const syncBusyFromPayload = (
    ids?: string[] | null,
    legacy?: string | null,
  ) => {
    const next = normalizeBusyIds(ids, legacy);
    busyThreadIdsRef.current = next;
    setBusyThreadIds(next);
  };

  const addBusyThread = (id: string, phase: AgentPhase = "thinking") => {
    if (!id) return;
    if (!busyThreadIdsRef.current.includes(id)) {
      const next = [...busyThreadIdsRef.current, id];
      busyThreadIdsRef.current = next;
      setBusyThreadIds(next);
    }
    const phases = { ...threadPhasesRef.current, [id]: phase };
    threadPhasesRef.current = phases;
    setThreadPhases(phases);
  };

  const removeBusyThread = (id: string) => {
    if (!id) return;
    const next = busyThreadIdsRef.current.filter((t) => t !== id);
    busyThreadIdsRef.current = next;
    setBusyThreadIds(next);
    if (threadPhasesRef.current[id]) {
      const phases = { ...threadPhasesRef.current };
      delete phases[id];
      threadPhasesRef.current = phases;
      setThreadPhases(phases);
    }
  };

  const setThreadPhase = (id: string, nextPhase: AgentPhase) => {
    if (!id) return;
    if (threadPhasesRef.current[id] === nextPhase) return;
    const phases = { ...threadPhasesRef.current, [id]: nextPhase };
    threadPhasesRef.current = phases;
    setThreadPhases(phases);
  };

  const isThreadBusy = (id: string) => busyThreadIdsRef.current.includes(id);

  const applyTranscript = (events: TranscriptRow[]) => {
    pendingToolsRef.current = [];
    const restoredItems: ChatItem[] = [];
    const activityRows: ActivityRow[] = [];
    const pendingTools: Array<{ name: string; input: unknown }> = [];

    for (const ev of events) {
      const at = new Date(ev.ts).toLocaleTimeString();
      if (ev.role === "user") {
        restoredItems.push({
          id: `u-${ev.ts}-${restoredItems.length}`,
          kind: "user",
          text: ev.content,
          at,
        });
        continue;
      }
      if (ev.role === "assistant") {
        if (shouldRenderAsReasoning(ev.content)) {
          restoredItems.push({
            id: `r-${ev.ts}-${restoredItems.length}`,
            kind: "reasoning",
            text: ev.content,
            at,
            label: "Model notice",
          });
        } else {
          restoredItems.push({
            id: `a-${ev.ts}-${restoredItems.length}`,
            kind: "assistant",
            text: ev.content,
            at,
          });
        }
        continue;
      }
      if (ev.role === "error") {
        restoredItems.push({
          id: `e-${ev.ts}-${restoredItems.length}`,
          kind: "system",
          text: ev.content,
          at,
        });
        continue;
      }
      if (ev.role !== "tool") continue;
      const ui = ev.meta?.uiEvent;
      if (!ui || typeof ui !== "object" || !("type" in ui)) continue;

      activityRows.push({
        id: `act-${ev.ts}-${activityRows.length}`,
        event: ui,
        at,
      });

      if (ui.type === "tool_start") {
        pendingTools.push({ name: ui.name, input: ui.input });
      } else if (ui.type === "tool_end") {
        let input: unknown = {};
        for (let i = pendingTools.length - 1; i >= 0; i -= 1) {
          if (pendingTools[i]!.name === ui.name) {
            input = pendingTools[i]!.input;
            pendingTools.splice(i, 1);
            break;
          }
        }
        restoredItems.push({
          id: `t-${ev.ts}-${restoredItems.length}`,
          kind: "trace",
          event: { type: "tool_start", name: ui.name, input },
          at,
        });
      } else if (shouldMirrorInChat(ui)) {
        restoredItems.push({
          id: `t-${ev.ts}-${restoredItems.length}`,
          kind: "trace",
          event: ui,
          at,
        });
      }
    }

    setItems(
      restoredItems.length
        ? restoredItems
        : [
            {
              id: "empty",
              kind: "assistant",
              text: "Empty session — send a message to start.",
              at: now(),
            },
          ],
    );
    setActivity(activityRows.length > 200 ? activityRows.slice(-200) : activityRows);
  };

  const restoreThreadView = (
    threadId: string,
    events: TranscriptRow[] | undefined,
    busyIds?: string[] | null,
    legacyBusyId?: string | null,
  ) => {
    if (busyIds !== undefined || legacyBusyId !== undefined) {
      syncBusyFromPayload(busyIds, legacyBusyId);
    }
    const threadBusy = isThreadBusy(threadId);
    const cached = sessionCacheRef.current.get(threadId);
    const turnLive = threadBusy || Boolean(cached?.loading);
    if (turnLive && cached) {
      applySessionSnap({
        ...cached,
        loading: threadBusy || cached.loading,
      });
      if (threadBusy) setThreadPhase(threadId, cached.phase);
      return;
    }
    applyTranscript(events ?? []);
    draftRef.current = "";
    pendingToolsRef.current = [];
    pendingDeliverablesRef.current = [];
    setDraftAnswer("");
    setPlanApprovalPending(false);
    setLoading(threadBusy);
    if (!threadBusy) {
      setPhase("boot");
    }
  };

  useEffect(() => {
    void (async () => {
      const res = await refreshSessions();
      if (!res?.activeThreadId || !window.electronAgent?.openSession) return;
      const opened = await window.electronAgent.openSession(res.activeThreadId);
      if (!opened.ok) return;
      if ((opened.events?.length ?? 0) > 0) {
        applyTranscript(opened.events ?? []);
      }
    })();
  }, []);

  const handleNewSession = async () => {
    if (!window.electronAgent?.newSession) return;
    stashCurrentSession();
    const res = await window.electronAgent.newSession();
    if (!res.ok || !res.threadId) return;
    syncBusyFromPayload(res.busyThreadIds, res.busyThreadId);
    activeThreadIdRef.current = res.threadId;
    setActiveThreadId(res.threadId);
    setSelectedBotId(res.activeBotId || "general");
    setActiveTab("sessions");
    setMainView("chat");
    setItems([
      {
        id: "welcome",
        kind: "assistant",
        text: "New session. What's the goal?",
        at: now(),
      },
    ]);
    setActivity([]);
    draftRef.current = "";
    pendingToolsRef.current = [];
    pendingDeliverablesRef.current = [];
    setDraftAnswer("");
    setPlanApprovalPending(false);
    setLoading(false);
    setPhase("boot");
    stickToBottom.current = true;
    await refreshSessions();
    await refreshBots();
  };

  const handleOpenSession = async (threadId: string) => {
    if (threadId === activeThreadIdRef.current) return;
    if (!window.electronAgent?.openSession) return;
    stashCurrentSession();
    activeThreadIdRef.current = threadId;
    setLoading(false);
    const res = await window.electronAgent.openSession(threadId);
    if (!res.ok) return;
    const nextId = res.threadId || threadId;
    activeThreadIdRef.current = nextId;
    setActiveThreadId(nextId);
    setSelectedBotId(res.activeBotId || "general");
    setActiveTab(
      res.activeBotId && res.activeBotId !== "general" ? "bots" : "sessions",
    );
    setMainView("chat");
    restoreThreadView(nextId, res.events, res.busyThreadIds, res.busyThreadId);
    stickToBottom.current = true;
    await refreshSessions();
    await refreshBots();
  };

  const handleOpenBot = async (botId: string) => {
    if (!window.electronAgent?.setActiveBot) return;
    if (botId === selectedBotId && activeTab === "bots") return;
    stashCurrentSession();
    const res = await window.electronAgent.setActiveBot(botId);
    if (!res.ok) return;
    setSelectedBotId(res.activeBotId || botId);
    if (res.threadId) {
      activeThreadIdRef.current = res.threadId;
      setActiveThreadId(res.threadId);
    }
    setActiveTab("bots");
    setMainView("chat");
    if (res.threadId) {
      restoreThreadView(
        res.threadId,
        res.events,
        res.busyThreadIds,
        res.busyThreadId,
      );
    }
    stickToBottom.current = true;
    await refreshSessions();
    await refreshBots();
  };

  const handleReturnToSessions = async () => {
    if (!window.electronAgent?.setActiveBot) return;
    stashCurrentSession();
    const res = await window.electronAgent.setActiveBot("general");
    if (!res.ok) return;
    setSelectedBotId("general");
    if (res.threadId) {
      activeThreadIdRef.current = res.threadId;
      setActiveThreadId(res.threadId);
      restoreThreadView(
        res.threadId,
        res.events,
        res.busyThreadIds,
        res.busyThreadId,
      );
    }
    setActiveTab("sessions");
    stickToBottom.current = true;
    await refreshSessions();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.electronAgent?.getStatus) {
        setStatus({
          connected: false,
          agentReady: false,
          error: "Preload bridge missing. Run npm run desktop:start.",
          model: "demo",
          workspaceRoot: "(browser preview)",
        });
        return;
      }
      try {
        const s = await window.electronAgent.getStatus();
        if (cancelled) return;
        setStatus({
          connected: true,
          agentReady: s.agentReady,
          error: s.error,
          model: s.model,
          workspaceRoot: s.workspaceRoot,
        });
      } catch (e) {
        if (cancelled) return;
        setStatus({
          connected: false,
          agentReady: false,
          error: e instanceof Error ? e.message : String(e),
          model: "unknown",
          workspaceRoot: "unknown",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAgent?.onEvent) return;
    return window.electronAgent.onEvent((event) => {
      const at = now();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const tid = event.threadId || activeThreadIdRef.current;

      if (event.type === "status" && event.detail === "turn started" && tid) {
        addBusyThread(tid, "thinking");
      }
      if (event.type === "status" && tid) {
        setThreadPhase(tid, event.phase);
      }
      if (
        tid &&
        (event.type === "done" ||
          event.type === "error" ||
          (event.type === "status" &&
            (event.phase === "done" || event.phase === "error")))
      ) {
        removeBusyThread(tid);
      }

      const isLive = !tid || tid === activeThreadIdRef.current;
      if (!isLive) {
        const base = sessionCacheRef.current.get(tid) ?? emptySessionSnap();
        const reduced = reduceSessionEvent(base, event, { id, at });
        sessionCacheRef.current.set(tid, reduced);
        return;
      }

      if (event.type === "status") {
        setPhase(event.phase);
        if (
          event.phase === "waiting_approval" &&
          /plan approval/i.test(event.detail)
        ) {
          setPlanApprovalPending(true);
          setRailLayer("canvas");
          setRailOpen(true);
        }
        if (event.phase === "done" || event.phase === "error") {
          setPlanApprovalPending(false);
          setLoading(false);
        }
        if (event.detail === "turn started") {
          setLoading(true);
        }
      }

      if (event.type === "interrupt") {
        if (isPlanApprovalInterrupt(event.payload)) {
          setPlanApprovalPending(true);
          setRailLayer("canvas");
          setRailOpen(true);
        }
      }

      if (event.type === "token") {
        draftRef.current += event.text;
        setDraftAnswer(draftRef.current);
      }

      if (event.type === "done") {
        const finalText = (event.text || draftRef.current).trim();
        draftRef.current = "";
        setDraftAnswer("");
        setLoading(false);
        if (finalText && shouldRenderAsReasoning(finalText)) {
          setItems((prev) => [
            ...prev,
            {
              id,
              kind: "reasoning",
              text: finalText,
              at,
              label: "Model notice",
            },
          ]);
        } else {
          setItems((prev) => [
            ...prev,
            {
              id,
              kind: "assistant",
              text: finalText || "(empty response)",
              at,
            },
          ]);
        }
        setPhase("done");
        // Final answer often cites the deliverable path — open it in Canvas.
        if (finalText) {
          void openDiscoveredRef.current({ texts: [finalText] });
        }
      }

      if (event.type === "warning" && /retrying/i.test(event.message)) {
        draftRef.current = "";
        setDraftAnswer("");
      }

      if (event.type === "error") {
        setItems((prev) => [
          ...prev,
          { id, kind: "system", text: event.message, at },
        ]);
        setPhase("error");
        setLoading(false);
      }

      // Keep a dense live activity log (skip raw token spam — shown as draft)
      if (event.type !== "token") {
        setActivity((prev) => {
          const next = [...prev, { id, event, at }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }

      if (event.type === "tool_start") {
        pendingToolsRef.current.push({ name: event.name, input: event.input });
      }

      // Chat only gets compact one-liners (Cursor-style), not JSON dumps
      if (
        event.type === "tool_end" &&
        (event.name === "process_manage" || event.name === "execute")
      ) {
        void refreshProcesses();
      }

      if (event.type === "tool_end") {
        const pending = pendingToolsRef.current;
        let input: unknown = {};
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (pending[i]!.name === event.name) {
            input = pending[i]!.input;
            pending.splice(i, 1);
            break;
          }
        }
        const artifacts = resolveArtifactsFromTool({
          name: event.name,
          input,
          output: event.output,
        });

        // Show coding plan in Canvas right after task_plan saves.
        if (event.name === "task_plan") {
          const args = asRecord(input);
          const goal = String(args.goal ?? "").trim();
          const plan = String(args.plan ?? "").trim();
          const skills = Array.isArray(args.skillsUsed)
            ? args.skillsUsed.map(String).filter(Boolean)
            : [];
          if (plan || goal) {
            const md = [
              "# Implementation plan",
              "",
              goal ? `**Goal:** ${goal}` : "",
              skills.length ? `**Skills:** ${skills.join(", ")}` : "",
              "",
              plan || "_(empty plan)_",
              "",
              "---",
              "",
              "_Waiting for **Approve plan** before creating todos / coding._",
            ]
              .filter(Boolean)
              .join("\n");
            openCanvasRef.current(
              {
                id: "plan:.agent/task/board.md",
                path: ".agent/task/board.md",
                basename: "Plan",
                kind: "markdown",
                language: "markdown",
                inlineContent: md,
              },
              true,
            );
            setPlanApprovalPending(true);
          }
        }

        const isFileWrite =
          event.name === "write_file" ||
          event.name === "write" ||
          event.name === "edit_file" ||
          event.name === "edit";
        const wroteCode = artifacts.some((a) => a.kind === "code");

        // Generator scripts (.py/.js) often name the real output — open after execute.
        if (wroteCode && isFileWrite) {
          for (const a of artifacts) {
            if (
              shouldAutoFocusCanvas(a.kind) &&
              !pendingDeliverablesRef.current.includes(a.path)
            ) {
              pendingDeliverablesRef.current.push(a.path);
            }
          }
        }

        const merged: ActivityArtifact[] = [...artifacts];
        const isShell =
          event.name === "execute" ||
          event.name === "shell" ||
          event.name === "bash";
        if (isShell) {
          for (const p of pendingDeliverablesRef.current) {
            if (!merged.some((a) => a.path === p)) {
              const ext = extensionOf(p);
              merged.push({
                path: p,
                basename: basenamePath(p),
                ext,
                kind: inferPreviewKind(ext),
                language: languageForExt(ext),
                source: "path_only",
              });
            }
          }
          merged.sort(
            (a, b) => canvasResultRank(b.kind) - canvasResultRank(a.kind),
          );
          pendingDeliverablesRef.current = [];
        }

        const focus = pickAutoFocusArtifact(merged);
        for (const a of merged) {
          // Never auto-open generator/source code — show the hasil (docx/md/…).
          if (a.kind === "code" || a.kind === "unsupported") continue;
          // Referenced outputs inside a script: wait until shell runs.
          if (wroteCode && isFileWrite && a.source === "path_only") continue;
          openCanvasRef.current(
            artifactToCanvasTab(a),
            focus?.path === a.path,
          );
        }

        // Shell: also discover deliverables by reading the script + recent files.
        if (isShell) {
          const args = asRecord(input);
          const command = String(args.command ?? args.cmd ?? "");
          void openDiscoveredRef.current({
            command,
            texts: [command, String(event.output ?? "")],
          });
        }

        const synthetic: AgentUiEvent = {
          type: "tool_start",
          name: event.name,
          input,
        };
        setItems((prev) => [
          ...prev,
          { id: `t-${id}`, kind: "trace", event: synthetic, at },
        ]);
      } else if (shouldMirrorInChat(event) && event.type !== "tool_start") {
        setItems((prev) => [
          ...prev,
          { id: `t-${id}`, kind: "trace", event, at },
        ]);
      }
    });
  }, []);

  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items, draftAnswer, loading]);

  useEffect(() => {
    activityRef.current?.scrollTo({ top: activityRef.current.scrollHeight });
  }, [activity]);

  const onStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = dist < 80;
  };

  const bridgeLabel = useMemo(() => {
    if (!status.connected) return { text: "No preload bridge", color: "#ff7b72" };
    if (!status.agentReady)
      return { text: "Bridge OK · agent not ready", color: "#e3b341" };
    return { text: "Agent bridge ready", color: "#3fb950" };
  }, [status]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const prompt = input.trim();
    const turnId = activeThreadIdRef.current;
    if (turnId && isThreadBusy(turnId)) return;
    setInput("");
    setLoading(true);
    setPhase("thinking");
    if (turnId) addBusyThread(turnId);
    draftRef.current = "";
    setDraftAnswer("");
    setItems((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, kind: "user", text: prompt, at: now() },
    ]);

    try {
      if (!window.electronAgent?.sendPrompt) {
        setItems((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            kind: "system",
            text: "Bridge tidak terhubung. Jalankan: npm run desktop:start",
            at: now(),
          },
        ]);
        return;
      }
      const res = await window.electronAgent.sendPrompt(prompt);
      if (!res.ok && res.error) {
        // error event may already have been emitted
        if (activeThreadIdRef.current === turnId) {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === "system" && last.text === res.error) return prev;
            return [
              ...prev,
              {
                id: `e-${Date.now()}`,
                kind: "system",
                text: res.error!,
                at: now(),
              },
            ];
          });
        } else if (turnId) {
          const base = sessionCacheRef.current.get(turnId) ?? emptySessionSnap();
          sessionCacheRef.current.set(turnId, {
            ...base,
            items: [
              ...base.items,
              {
                id: `e-${Date.now()}`,
                kind: "system",
                text: res.error!,
                at: now(),
              },
            ],
            loading: false,
            phase: "error",
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (activeThreadIdRef.current === turnId) {
        setItems((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            kind: "system",
            text: msg,
            at: now(),
          },
        ]);
      }
    } finally {
      if (activeThreadIdRef.current === turnId) {
        setLoading(false);
      }
      if (turnId) removeBusyThread(turnId);
      if (turnId) {
        const cached = sessionCacheRef.current.get(turnId);
        if (cached?.loading) {
          sessionCacheRef.current.set(turnId, { ...cached, loading: false });
        }
      }
      void refreshSessions();
      void refreshBots();
    }
  };

  const runningBg = processes.filter((p) => p.status === "running").length;
  const activeBot = bots.find((b) => b.id === selectedBotId);
  const backgroundBusyCount = busyThreadIds.filter(
    (id) => id !== activeThreadId,
  ).length;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 font-sans text-fg">
      {/* Sidebar */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface-1 pt-[52px]">
        <div className="app-drag px-4 pb-3">
          <div className="font-mono text-sm font-semibold tracking-wide text-accent-soft">
            AGENT
          </div>
          <div className="mt-0.5 text-xs text-muted">Desktop runtime</div>
        </div>

        <div className="app-no-drag flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          {!inBotSession ? (
            <button
              type="button"
              onClick={() => void handleNewSession()}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[11px] font-medium text-fg transition hover:border-accent/40 hover:bg-surface-3"
            >
              + New session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleReturnToSessions()}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-[11px] font-medium text-fg transition hover:border-accent/40 hover:bg-surface-3"
            >
              ← Back to sessions
            </button>
          )}

          <nav className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setMainView("chat")}
              className={`rounded-lg px-3 py-2 text-left text-[11px] transition ${
                mainView === "chat"
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg-dim hover:bg-surface-2 hover:text-fg"
              }`}
            >
              Sessions
            </button>
            <button
              type="button"
              onClick={() => setMainView("capabilities")}
              className={`rounded-lg px-3 py-2 text-left text-[11px] transition ${
                mainView === "capabilities"
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg-dim hover:bg-surface-2 hover:text-fg"
              }`}
            >
              Capabilities
            </button>
            <button
              type="button"
              onClick={() => setMainView("artifacts")}
              className={`rounded-lg px-3 py-2 text-left text-[11px] transition ${
                mainView === "artifacts"
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg-dim hover:bg-surface-2 hover:text-fg"
              }`}
            >
              Artifacts
            </button>
            <button
              type="button"
              onClick={() => setMainView("settings")}
              className={`rounded-lg px-3 py-2 text-left text-[11px] transition ${
                mainView === "settings"
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg-dim hover:bg-surface-2 hover:text-fg"
              }`}
            >
              Settings
            </button>
          </nav>

          <div className="flex border-b border-border">
            {(["sessions", "bots", "learned"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "sessions" && inBotSession) {
                    void handleReturnToSessions();
                  }
                  if (tab === "learned" && window.electronAgent?.getLearnedRules) {
                    window.electronAgent.getLearnedRules().then((r) => r && setLearnedRules(r));
                  }
                }}
                className={`flex-1 border-b-2 py-2 text-xs font-semibold tracking-wider uppercase ${
                  activeTab === tab
                    ? "border-accent text-white"
                    : "border-transparent text-muted hover:text-fg-dim"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {activeTab === "sessions" ? (
              sessions.length === 0 ? (
                <div className="px-1 py-2 text-xs text-muted">No sessions yet</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {sessions.map((s) => {
                    const active = s.threadId === activeThreadId && !inBotSession;
                    const sessionBusy = busyThreadIds.includes(s.threadId);
                    const sessionPhase =
                      threadPhases[s.threadId] ??
                      (sessionBusy ? ("thinking" as AgentPhase) : null);
                    const badgeColor = sessionPhase
                      ? phaseColor(sessionPhase)
                      : undefined;
                    return (
                      <button
                        key={s.threadId}
                        type="button"
                        onClick={() => void handleOpenSession(s.threadId)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          active
                            ? "border-accent/30 bg-surface-3"
                            : "border-transparent bg-transparent hover:bg-surface-2"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <div className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg">
                            {s.preview || s.threadId}
                          </div>
                          {sessionBusy && sessionPhase ? (
                            <span
                              className="shrink-0 rounded border px-1 py-0.5 text-[8px] font-semibold tracking-wide uppercase"
                              style={{
                                color: badgeColor,
                                borderColor: `${badgeColor}55`,
                                background: `${badgeColor}14`,
                              }}
                            >
                              {sessionPhase}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex justify-between gap-2 text-[9px] text-muted">
                          <span className="truncate">{s.threadId}</span>
                          <span className="shrink-0">
                            {new Date(s.updatedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : activeTab === "bots" ? (
              <div className="flex flex-col gap-1">
                <div className="px-1 pb-1 text-[9.5px] leading-snug text-muted">
                  Setiap bot punya sesi sendiri + tools terbatas. History ikut ter-load.
                </div>
                {specializedBots.length === 0 ? (
                  <div className="px-1 py-2 text-xs text-muted">No specialized bots</div>
                ) : (
                  specializedBots.map((b) => {
                    const active = b.id === selectedBotId && inBotSession;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => void handleOpenBot(b.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          active
                            ? "border-accent/30 bg-surface-3"
                            : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium text-fg">{b.name}</div>
                          {(b.turnCount ?? 0) > 0 ? (
                            <span className="shrink-0 text-[9px] text-muted">
                              {b.turnCount} turns
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[9.5px] leading-snug text-muted">
                          {b.description}
                        </div>
                        {b.preview ? (
                          <div className="mt-1 truncate font-mono text-[9px] text-fg-dim">
                            {b.preview}
                          </div>
                        ) : (
                          <div className="mt-1 text-[9px] italic text-muted">
                            Belum ada chat — klik untuk mulai
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[9.5px] font-semibold text-muted uppercase tracking-wider">
                    Learned Memory & Rules ({learnedRules.length})
                  </span>
                  <button
                    onClick={() => {
                      if (window.electronAgent?.getLearnedRules) {
                        window.electronAgent.getLearnedRules().then((r) => r && setLearnedRules(r));
                      }
                    }}
                    className="text-[9px] text-accent hover:underline"
                  >
                    ↻ Refresh
                  </button>
                </div>
                {learnedRules.length === 0 ? (
                  <div className="py-2 text-[10.5px] text-muted">Belum ada aturan yang dipelajari.</div>
                ) : (
                  learnedRules.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-border bg-surface-2 p-3 text-left transition hover:border-emerald-500/40"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10.5px] font-bold text-fg">{r.title || "Learned Behavior"}</span>
                        <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-extrabold text-emerald-400 uppercase tracking-widest shadow-sm">
                          Learned
                        </span>
                      </div>
                      <div className="text-[9.5px] leading-relaxed text-fg-dim font-mono whitespace-pre-wrap bg-surface-1/50 p-2 rounded border border-border/50">
                        {r.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-border pt-2">
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="mb-1 text-[9px] tracking-wider text-muted uppercase">
                Live phase
              </div>
              <PhasePill phase={phase} busy={loading} />
              {backgroundBusyCount > 0 ? (
                <div className="mt-1.5 text-[9px] leading-snug text-amber-300/90">
                  {backgroundBusyCount === 1
                    ? "Background turn still running in another session."
                    : `${backgroundBusyCount} background turns still running.`}
                </div>
              ) : null}
            </div>

            <div
              className={`rounded-lg border bg-surface-2 ${
                processPanelOpen ? "border-accent/40" : "border-border"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setProcessPanelOpen((v) => !v);
                  void refreshProcesses();
                }}
                className="w-full border-0 bg-transparent px-3 py-2 text-left"
                title="Background processes"
              >
                <div className="mb-1 flex items-center justify-between text-[9px] tracking-wider text-muted uppercase">
                  <span>Connection</span>
                  <span>
                    {processPanelOpen ? "▾" : "▸"} bg {runningBg}
                  </span>
                </div>
                <div
                  className="text-[11px] font-semibold"
                  style={{ color: bridgeLabel.color }}
                >
                  {bridgeLabel.text}
                </div>
                <div className="mt-1 text-[9.5px] text-muted">
                  process_manage / PTY background
                </div>
              </button>
              {status.error && (
                <div className="border-t border-border px-3 py-2 text-[9.5px] leading-snug text-danger">
                  {status.error}
                </div>
              )}
              {processPanelOpen && (
                <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border px-3 py-2">
                  {processes.length === 0 ? (
                    <div className="text-[9.5px] leading-snug text-muted">
                      No background processes. Start via{" "}
                      <code className="font-mono">process_manage</code> or PTY
                      background execute.
                    </div>
                  ) : (
                    processes.map((proc) => (
                      <div
                        key={`${proc.source}-${proc.pid}`}
                        className="rounded-md border border-border bg-surface-1 p-2"
                      >
                        <div className="flex justify-between gap-2 font-mono text-[9.5px] text-fg">
                          <span>
                            PID {proc.pid} · {proc.status}
                          </span>
                          <span className="text-muted">
                            {proc.source === "pty"
                              ? `pty#${proc.slot ?? "?"}`
                              : "process_manage"}
                          </span>
                        </div>
                        <div
                          className="mt-1 truncate text-[9.5px] text-fg-dim"
                          title={proc.command}
                        >
                          {proc.command}
                        </div>
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            type="button"
                            className="rounded border border-accent/40 bg-surface-3 px-2 py-0.5 text-[9px] text-accent-soft"
                            onClick={async () => {
                              const res =
                                await window.electronAgent?.pollProcess?.(
                                  proc.pid,
                                );
                              if (res) setProcessDetail(res.detail);
                            }}
                          >
                            Logs
                          </button>
                          <button
                            type="button"
                            className="rounded border border-danger/40 bg-[#2a1518] px-2 py-0.5 text-[9px] text-danger"
                            onClick={async () => {
                              const res =
                                await window.electronAgent?.killProcess?.(
                                  proc.pid,
                                );
                              if (res) setProcessDetail(res.detail);
                              void refreshProcesses();
                            }}
                          >
                            Kill
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {processDetail && (
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-0 p-2 font-mono text-[9px] leading-snug text-fg">
                      {processDetail}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {mainView === "capabilities" ? (
        <CapabilitiesView onClose={() => setMainView("chat")} />
      ) : mainView === "settings" ? (
        <SettingsView
          onClose={() => {
            setMainView("chat");
            void refreshBots();
          }}
          onOpenCapabilities={() => setMainView("capabilities")}
        />
      ) : mainView === "artifacts" ? (
        <ArtifactsView
          onClose={() => setMainView("chat")}
          onOpenSession={(threadId) => {
            setMainView("chat");
            void handleOpenSession(threadId);
          }}
          onOpenArtifact={(art) => {
            if (art.category === "links" || /^https?:\/\//i.test(art.location)) {
              window.open(art.location, "_blank", "noopener,noreferrer");
              return;
            }
            const p = art.path || art.location;
            const ext = extensionOf(p);
            openCanvas(
              {
                id: normalizeCanvasKey(p) || p,
                path: p,
                basename: art.title || basenamePath(p),
                kind: inferPreviewKind(ext),
                language: languageForExt(ext),
              },
              true,
            );
            setMainView("chat");
            setRailOpen(true);
            setRailLayer("canvas");
          }}
        />
      ) : (
      <>
      {/* Main */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="app-drag flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-fg">
              {inBotSession && activeBot
                ? `${activeBot.name} · bot session`
                : activeThreadId || status.workspaceRoot}
            </div>
            <div className="truncate text-[9.5px] text-muted">
              {status.model}
              {inBotSession && activeBot?.tools?.length
                ? ` · tools: ${activeBot.tools.join(", ")}`
                : inBotSession && activeBot
                  ? ` · ${activeBot.name}`
                  : " · general session"}
            </div>
          </div>
          <button
            type="button"
            className="app-no-drag rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[9.5px] text-fg-dim hover:border-accent/40 hover:text-fg"
            onClick={() => setRailOpen((v) => !v)}
          >
            {railOpen ? "Hide activity" : "Show activity"}
          </button>
        </header>

        <div
          ref={streamRef}
          onScroll={onStreamScroll}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
        >
          {items.map((item) => {
            if (item.kind === "user") {
              return (
                <div key={item.id} className="flex max-w-[86%] flex-col self-end">
                  <div className="mb-1 text-right text-[9.5px] text-muted">
                    You · {item.at}
                  </div>
                  <div className="rounded-2xl rounded-br-md border border-accent/25 bg-[#152033] px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap">
                    {item.text}
                  </div>
                </div>
              );
            }
            if (item.kind === "assistant") {
              return (
                <div key={item.id} className="max-w-[90%] self-start">
                  <div className="mb-1 text-[9.5px] text-muted">
                    Agent · {item.at}
                  </div>
                  <div className="rounded-2xl rounded-bl-md border border-border bg-surface-3 px-3.5 py-3">
                    <MarkdownBody text={item.text} />
                  </div>
                </div>
              );
            }
            if (item.kind === "system") {
              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-2.5 text-[11px] whitespace-pre-wrap text-[#ffb4b0]"
                >
                  {item.text}
                </div>
              );
            }
            if (item.kind === "reasoning") {
              return (
                <ReasoningBlock
                  key={item.id}
                  text={item.text}
                  at={item.at}
                  label={item.label ?? "Reasoning"}
                />
              );
            }
            return (
              <div key={item.id} className="max-w-[92%] self-start pl-1">
                <CompactActivityChip event={item.event} />
              </div>
            );
          })}

          {draftAnswer &&
            (shouldRenderAsReasoning(draftAnswer) ? (
              <ReasoningBlock text={draftAnswer} live label="Model notice" />
            ) : (
              <div className="max-w-[90%] self-start">
                <div className="mb-1 inline-flex items-center gap-2 text-[9.5px] text-muted">
                  Agent · streaming
                  <TypingDots color="#9fd0ff" />
                </div>
                <div className="rounded-2xl rounded-bl-md border border-accent/40 bg-surface-3 px-3.5 py-3">
                  <MarkdownBody text={draftAnswer} />
                  <StreamingCaret />
                </div>
              </div>
            ))}

          {loading && !draftAnswer && <WaitingCard phase={phase} />}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3">
          <div className="rounded-2xl border border-border-strong bg-surface-2 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
            <textarea
              value={input}
              disabled={loading}
              rows={2}
              placeholder={
                inBotSession && activeBot
                  ? `Task for ${activeBot.name} only…`
                  : "Give Agent a task…"
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              className="w-full resize-none border-0 bg-transparent text-[12px] text-fg outline-none placeholder:text-muted disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {inBotSession && activeBot ? (
                  <span className="max-w-[200px] truncate rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[9.5px] text-accent-soft">
                    {activeBot.name}
                  </span>
                ) : (
                  <span className="max-w-[160px] truncate rounded-md border border-border bg-surface-1 px-2 py-1 text-[9.5px] text-fg-dim">
                    General
                  </span>
                )}
                <span className="truncate font-mono text-[9px] text-muted">
                  {status.model}
                </span>
              </div>
              <button
                type="button"
                disabled={loading || !input.trim()}
                onClick={() => void handleSend()}
                className="inline-flex min-w-[72px] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-surface-0 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <TypingDots color="#0b0f14" /> : "Send"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Activity rail — Trace + Canvas layers */}
      {railOpen && (
        <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-surface-1">
          <div className="flex h-12 items-center justify-between gap-2 border-b border-border px-3">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold tracking-wide text-fg">
                Live activity
              </span>
              <div className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    ["trace", "Trace"],
                    ["canvas", `Canvas${canvasTabs.length ? ` ${canvasTabs.length}` : ""}`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setRailLayer(id);
                      if (id === "canvas" && canvasTabs.length === 0) {
                        void openDiscoveredDeliverables({
                          texts: items
                            .filter((m) => m.kind === "assistant")
                            .slice(-3)
                            .map((m) => ("text" in m ? String(m.text) : "")),
                        });
                      }
                    }}
                    className={`rounded px-2 py-0.5 text-[9.5px] ${
                      railLayer === id
                        ? "bg-accent/20 text-accent"
                        : "text-muted hover:text-fg"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <span className="font-mono text-[9.5px] text-muted">
              {activity.length}
            </span>
          </div>

          {railLayer === "canvas" ? (
            <div className="min-h-0 flex-1">
              <ActivityCanvas
                tabs={canvasTabs}
                activeId={activeCanvasId}
                onSelect={setActiveCanvasId}
                onClose={(id) => {
                  setCanvasTabs((prev) => {
                    const next = prev.filter((t) => t.id !== id);
                    setActiveCanvasId((cur) =>
                      cur === id ? (next[next.length - 1]?.id ?? null) : cur,
                    );
                    return next;
                  });
                }}
                planApproval={
                  planApprovalPending
                    ? {
                        pending: true,
                        busy: planApprovalBusy,
                        onApprove: () => {
                          void (async () => {
                            setPlanApprovalBusy(true);
                            try {
                              await window.electronAgent?.resolveApproval?.(
                                true,
                                activeThreadIdRef.current,
                              );
                              setPlanApprovalPending(false);
                            } finally {
                              setPlanApprovalBusy(false);
                            }
                          })();
                        },
                        onReject: () => {
                          void (async () => {
                            setPlanApprovalBusy(true);
                            try {
                              await window.electronAgent?.resolveApproval?.(
                                false,
                                activeThreadIdRef.current,
                              );
                              setPlanApprovalPending(false);
                            } finally {
                              setPlanApprovalBusy(false);
                            }
                          })();
                        },
                      }
                    : null
                }
              />
            </div>
          ) : (
            <div
              ref={activityRef}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
            >
              {activity.length === 0 ? (
                <div className="p-2 text-xs text-muted">
                  {loading ? (
                    <span
                      className="inline-flex items-center gap-2"
                      style={{ color: phaseColor(phase) }}
                    >
                      Listening for events
                      <TypingDots color={phaseColor(phase)} />
                    </span>
                  ) : (
                    "Waiting for thinking / tools…"
                  )}
                </div>
              ) : (
                groupActivityEntries(activity).map((a) => (
                  <TraceCard
                    key={a.id}
                    event={a.event}
                    at={a.at}
                    endEvent={a.endEvent}
                    onOpenCanvas={(art) =>
                      openCanvas(artifactToCanvasTab(art), true)
                    }
                  />
                ))
              )}
            </div>
          )}
        </aside>
      )}
      </>
      )}
    </div>
  );
}

