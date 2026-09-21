import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDeliverableFileChips } from "../deliverable-chips.js";
import { shouldRenderAsReasoning } from "../../agent/sanitize-output.js";
import type { AgentPhase } from "./ActivityChips.js";
import { AppFooter } from "./AppFooter.js";
import { BotAvatar } from "./BotAvatar.js";
import type { ComposerAttachment } from "./ChatComposer.js";
import { ChatFileCard } from "./ChatFileCard.js";
import type { GatewayStatusSnapshot } from "./GatewayStatusBar.js";
import { MarkdownBody } from "./MarkdownBody.js";
import { NewWorkspaceModal } from "./NewWorkspaceModal.js";
import { UserBubbleAttachments } from "./UserBubbleAttachments.js";
import type { UserBubbleAttachment } from "./user-message-attachments.js";
import {
  MentionRichText,
  WorkspaceComposer,
} from "./WorkspaceComposer.js";
import { WorkspaceProjectRail } from "./WorkspaceProjectRail.js";
import {
  WorkspacesSidebar,
  type WorkspaceSummaryRow,
} from "./WorkspacesSidebar.js";

type ChatItem =
  | {
      id: string;
      kind: "user";
      text: string;
      at: string;
      attachments?: UserBubbleAttachment[];
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      at: string;
      botId?: string;
      botName?: string;
    }
  | { id: string; kind: "system"; text: string; at: string }
  | {
      id: string;
      kind: "file";
      path: string;
      basename: string;
      at: string;
      note?: string;
    };

type ProjectOption = { id: string; name: string };

function now() {
  return new Date().toLocaleTimeString();
}

function isWorkspacesHash(): boolean {
  try {
    const u = new URL(window.location.href);
    return (
      u.searchParams.get("view") === "workspaces" ||
      u.hash === "#workspaces"
    );
  } catch {
    return false;
  }
}

export function isWorkspacesWindow(): boolean {
  return isWorkspacesHash();
}

export function WorkspacesWindow() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummaryRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [activeChat, setActiveChat] = useState<{
    workspaceId: string;
    chatId: string;
    workspaceName: string;
    chatName: string;
    threadId: string;
  } | null>(null);
  const [bots, setBots] = useState<
    Array<{ id: string; name: string; role?: string; active?: boolean }>
  >([]);
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: "welcome",
      kind: "system",
      text: "Pilih workspace dan buka group chat di kiri.",
      at: now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    ComposerAttachment[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftBot, setDraftBot] = useState<{ id?: string; name?: string } | null>(
    null,
  );
  const [phase, setPhase] = useState<AgentPhase>("boot");
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalDetail, setApprovalDetail] = useState("");
  const [profileId, setProfileId] = useState("default");
  const [profileIds, setProfileIds] = useState<string[]>(["default"]);
  const [gateway, setGateway] = useState<GatewayStatusSnapshot | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  /** Per-bot streaming drafts so parallel turns don't mash tokens together. */
  const draftByBotRef = useRef(new Map<string, string>());
  const threadRef = useRef("");
  const streamRef = useRef<HTMLDivElement>(null);
  const pendingWritesRef = useRef<string[]>([]);
  /** Dedupe assistant bubbles when both live `done` events and `res.replies` fire. */
  const seenReplyKeysRef = useRef(new Set<string>());

  const replyKey = (botId: string | undefined, text: string) =>
    `${botId || ""}:${text.replace(/\s+/g, " ").trim()}`;

  const isLeaderBot = (botId?: string, botName?: string) => {
    const id = (botId || "").toLowerCase();
    const name = (botName || "").toLowerCase();
    return id === "cto" || name === "cto" || /\bcto\b/.test(name);
  };

  /** Finish-first for most bots; pin CTO right under the latest user bubble. */
  const insertAssistantItem = (
    prev: ChatItem[],
    item: Extract<ChatItem, { kind: "assistant" }>,
  ): ChatItem[] => {
    if (!isLeaderBot(item.botId, item.botName)) {
      return [...prev, item];
    }
    let insertAt = prev.length;
    for (let i = prev.length - 1; i >= 0; i--) {
      if (prev[i]!.kind === "user") {
        insertAt = i + 1;
        break;
      }
    }
    // Skip past an existing CTO bubble already placed after that user.
    while (
      insertAt < prev.length &&
      prev[insertAt]!.kind === "assistant" &&
      isLeaderBot(
        (prev[insertAt] as Extract<ChatItem, { kind: "assistant" }>).botId,
        (prev[insertAt] as Extract<ChatItem, { kind: "assistant" }>).botName,
      )
    ) {
      insertAt += 1;
    }
    return [...prev.slice(0, insertAt), item, ...prev.slice(insertAt)];
  };

  const clearDrafts = () => {
    draftByBotRef.current.clear();
    setDraft("");
    setDraftBot(null);
  };

  const syncDraftUi = (preferBotId?: string) => {
    const map = draftByBotRef.current;
    if (preferBotId && map.has(preferBotId)) {
      setDraft(map.get(preferBotId) || "");
      setDraftBot({ id: preferBotId });
      return;
    }
    // Show the longest in-flight draft (usually the most active bot).
    let bestId = "";
    let bestText = "";
    for (const [id, text] of map) {
      if (text.length >= bestText.length) {
        bestId = id;
        bestText = text;
      }
    }
    setDraft(bestText);
    setDraftBot(bestId ? { id: bestId } : null);
  };
  const appendFileChips = useCallback(
    (texts: string[], extra: string[] = [], atTs = now()) => {
      const chips = buildDeliverableFileChips(texts, extra, atTs, { limit: 8 });
      if (!chips.length) return;
      setItems((prev) => {
        const existing = new Set(
          prev.filter((i) => i.kind === "file").map((i) => i.path),
        );
        const fresh = chips.filter((c) => !existing.has(c.path));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    },
    [],
  );

  const focusedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === focusedId) ?? null,
    [workspaces, focusedId],
  );

  const showProjectRail = Boolean(
    focusedId &&
      ((focusedWorkspace?.projectIds?.length ?? 0) > 0 ||
        focusedWorkspace?.activeProjectId ||
        activeProjectId ||
        workspaceRoot),
  );

  const projectLabel = useMemo(() => {
    const pid =
      focusedWorkspace?.activeProjectId || activeProjectId || null;
    if (!pid) return null;
    return projects.find((p) => p.id === pid)?.name ?? pid;
  }, [focusedWorkspace, activeProjectId, projects]);

  const refresh = useCallback(async () => {
    const res = await window.electronAgent?.listWorkspaces?.();
    if (res?.ok) setWorkspaces(res.workspaces as WorkspaceSummaryRow[]);
    const proj = await window.electronAgent?.listProjects?.();
    if (proj?.ok) {
      setProjects(proj.projects.map((p) => ({ id: p.id, name: p.name })));
    }
  }, []);

  const refreshChrome = useCallback(async () => {
    const st = await window.electronAgent?.getStatus?.();
    if (st) {
      setProfileId(st.profileId || "default");
      setGateway(st.gateway ?? null);
      setStatusError(st.error ?? null);
      if (typeof st.workspaceRoot === "string" && st.workspaceRoot) {
        setWorkspaceRoot(st.workspaceRoot);
      }
      if ("activeProjectId" in st) {
        setActiveProjectId(
          (st as { activeProjectId?: string | null }).activeProjectId ?? null,
        );
      }
      if (st.agentReady) setPhase((p) => (p === "boot" ? "done" : p));
    }
    const listed = await window.electronAgent?.listProfiles?.();
    if (listed?.ok) {
      setProfileIds(listed.profiles.map((p) => p.id));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshChrome();
    document.title = "Workspaces — Agent Desktop";
  }, [refresh, refreshChrome]);

  // Align sandbox only when user focuses a workspace — skip while any turn is busy.
  // Track last aligned pair so we don't keep calling setActiveProject (which used
  // to reboot the agent and made the chat room look like it was refreshing).
  const alignedSandboxRef = useRef<string>("");
  useEffect(() => {
    if (!focusedId) return;
    const pid =
      focusedWorkspace?.activeProjectId ||
      focusedWorkspace?.projectIds?.[0] ||
      null;
    if (!pid) return;
    const alignKey = `${focusedId}:${pid}`;
    if (alignedSandboxRef.current === alignKey && activeProjectId === pid) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const st = await window.electronAgent?.getStatus?.();
        if (cancelled) return;
        const busy = Array.isArray(
          (st as { busyThreadIds?: string[] } | null)?.busyThreadIds,
        )
          ? ((st as { busyThreadIds?: string[] }).busyThreadIds ?? [])
          : [];
        if (busy.length > 0) return;
        const current =
          st && "activeProjectId" in st
            ? ((st as { activeProjectId?: string | null }).activeProjectId ??
              null)
            : null;
        if (current === pid) {
          alignedSandboxRef.current = alignKey;
          if (typeof st?.workspaceRoot === "string" && st.workspaceRoot) {
            setWorkspaceRoot((prev) =>
              prev === st.workspaceRoot ? prev : st.workspaceRoot,
            );
          }
          setActiveProjectId((prev) => (prev === pid ? prev : pid));
          return;
        }
        const res = await window.electronAgent?.setWorkspaceActiveProject?.({
          workspaceId: focusedId,
          projectId: pid,
        });
        if (cancelled) return;
        if (res?.ok) {
          alignedSandboxRef.current = alignKey;
          if (typeof res.workspaceRoot === "string" && res.workspaceRoot) {
            setWorkspaceRoot(res.workspaceRoot);
          } else if (!(res as { reused?: boolean }).reused) {
            await refreshChrome();
          }
          const nextPid =
            res.activeProjectId !== undefined
              ? (res.activeProjectId ?? pid)
              : pid;
          setActiveProjectId(nextPid);
          if (Array.isArray(res.workspaces)) {
            setWorkspaces(res.workspaces as WorkspaceSummaryRow[]);
          }
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    focusedId,
    focusedWorkspace?.activeProjectId,
    focusedWorkspace?.projectIds?.[0],
    activeProjectId,
    refreshChrome,
  ]);

  useEffect(() => {
    if (!window.electronAgent?.onEvent) return;
    return window.electronAgent.onEvent((event) => {
      const myTid = threadRef.current;
      const tid =
        typeof event.threadId === "string" && event.threadId.trim()
          ? event.threadId.trim()
          : null;
      // When a group chat is open, only accept events for that thread.
      // Stray main-window / boot events were making the room look like it refreshed.
      if (myTid && tid !== myTid) return;

      if (event.type === "tool_start") {
        const name = String(event.name || "");
        if (name === "write_file" || name === "edit_file") {
          const input = (event.input ?? {}) as Record<string, unknown>;
          const p = String(
            input.path ?? input.file_path ?? input.filename ?? "",
          ).trim();
          if (p) pendingWritesRef.current.push(p);
        }
      }

      if (event.type === "token") {
        const evAny = event as { botId?: unknown; botName?: unknown };
        const botId =
          typeof evAny.botId === "string" && evAny.botId.trim()
            ? evAny.botId.trim()
            : "_";
        const prev = draftByBotRef.current.get(botId) || "";
        draftByBotRef.current.set(botId, prev + event.text);
        setDraftBot({
          id: botId === "_" ? undefined : botId,
          name:
            typeof evAny.botName === "string" ? evAny.botName : undefined,
        });
        syncDraftUi(botId);
        setPhase("thinking");
      }
      if (event.type === "status" && event.phase) {
        setPhase(event.phase as AgentPhase);
        if (event.phase === "waiting_approval") {
          setApprovalPending(true);
          setApprovalDetail(String(event.detail || "Approval required"));
        }
        if (event.phase === "done" || event.phase === "error") {
          setApprovalPending(false);
          setApprovalDetail("");
        }
      }
      if (event.type === "interrupt") {
        setApprovalPending(true);
        setApprovalDetail("Tool / plan approval required");
      }
      if (event.type === "done") {
        const evAny = event as { botName?: unknown; botId?: unknown };
        const botName =
          typeof evAny.botName === "string" ? evAny.botName : undefined;
        const botId =
          typeof evAny.botId === "string" ? evAny.botId : undefined;
        const draftKey = botId || "_";
        const botDraft = draftByBotRef.current.get(draftKey) || "";
        draftByBotRef.current.delete(draftKey);
        syncDraftUi();
        const text = String(event.text || botDraft || "").trim();
        setPhase("done");
        const at = now();
        if (text && shouldRenderAsReasoning(text)) {
          // Drop CoT / tool-plan leaks from the chat timeline (main chat
          // already routes these to the reasoning panel).
          setItems((prev) => [
            ...prev,
            {
              id: `s-${Date.now()}-${botId || "bot"}`,
              kind: "system",
              text: `${botName || "Bot"}: jawaban masih rencana tool — menunggu retry…`,
              at,
            },
          ]);
          pendingWritesRef.current = [];
          return;
        }
        if (text) {
          const key = replyKey(botId, text);
          if (!seenReplyKeysRef.current.has(key)) {
            seenReplyKeysRef.current.add(key);
            setItems((prev) =>
              insertAssistantItem(prev, {
                id: `a-${Date.now()}-${botId || "bot"}-${prev.length}`,
                kind: "assistant",
                text,
                at,
                botId,
                botName,
              }),
            );
            appendFileChips([text], [...pendingWritesRef.current], at);
            pendingWritesRef.current = [];
          }
        }
      }
      if (event.type === "error") {
        setPhase("error");
        setItems((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            kind: "system",
            text: event.message || "Error",
            at: now(),
          },
        ]);
      }
    });
  }, [appendFileChips]);

  // Stick to bottom only when the user is already near the bottom — avoids
  // yanking the viewport on unrelated parent re-renders.
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, draft, loading]);

  const openChat = async (workspaceId: string, chatId: string) => {
    const wsRow = workspaces.find((w) => w.id === workspaceId);
    const pid = wsRow?.activeProjectId || wsRow?.projectIds?.[0] || null;
    if (pid && activeProjectId !== pid) {
      const activated = await window.electronAgent?.setWorkspaceActiveProject?.({
        workspaceId,
        projectId: pid,
      });
      if (activated?.ok) {
        if (typeof activated.workspaceRoot === "string") {
          setWorkspaceRoot(activated.workspaceRoot);
        }
        setActiveProjectId(activated.activeProjectId ?? pid);
        if (Array.isArray(activated.workspaces)) {
          setWorkspaces(activated.workspaces as WorkspaceSummaryRow[]);
        }
      }
    }

    const res = await window.electronAgent?.openWorkspaceChat?.({
      workspaceId,
      chatId,
    });
    if (!res?.ok || !res.threadId) {
      setItems((prev) => [
        ...prev,
        {
          id: `e-open-${Date.now()}`,
          kind: "system",
          text: res?.error || "Gagal membuka group chat",
          at: now(),
        },
      ]);
      return;
    }
    threadRef.current = res.threadId;
    setActiveChat({
      workspaceId,
      chatId: res.chat?.id || chatId,
      workspaceName: res.workspace?.name || workspaceId,
      chatName: res.chat?.name || chatId,
      threadId: res.threadId,
    });
    setBots(
      ((res.bots || []) as Array<{
        id: string;
        name: string;
        role?: string;
        active?: boolean;
      }>).filter((b) => b.active !== false),
    );
    setLoading(false);
    clearDrafts();

    if (res.events?.length) {
      const restored: ChatItem[] = [];
      for (const ev of res.events) {
        const at = new Date(ev.ts).toLocaleTimeString();
        if (ev.role === "user") {
          restored.push({
            id: `u-${ev.ts}-${restored.length}`,
            kind: "user",
            text: ev.content,
            at,
          });
        } else if (ev.role === "assistant") {
          restored.push({
            id: `a-${ev.ts}-${restored.length}`,
            kind: "assistant",
            text: ev.content,
            at,
            botId:
              typeof ev.meta?.botId === "string" ? ev.meta.botId : undefined,
            botName:
              typeof ev.meta?.botName === "string"
                ? ev.meta.botName
                : undefined,
          });
          restored.push(
            ...buildDeliverableFileChips([ev.content], [], at, {
              limit: 8,
              idPrefix: `file-${ev.ts}-${restored.length}`,
            }),
          );
        } else if (ev.role === "system" || ev.role === "error") {
          restored.push({
            id: `s-${ev.ts}-${restored.length}`,
            kind: "system",
            text: ev.content,
            at,
          });
        }
      }
      setItems(
        restored.length
          ? restored
          : [
              {
                id: "empty",
                kind: "system",
                text: "Chat kosong — @mention anggota atau kirim pesan.",
                at: now(),
              },
            ],
      );
    } else {
      setItems([
        {
          id: "welcome",
          kind: "system",
          text: `Group chat “${res.chat?.name || chatId}”. Coba @cto atau kirim pesan bebas.`,
          at: now(),
        },
      ]);
    }
  };

  const send = async () => {
    const prompt = input.trim();
    const attachmentsForSend = [...pendingAttachments];
    if ((!prompt && attachmentsForSend.length === 0) || !activeChat || loading)
      return;

    const bubbleAttachments: UserBubbleAttachment[] = attachmentsForSend.map(
      (a) => ({
        path: a.path,
        absPath: a.absPath,
        basename: a.basename,
        kind: a.kind,
        mime: a.mime,
        size: a.size,
        label: a.label,
        previewUrl: a.previewUrl,
      }),
    );

    setInput("");
    setPendingAttachments([]);
    setLoading(true);
    setPhase("thinking");
    pendingWritesRef.current = [];
    seenReplyKeysRef.current = new Set();
    setItems((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        kind: "user",
        text: prompt,
        at: now(),
        attachments: bubbleAttachments.length ? bubbleAttachments : undefined,
      },
    ]);
    clearDrafts();
    try {
      const res = await window.electronAgent?.sendWorkspaceGroupPrompt?.({
        workspaceId: activeChat.workspaceId,
        chatId: activeChat.chatId,
        prompt,
        attachments: attachmentsForSend.map((a) => ({
          path: a.path,
          absPath: a.absPath,
        })),
      });
      if (!res?.ok && res?.error) {
        setPhase("error");
        setItems((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            kind: "system",
            text: res.error!,
            at: now(),
          },
        ]);
      } else if (res?.ok && Array.isArray(res.replies) && res.replies.length) {
        const at = now();
        const extrasToChip: string[] = [];
        setItems((prev) => {
          let next = prev;
          for (const reply of res.replies!) {
            const text = String(reply.content || "").trim();
            if (!text) continue;
            if (shouldRenderAsReasoning(text)) continue;
            const key = replyKey(reply.botId, text);
            if (seenReplyKeysRef.current.has(key)) continue;
            seenReplyKeysRef.current.add(key);
            next = insertAssistantItem(next, {
              id: `a-reply-${Date.now()}-${reply.botId || "bot"}-${extrasToChip.length}`,
              kind: "assistant",
              text,
              at,
              botId: reply.botId,
              botName: reply.botName,
            });
            extrasToChip.push(text);
          }
          const supervisorNote =
            typeof res.note === "string" && res.note.trim()
              ? res.note.trim()
              : typeof res.supervisor?.note === "string"
                ? res.supervisor.note.trim()
                : "";
          if (supervisorNote) {
            next = [
              ...next,
              {
                id: `s-sup-${Date.now()}`,
                kind: "system",
                text: supervisorNote,
                at: now(),
              },
            ];
          }
          return next;
        });
        // Only scrape chips for replies that were not already streamed via `done`.
        if (extrasToChip.length) {
          appendFileChips(extrasToChip, [], at);
        }
        setPhase("done");
      } else if (res?.note) {
        setPhase("done");
        setItems((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            kind: "system",
            text: res.note!,
            at: now(),
          },
        ]);
      }
    } catch (e) {
      setPhase("error");
      setItems((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          kind: "system",
          text: e instanceof Error ? e.message : String(e),
          at: now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0 font-sans text-fg">
      <header className="app-drag flex h-12 shrink-0 items-center border-b border-border bg-surface-1 px-4 pl-20">
        <div className="app-no-drag min-w-0">
          <div className="text-[13px] font-semibold text-fg">Workspaces</div>
          <div className="truncate text-[10px] text-muted">
            {activeChat
              ? `${activeChat.workspaceName} · ${activeChat.chatName}`
              : "Divisions · members · group chat"}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-border bg-surface-1">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            <WorkspacesSidebar
              workspaces={workspaces}
              projects={projects}
              focusedId={focusedId}
              onFocus={setFocusedId}
              onRefresh={() => void refresh()}
              onNewWorkspace={() => setNewOpen(true)}
              activeChatKey={
                activeChat
                  ? `${activeChat.workspaceId}:${activeChat.chatId}`
                  : null
              }
              onProjectContextChange={(info) => {
                setActiveProjectId(info.activeProjectId);
                if (info.workspaceRoot) {
                  setWorkspaceRoot(info.workspaceRoot);
                } else {
                  void refreshChrome();
                }
              }}
              onDeleteWorkspace={(id) => {
                void (async () => {
                  const res =
                    await window.electronAgent?.deleteWorkspace?.(id);
                  if (res?.ok) {
                    if (focusedId === id) setFocusedId(null);
                    if (activeChat?.workspaceId === id) {
                      setActiveChat(null);
                      threadRef.current = "";
                    }
                    await refresh();
                  }
                })();
              }}
              onOpenChat={(workspaceId, chatId) => {
                void openChat(workspaceId, chatId);
              }}
            />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            ref={streamRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
          >
            {items.map((item) => {
              if (item.kind === "user") {
                return (
                  <div
                    key={item.id}
                    className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent/20 px-3.5 py-2.5 text-[13px] text-fg"
                  >
                    {item.attachments?.length ? (
                      <div className="mb-2">
                        <UserBubbleAttachments attachments={item.attachments} />
                      </div>
                    ) : null}
                    {item.text ? (
                      <MentionRichText text={item.text} bots={bots} />
                    ) : null}
                  </div>
                );
              }
              if (item.kind === "system") {
                return (
                  <div
                    key={item.id}
                    className="self-center rounded-lg px-2 py-1 text-center text-[11px] text-muted"
                  >
                    {item.text}
                  </div>
                );
              }
              if (item.kind === "file") {
                return (
                  <ChatFileCard
                    key={item.id}
                    path={item.path}
                    basename={item.basename}
                    note={item.note}
                    onOpen={() => {
                      void (async () => {
                        const res =
                          await window.electronAgent?.openWorkspaceFile?.(
                            item.path,
                          );
                        if (res && !res.ok && res.error) {
                          setItems((prev) => [
                            ...prev,
                            {
                              id: `s-${Date.now()}`,
                              kind: "system",
                              text: `Could not open ${item.path}: ${res.error}`,
                              at: now(),
                            },
                          ]);
                        }
                      })();
                    }}
                    onSaveAs={() => {
                      void (async () => {
                        const res =
                          await window.electronAgent?.exportWorkspaceFile?.(
                            item.path,
                          );
                        if (res?.ok && res.savedAs) {
                          setItems((prev) => [
                            ...prev,
                            {
                              id: `s-${Date.now()}`,
                              kind: "system",
                              text: `Saved copy to ${res.savedAs}`,
                              at: now(),
                            },
                          ]);
                        } else if (res && !res.ok && res.error) {
                          setItems((prev) => [
                            ...prev,
                            {
                              id: `s-${Date.now()}`,
                              kind: "system",
                              text: res.error!,
                              at: now(),
                            },
                          ]);
                        }
                      })();
                    }}
                  />
                );
              }
              return (
                <div key={item.id} className="flex max-w-[90%] items-start gap-2.5 self-start">
                  <BotAvatar
                    name={item.botName || "Agent"}
                    id={item.botId}
                    size={32}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[9.5px] text-muted">
                      {item.botName || "Agent"} · {item.at}
                    </div>
                    <div className="rounded-2xl rounded-bl-md border border-border bg-surface-3 px-3.5 py-3">
                      <MarkdownBody text={item.text} />
                    </div>
                  </div>
                </div>
              );
            })}
            {draft ? (
              <div className="flex max-w-[90%] items-start gap-2.5 self-start opacity-80">
                <BotAvatar
                  name={draftBot?.name || "…"}
                  id={draftBot?.id || "draft"}
                  size={32}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[9.5px] text-muted">
                    {draftBot?.name || draftBot?.id || "bot"} · typing…
                  </div>
                  <div className="rounded-2xl rounded-bl-md border border-border bg-surface-3 px-3.5 py-3">
                    <MarkdownBody text={draft} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 px-4 pb-3 pt-3">
            {approvalPending ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                <div className="min-w-0 text-[12px] text-fg">
                  <div className="font-medium">Approval required</div>
                  <div className="truncate text-[11px] text-muted">
                    {approvalDetail || "Approve to continue this workspace turn"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={approvalBusy || !activeChat}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                    onClick={() => {
                      void (async () => {
                        setApprovalBusy(true);
                        try {
                          await window.electronAgent?.resolveApproval?.(
                            true,
                            threadRef.current || activeChat?.threadId,
                          );
                          setApprovalPending(false);
                        } finally {
                          setApprovalBusy(false);
                        }
                      })();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={approvalBusy || !activeChat}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg disabled:opacity-50"
                    onClick={() => {
                      void (async () => {
                        setApprovalBusy(true);
                        try {
                          await window.electronAgent?.resolveApproval?.(
                            false,
                            threadRef.current || activeChat?.threadId,
                          );
                          setApprovalPending(false);
                          setItems((prev) => [
                            ...prev,
                            {
                              id: `s-rej-${Date.now()}`,
                              kind: "system",
                              text: "Approval rejected — turn stopped.",
                              at: now(),
                            },
                          ]);
                        } finally {
                          setApprovalBusy(false);
                        }
                      })();
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
            <WorkspaceComposer
              value={input}
              bots={bots}
              disabled={!activeChat || approvalPending}
              loading={loading}
              placeholder={
                activeChat
                  ? `Message ${activeChat.chatName} — @cto atau “halo semuanya”…`
                  : "Open a group chat first"
              }
              attachments={pendingAttachments}
              onChange={setInput}
              onSend={() => void send()}
              onAddAttachments={(files) => {
                setPendingAttachments((prev) => {
                  const seen = new Set(prev.map((p) => p.path));
                  const next = [...prev];
                  for (const f of files) {
                    if (seen.has(f.path)) continue;
                    seen.add(f.path);
                    next.push(f);
                  }
                  return next;
                });
              }}
              onRemoveAttachment={(path) => {
                setPendingAttachments((prev) =>
                  prev.filter((a) => a.path !== path),
                );
              }}
              onAttachError={(message) => {
                setItems((prev) => [
                  ...prev,
                  {
                    id: `s-${Date.now()}`,
                    kind: "system",
                    text: message,
                    at: now(),
                  },
                ]);
              }}
            />
          </div>
        </main>

        {showProjectRail ? (
          <WorkspaceProjectRail
            workspaceRoot={workspaceRoot}
            profileId={profileId}
            projectLabel={projectLabel}
          />
        ) : null}
      </div>

      <AppFooter
        status={gateway}
        profileId={profileId}
        profiles={profileIds}
        phase={phase}
        statusError={statusError}
        showFooterPhase
        showLearnedInFooter={false}
        onRefreshProfiles={async () => {
          await refreshChrome();
        }}
        onHome={() => {
          setFocusedId(null);
          setActiveChat(null);
          threadRef.current = "";
        }}
        onManageGateways={() => {
          void refreshChrome();
        }}
      />

      <NewWorkspaceModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(ws) => {
          void (async () => {
            await refresh();
            setFocusedId(ws.id);
          })();
        }}
      />
    </div>
  );
}
