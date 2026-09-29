import React, { useEffect, useMemo, useRef, useState } from "react";
import { BotAvatar } from "./BotAvatar.js";
import { EditWorkspaceBotModal } from "./EditWorkspaceBotModal.js";

export type WorkspaceSummaryRow = {
  id: string;
  name: string;
  description?: string;
  projectIds: string[];
  activeProjectId: string | null;
  memberCount: number;
  chatCount: number;
};

export type WorkspaceBotRow = {
  id: string;
  name: string;
  role?: string;
  description: string;
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
  active?: boolean;
};

export type WorkspaceChatRow = {
  id: string;
  name: string;
  replyMode: "auto" | "mention_only";
  maxResponders: number;
};

export type ProjectOption = {
  id: string;
  name: string;
};

type Props = {
  workspaces: WorkspaceSummaryRow[];
  projects: ProjectOption[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
  onRefresh: () => void | Promise<void>;
  onNewWorkspace: () => void;
  onOpenChat: (workspaceId: string, chatId: string) => void;
  onDeleteWorkspace: (id: string) => void;
  activeChatKey?: string | null;
  /** Fired after project assign/activate/unassign so parent can refresh Files+Git rail. */
  onProjectContextChange?: (info: {
    workspaceId: string;
    activeProjectId: string | null;
    workspaceRoot?: string;
  }) => void;
};

export function WorkspacesSidebar({
  workspaces,
  projects,
  focusedId,
  onFocus,
  onRefresh,
  onNewWorkspace,
  onOpenChat,
  onDeleteWorkspace,
  activeChatKey,
  onProjectContextChange,
}: Props) {
  const [bots, setBots] = useState<WorkspaceBotRow[]>([]);
  const [chats, setChats] = useState<WorkspaceChatRow[]>([]);
  const [detail, setDetail] = useState<WorkspaceSummaryRow | null>(null);
  const [assignId, setAssignId] = useState("");
  const [newBotName, setNewBotName] = useState("");
  const [menuBotId, setMenuBotId] = useState<string | null>(null);
  const [editBot, setEditBot] = useState<WorkspaceBotRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const focused = useMemo(() => {
    const fromList = workspaces.find((w) => w.id === focusedId);
    // Detail from getWorkspace is source of truth while a workspace is open
    // (parent list can lag behind assign/unassign).
    if (detail && detail.id === focusedId) {
      return fromList ? { ...fromList, ...detail } : detail;
    }
    return fromList ?? null;
  }, [workspaces, focusedId, detail]);

  const loadDetail = async (id: string) => {
    setError(null);
    try {
      const res = await window.electronAgent?.getWorkspace?.(id);
      if (!res?.ok) {
        setError(res?.error ?? "Failed to load workspace");
        return;
      }
      setDetail(res.workspace as WorkspaceSummaryRow);
      setBots((res.bots as WorkspaceBotRow[]) || []);
      setChats((res.chats as WorkspaceChatRow[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (focusedId) void loadDetail(focusedId);
    else {
      setDetail(null);
      setBots([]);
      setChats([]);
      setMenuBotId(null);
      setEditBot(null);
    }
  }, [focusedId]);

  useEffect(() => {
    if (!menuBotId) return;
    const onDoc = (e: MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) setMenuBotId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuBotId(null);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuBotId]);

  const unassignedProjects = projects.filter(
    (p) => !(focused?.projectIds || []).includes(p.id),
  );

  const assignProject = async () => {
    if (!focusedId || !assignId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.electronAgent?.assignWorkspaceProject?.({
        workspaceId: focusedId,
        projectId: assignId,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Assign failed");
        return;
      }
      if (res.workspace) {
        setDetail((prev) =>
          ({
            ...(prev ?? {}),
            ...(res.workspace as object),
          }) as WorkspaceSummaryRow,
        );
      }
      setAssignId("");
      const ws = res.workspace as WorkspaceSummaryRow | undefined;
      onProjectContextChange?.({
        workspaceId: focusedId,
        activeProjectId: ws?.activeProjectId ?? assignId,
        workspaceRoot:
          typeof (res as { workspaceRoot?: string }).workspaceRoot === "string"
            ? (res as { workspaceRoot: string }).workspaceRoot
            : undefined,
      });
      await onRefresh();
      await loadDetail(focusedId);
    } finally {
      setBusy(false);
    }
  };

  const setActiveProject = async (projectId: string | null) => {
    if (!focusedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      let res = await window.electronAgent?.setWorkspaceActiveProject?.({
        workspaceId: focusedId,
        projectId,
      });
      if (!res?.ok && String(res?.error || "").includes("running turns")) {
        const ok = window.confirm(
          "Masih ada turn yang jalan. Soft-align gagal — stop turn dan pindah project sekarang?",
        );
        if (!ok) return;
        res = await window.electronAgent?.setWorkspaceActiveProject?.({
          workspaceId: focusedId,
          projectId,
          force: true,
        });
      }
      if (!res?.ok) {
        setError(res?.error ?? "Switch project failed");
        return;
      }
      if (res.workspace) {
        setDetail((prev) =>
          ({
            ...(prev ?? {}),
            ...(res.workspace as object),
          }) as WorkspaceSummaryRow,
        );
      }
      const ws = res.workspace as WorkspaceSummaryRow | undefined;
      onProjectContextChange?.({
        workspaceId: focusedId,
        activeProjectId: ws?.activeProjectId ?? projectId,
        workspaceRoot:
          typeof (res as { workspaceRoot?: string }).workspaceRoot === "string"
            ? (res as { workspaceRoot: string }).workspaceRoot
            : undefined,
      });
      await onRefresh();
      await loadDetail(focusedId);
    } finally {
      setBusy(false);
    }
  };

  const unassign = async (projectId: string) => {
    if (!focusedId || busy) return;
    setBusy(true);
    try {
      const res = await window.electronAgent?.unassignWorkspaceProject?.({
        workspaceId: focusedId,
        projectId,
      });
      if (res?.ok && res.workspace) {
        setDetail((prev) =>
          ({
            ...(prev ?? {}),
            ...(res.workspace as object),
          }) as WorkspaceSummaryRow,
        );
        const ws = res.workspace as WorkspaceSummaryRow;
        onProjectContextChange?.({
          workspaceId: focusedId,
          activeProjectId: ws.activeProjectId,
        });
      }
      await onRefresh();
      await loadDetail(focusedId);
    } finally {
      setBusy(false);
    }
  };

  const addBot = async () => {
    if (!focusedId || !newBotName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await window.electronAgent?.createWorkspaceBot?.({
        workspaceId: focusedId,
        name: newBotName.trim(),
        role: newBotName.trim(),
        description: `Member: ${newBotName.trim()}`,
        tools: ["read_file", "web_search"],
      });
      if (!res?.ok) {
        setError(res?.error ?? "Create bot failed");
        return;
      }
      setNewBotName("");
      setBots((res.bots as WorkspaceBotRow[]) || []);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const saveBotEdit = async (draft: {
    name: string;
    role: string;
    description: string;
    tools: string;
    skills: string;
    systemPrompt: string;
  }) => {
    if (!focusedId || !editBot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tools = draft.tools
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const skills = draft.skills
        .split(/[,\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.electronAgent?.updateWorkspaceBot?.({
        workspaceId: focusedId,
        botId: editBot.id,
        name: draft.name,
        role: draft.role || undefined,
        description: draft.description,
        systemPrompt: draft.systemPrompt || undefined,
        tools,
        skills,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Update bot failed");
        throw new Error(res?.error ?? "Update bot failed");
      }
      setBots((res.bots as WorkspaceBotRow[]) || []);
      setEditBot(null);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const toggleBotActive = async (bot: WorkspaceBotRow) => {
    if (!focusedId || busy) return;
    setBusy(true);
    setMenuBotId(null);
    setError(null);
    try {
      const nextActive = bot.active === false;
      const res = await window.electronAgent?.updateWorkspaceBot?.({
        workspaceId: focusedId,
        botId: bot.id,
        active: nextActive,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Failed to update bot status");
        return;
      }
      setBots((res.bots as WorkspaceBotRow[]) || []);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const removeBot = async (botId: string) => {
    if (!focusedId || busy) return;
    setBusy(true);
    setMenuBotId(null);
    try {
      const res = await window.electronAgent?.deleteWorkspaceBot?.({
        workspaceId: focusedId,
        botId,
      });
      if (res?.ok) setBots((res.bots as WorkspaceBotRow[]) || []);
      if (editBot?.id === botId) setEditBot(null);
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const updateChatSettings = async (
    chat: WorkspaceChatRow,
    patch: { replyMode?: "auto" | "mention_only"; maxResponders?: number },
  ) => {
    if (!focusedId || busy) return;
    setBusy(true);
    try {
      const res = await window.electronAgent?.updateWorkspaceChat?.({
        workspaceId: focusedId,
        chatId: chat.id,
        ...patch,
      });
      if (res?.ok && res.chat) {
        const updated = res.chat as WorkspaceChatRow;
        setChats((prev) =>
          prev.map((c) =>
            c.id === chat.id
              ? {
                  ...c,
                  replyMode: updated.replyMode ?? patch.replyMode ?? c.replyMode,
                  maxResponders:
                    updated.maxResponders ??
                    patch.maxResponders ??
                    c.maxResponders,
                }
              : c,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const teamSize = Math.max(1, bots.filter((b) => b.active !== false).length);
  const maxResponderChoices = useMemo(() => {
    const cap = Math.min(10, Math.max(teamSize, 1));
    return Array.from({ length: cap }, (_, i) => i + 1);
  }, [teamSize]);

  if (!focusedId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between px-1">
          <div className="text-[10px] font-semibold tracking-wider text-accent-soft uppercase">
            Workspaces
          </div>
          <button
            type="button"
            onClick={onNewWorkspace}
            className="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
          >
            + New
          </button>
        </div>
        {workspaces.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted">
            No workspaces yet — create a division (IT, Finance, …)
          </div>
        ) : (
          workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onFocus(w.id)}
              className="w-full rounded-lg border border-transparent px-2.5 py-2 text-left hover:bg-surface-2"
            >
              <div className="text-[11px] font-medium text-fg">{w.name}</div>
              <div className="mt-0.5 text-[9.5px] text-muted">
                {w.memberCount} members · {w.chatCount} chats
                {w.activeProjectId ? ` · ${w.activeProjectId}` : ""}
              </div>
            </button>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <button
        type="button"
        onClick={() => onFocus(null)}
        className="flex items-center gap-1.5 px-1 text-[11px] text-muted hover:text-fg"
      >
        <span aria-hidden>←</span> All workspaces
      </button>

      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-fg">
            {focused?.name ?? focusedId}
          </div>
          {focused?.description ? (
            <div className="mt-0.5 text-[9.5px] text-muted">
              {focused.description}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          title="Delete workspace"
          onClick={() => onDeleteWorkspace(focusedId)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-red-500/15 hover:text-red-300"
        >
          Del
        </button>
      </div>

      {error ? (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
          {error}
        </div>
      ) : null}

      {/* Projects */}
      <div className="rounded-lg border border-border/60 px-2 py-2">
        <div className="mb-1 text-[9px] font-semibold tracking-wider text-accent-soft uppercase">
          Projects
        </div>
        {(focused?.projectIds || []).length === 0 ? (
          <div className="text-[10px] text-muted">None assigned</div>
        ) : (
          <ul className="space-y-1">
            {(focused?.projectIds || []).map((pid) => {
              const name = projects.find((p) => p.id === pid)?.name ?? pid;
              const active = focused?.activeProjectId === pid;
              return (
                <li
                  key={pid}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] ${
                    active ? "bg-accent/15 text-accent-soft" : "text-fg"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => void setActiveProject(pid)}
                    title="Set active project"
                  >
                    {active ? "● " : "○ "}
                    {name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void unassign(pid)}
                    className="text-muted hover:text-fg"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {unassignedProjects.length > 0 ? (
          <div className="mt-1.5 flex gap-1">
            <select
              value={assignId}
              onChange={(e) => setAssignId(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-surface-0 px-1 py-0.5 text-[10px] text-fg"
            >
              <option value="">Assign project…</option>
              {unassignedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!assignId || busy}
              onClick={() => void assignProject()}
              title="Assign selected project to this workspace"
              className="rounded px-1.5 text-[10px] text-accent disabled:opacity-40"
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {/* Group chats */}
      <div className="rounded-lg border border-border/60 px-2 py-2">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[9px] font-semibold tracking-wider text-accent-soft uppercase">
            Group chats
          </div>
        </div>
        {chats.length === 0 ? (
          <div className="text-[10px] text-muted">No chats</div>
        ) : (
          chats.map((c) => {
            const key = `${focusedId}:${c.id}`;
            const active = activeChatKey === key;
            return (
              <div key={c.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => onOpenChat(focusedId, c.id)}
                  className={`w-full rounded px-1.5 py-1.5 text-left text-[11px] ${
                    active
                      ? "bg-accent/15 text-accent-soft"
                      : "hover:bg-surface-2 text-fg"
                  }`}
                >
                  {c.name}
                </button>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 px-1.5">
                  <label className="flex items-center gap-1 text-[9px] text-muted">
                    <span className="shrink-0">mode</span>
                    <select
                      value={c.replyMode}
                      disabled={busy}
                      onChange={(e) => {
                        const replyMode = e.target.value as
                          | "auto"
                          | "mention_only";
                        void updateChatSettings(c, { replyMode });
                      }}
                      title="auto = route tanpa @mention · mention_only = hanya yang di-@ atau broadcast"
                      className="max-w-[7.5rem] rounded border border-border bg-surface-0 px-1 py-0.5 text-[9px] text-fg"
                    >
                      <option value="auto">auto</option>
                      <option value="mention_only">mention only</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1 text-[9px] text-muted">
                    <span className="shrink-0">max</span>
                    <select
                      value={Math.min(10, Math.max(1, c.maxResponders))}
                      disabled={busy}
                      onChange={(e) => {
                        const maxResponders = Number(e.target.value);
                        void updateChatSettings(c, { maxResponders });
                      }}
                      title="Berapa bot yang boleh jawab per prompt (1 = satu orang, nilai tertinggi ≈ seluruh tim)"
                      className="rounded border border-border bg-surface-0 px-1 py-0.5 text-[9px] text-fg"
                    >
                      {maxResponderChoices.map((n) => (
                        <option key={n} value={n}>
                          {n === teamSize
                            ? `${n} (seluruh tim)`
                            : n === 1
                              ? "1 saja"
                              : String(n)}
                        </option>
                      ))}
                      {/* Keep current value visible if it exceeds current team size */}
                      {c.maxResponders > teamSize && c.maxResponders <= 10 ? (
                        <option value={c.maxResponders}>
                          {c.maxResponders}
                        </option>
                      ) : null}
                    </select>
                  </label>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Members */}
      <div className="rounded-lg border border-border/60 px-2 py-2">
        <div className="mb-1 text-[9px] font-semibold tracking-wider text-accent-soft uppercase">
          Members (bots)
        </div>
        <div className="mb-1.5 flex gap-1">
          <input
            value={newBotName}
            onChange={(e) => setNewBotName(e.target.value)}
            placeholder="Add member…"
            className="min-w-0 flex-1 rounded border border-border bg-surface-0 px-1.5 py-0.5 text-[10px] text-fg"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addBot();
            }}
          />
          <button
            type="button"
            onClick={() => void addBot()}
            className="rounded px-1.5 text-[10px] text-accent"
          >
            +
          </button>
        </div>
        <ul className="space-y-1">
          {bots.map((b) => {
            const isActive = b.active !== false;
            const menuOpen = menuBotId === b.id;
            return (
              <li
                key={b.id}
                className={`rounded px-1.5 py-1 ${
                  isActive ? "bg-surface-0/50" : "bg-surface-0/30 opacity-55"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <BotAvatar
                      name={b.name}
                      id={b.id}
                      size={22}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-fg">
                        @{b.id} · {b.name}
                        {!isActive ? (
                          <span className="ml-1 text-[9px] font-normal text-muted">
                            (inactive)
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-[9px] text-muted">
                        {b.role || b.description}
                      </div>
                    </span>
                  </div>
                  <div className="relative shrink-0" ref={menuOpen ? menuRef : undefined}>
                    <button
                      type="button"
                      aria-label={`Actions for ${b.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() =>
                        setMenuBotId((cur) => (cur === b.id ? null : b.id))
                      }
                      className="rounded px-1.5 py-0.5 text-[14px] leading-none text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      ⋮
                    </button>
                    {menuOpen ? (
                      <div
                        role="menu"
                        className="absolute top-full right-0 z-20 mt-0.5 min-w-[132px] rounded-lg border border-border bg-surface-1 py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-1.5 text-left text-[11px] text-fg hover:bg-surface-2"
                          onClick={() => {
                            setMenuBotId(null);
                            setEditBot(b);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-1.5 text-left text-[11px] text-fg hover:bg-surface-2"
                          onClick={() => void toggleBotActive(b)}
                        >
                          {isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-3 py-1.5 text-left text-[11px] text-red-300 hover:bg-red-500/10"
                          onClick={() => void removeBot(b.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <EditWorkspaceBotModal
        open={Boolean(editBot)}
        bot={editBot}
        busy={busy}
        onClose={() => setEditBot(null)}
        onSave={saveBotEdit}
      />
    </div>
  );
}
