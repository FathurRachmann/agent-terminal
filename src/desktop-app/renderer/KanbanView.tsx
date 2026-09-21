import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

type KanbanStatus =
  | "triage"
  | "todo"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

type KanbanTask = {
  id: string;
  title: string;
  body: string;
  status: KanbanStatus;
  assignee: string | null;
  tenant: string | null;
  priority: number;
  projectId?: string | null;
  result: string | null;
  scheduledAt: string | null;
  goalMode: boolean;
  workspaceKind?: string;
  skillsJson?: string;
  modelOverride?: string | null;
  updatedAt: string;
  parentIds?: string[];
  childIds?: string[];
  childrenDone?: number;
  childrenTotal?: number;
};

type BoardMeta = { slug: string; name: string; description: string };
type BoardSettings = {
  orchestratorProfile: string;
  defaultAssignee: string;
  autoDecompose: boolean;
  allowSelfReview: boolean;
  profileDescriptionsJson: string;
};

type ProfileRow = {
  id: string;
  name?: string;
  isDefault?: boolean;
  soulPreview?: string;
};

type TaskDetail = {
  task: KanbanTask;
  comments: Array<{ id: string; author: string; body: string; createdAt: string }>;
  runs: Array<{ id: string; outcome: string | null; summary: string | null; startedAt: string }>;
  parents: string[];
  children: string[];
};

const COLUMNS: KanbanStatus[] = [
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
];

const HOW_IT_WORKS_KEY = "kanban.howItWorks.dismissed";

type NewTaskForm = {
  title: string;
  body: string;
  priority: number;
  /** Empty = scratch board folder; otherwise desktop project id. */
  projectId: string;
  assignee: string;
  skills: string;
  modelOverride: string;
  goalMode: boolean;
};

const emptyForm = (assignee = ""): NewTaskForm => ({
  title: "",
  body: "",
  priority: 0,
  projectId: "",
  assignee,
  skills: "",
  modelOverride: "",
  goalMode: false,
});

function api() {
  return (window as unknown as { electronAgent: Record<string, Function> })
    .electronAgent;
}

function parseDescriptions(json: string | undefined): Record<string, string> {
  try {
    const raw = JSON.parse(json || "{}") as Record<string, string>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function scheduleIso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
        on ? "bg-accent" : "bg-surface-4"
      }`}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition"
        style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
      {children}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: (e: MouseEvent) => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`rounded px-1.5 py-0.5 text-[10px] leading-tight ${
        danger
          ? "text-danger hover:bg-danger/15"
          : "text-fg-dim hover:bg-surface-3 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function KanbanView({ onClose }: { onClose: () => void }) {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [board, setBoard] = useState("default");
  const [byStatus, setByStatus] = useState<Record<string, KanbanTask[]>>({});
  const [settings, setSettings] = useState<BoardSettings | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; primaryFolder?: string | null }>
  >([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<KanbanTask | null>(null);
  const [scheduleTask, setScheduleTask] = useState<KanbanTask | null>(null);
  const [form, setForm] = useState<NewTaskForm>(emptyForm());
  const [creating, setCreating] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [howDismissed, setHowDismissed] = useState(() => {
    try {
      return localStorage.getItem(HOW_IT_WORKS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const ea = api();
      const list = (await ea.kanbanBoardsList?.()) as BoardMeta[] | undefined;
      if (list) setBoards(list);

      const boardData = (await ea.kanbanList?.({ board })) as {
        byStatus: Record<string, KanbanTask[]>;
        settings: BoardSettings;
      };
      setByStatus(boardData?.byStatus ?? {});
      setSettings(boardData?.settings ?? null);
      setDescDrafts(parseDescriptions(boardData?.settings?.profileDescriptionsJson));

      const prof = (await ea.listProfiles?.()) as {
        ok?: boolean;
        profiles?: ProfileRow[];
      };
      if (prof?.profiles) setProfiles(prof.profiles);

      const proj = (await ea.listProjects?.()) as {
        ok?: boolean;
        projects?: Array<{
          id: string;
          name: string;
          primaryFolder?: string | null;
        }>;
      };
      if (proj?.ok && proj.projects) setProjects(proj.projects);

      if (selectedId) {
        const d = (await ea.kanbanGet?.({
          board,
          id: selectedId,
        })) as TaskDetail | null;
        setDetail(d);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [board, selectedId]);

  useEffect(() => {
    void refresh();
    const unsub = api().onKanbanChanged?.(() => void refresh()) as
      | (() => void)
      | undefined;
    return () => unsub?.();
  }, [refresh]);

  const total = useMemo(
    () => COLUMNS.reduce((n, c) => n + (byStatus[c]?.length ?? 0), 0),
    [byStatus],
  );

  const profileOptions = useMemo(() => {
    if (profiles.length) return profiles;
    return [{ id: "default", name: "default", isDefault: true }];
  }, [profiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) {
      out[col] = (byStatus[col] ?? []).filter((t) => {
        if (!q) return true;
        return (
          t.title.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.assignee ?? "").toLowerCase().includes(q)
        );
      });
    }
    return out;
  }, [byStatus, search]);

  const patchSettings = async (patch: Partial<BoardSettings>) => {
    await api().kanbanSetSettings?.({ board, patch });
    await refresh();
  };

  const saveProfileDesc = async (profileId: string) => {
    const next = {
      ...parseDescriptions(settings?.profileDescriptionsJson),
      [profileId]: descDrafts[profileId] ?? "",
    };
    await patchSettings({ profileDescriptionsJson: JSON.stringify(next) });
  };

  const openCreate = () => {
    const def =
      settings?.defaultAssignee ||
      profileOptions.find((p) => p.isDefault)?.id ||
      profileOptions[0]?.id ||
      "default";
    setForm(emptyForm(def));
    setCreateOpen(true);
  };

  const createTask = async () => {
    if (!form.title.trim() || creating) return;
    setCreating(true);
    try {
      const skills = form.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await api().kanbanCreate?.({
        board,
        title: form.title.trim(),
        body: form.body.trim(),
        priority: form.priority,
        projectId: form.projectId.trim() || null,
        workspaceKind: form.projectId.trim() ? "project" : "scratch",
        assignee: form.assignee || null,
        skills,
        modelOverride: form.modelOverride || null,
        goalMode: form.goalMode,
        triage: true,
      });
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async () => {
    if (!editTask) return;
    await api().kanbanUpdate?.({
      board,
      id: editTask.id,
      patch: {
        title: editTask.title,
        body: editTask.body,
        assignee: editTask.assignee,
        priority: editTask.priority,
        goalMode: editTask.goalMode,
        projectId: editTask.projectId ?? null,
      },
    });
    setEditTask(null);
    await refresh();
  };

  const applySchedule = async (taskId: string, scheduledAt: string | null) => {
    // Single write: set timer + promote same card to ready (no duplicate / no race with decompose)
    await api().kanbanSchedule?.({
      board,
      id: taskId,
      scheduledAt,
      promoteToReady: scheduledAt != null,
    });
    setScheduleTask(null);
    await refresh();
  };

  const runNow = async (task: KanbanTask) => {
    await api().kanbanUpdate?.({
      board,
      id: task.id,
      patch: {
        status: "ready",
        scheduledAt: null,
        assignee: task.assignee || settings?.defaultAssignee || "default",
      },
    });
    await api().kanbanDispatchNow?.({ max: 1 });
    await refresh();
  };

  const dismissHow = () => {
    setHowDismissed(true);
    try {
      localStorage.setItem(HOW_IT_WORKS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const editable = (status: KanbanStatus) =>
    status === "triage" || status === "todo" || status === "ready" || status === "blocked";

  const renderCard = (task: KanbanTask) => {
    const waitingOnKids =
      (task.childrenTotal ?? 0) > 0 &&
      (task.childrenDone ?? 0) < (task.childrenTotal ?? 0);
    const isOrchestratorParent = waitingOnKids && task.status === "todo";

    return (
      <div
        key={task.id}
        className={`rounded-md border border-border bg-surface-2 p-2 text-left ${
          selectedId === task.id ? "ring-1 ring-accent" : ""
        }`}
      >
        <button
          type="button"
          className="w-full text-left"
          onClick={() => setSelectedId(task.id)}
        >
          <div className="text-sm font-medium leading-snug">{task.title}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted">
            <span className="font-mono">{task.id}</span>
            {task.assignee && <span>@{task.assignee}</span>}
            {task.projectId && (
              <span className="text-accent-soft" title="Project-scoped workspace">
                ⌂ {task.projectId}
              </span>
            )}
            {task.goalMode && <span className="text-accent-soft">goal</span>}
            {task.scheduledAt && Date.parse(task.scheduledAt) > Date.now() && (
              <span className="text-warn">
                ⏱ {new Date(task.scheduledAt).toLocaleString()}
              </span>
            )}
            {isOrchestratorParent && (
              <span className="text-accent-soft" title="Parent waits until children finish">
                parent {task.childrenDone}/{task.childrenTotal}
              </span>
            )}
          </div>
        </button>

        <div className="mt-1.5 flex flex-wrap gap-0.5 border-t border-border/60 pt-1.5">
          {editable(task.status) && (
            <>
              <ActionBtn title="Edit" onClick={() => setEditTask({ ...task })}>
                Edit
              </ActionBtn>
              <ActionBtn
                title="Schedule / timer"
                onClick={() => setScheduleTask(task)}
              >
                Timer
              </ActionBtn>
              <ActionBtn title="Move to Ready & dispatch" onClick={() => void runNow(task)}>
                Run
              </ActionBtn>
              {task.status !== "ready" && (
                <ActionBtn
                  title="Move to Ready"
                  onClick={() =>
                    void api()
                      .kanbanMove?.({ board, id: task.id, status: "ready" })
                      .then(refresh)
                  }
                >
                  Ready
                </ActionBtn>
              )}
              <ActionBtn
                danger
                title="Delete"
                onClick={() => {
                  if (!window.confirm(`Delete ${task.id}?`)) return;
                  void api()
                    .kanbanDelete?.({ board, id: task.id })
                    .then(refresh);
                }}
              >
                Del
              </ActionBtn>
            </>
          )}
          {task.status === "running" && (
            <>
              <ActionBtn
                title="Block running worker"
                onClick={() => {
                  const reason = window.prompt("Block reason", "stopped from UI");
                  if (!reason) return;
                  void api()
                    .kanbanBlock?.({ board, id: task.id, reason })
                    .then(refresh);
                }}
              >
                Block
              </ActionBtn>
              <ActionBtn
                title="Mark done"
                onClick={() =>
                  void api()
                    .kanbanComplete?.({
                      board,
                      id: task.id,
                      summary: "Completed from UI",
                    })
                    .then(refresh)
                }
              >
                Done
              </ActionBtn>
            </>
          )}
          {task.status === "review" && (
            <ActionBtn
              title="Open detail"
              onClick={() => setSelectedId(task.id)}
            >
              Open
            </ActionBtn>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-surface-0 text-fg">
      {/* Top chrome */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">Kanban</h1>
          <select
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-fg-dim"
            value={board}
            onChange={(e) => {
              const slug = e.target.value;
              setBoard(slug);
              void api().kanbanBoardsSwitch?.(slug);
            }}
          >
            {boards.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name || b.slug}
              </option>
            ))}
          </select>
        </div>
        <input
          className="ml-2 hidden max-w-xs flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs md:block"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-fg-dim hover:bg-surface-2"
            onClick={() => void api().kanbanDispatchNow?.({}).then(refresh)}
          >
            Dispatch
          </button>
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
            onClick={openCreate}
          >
            + New task
          </button>
          <button
            type="button"
            className="text-xs text-muted hover:text-fg"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Settings strip — does not scroll with board */}
      <div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <FieldLabel>Orchestrator profile</FieldLabel>
            <select
              className="min-w-[140px] rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
              value={settings?.orchestratorProfile || ""}
              onChange={(e) =>
                void patchSettings({ orchestratorProfile: e.target.value })
              }
            >
              <option value="">(default)</option>
              {profileOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                  {p.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Default assignee</FieldLabel>
            <select
              className="min-w-[140px] rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
              value={settings?.defaultAssignee || ""}
              onChange={(e) =>
                void patchSettings({ defaultAssignee: e.target.value })
              }
            >
              <option value="">(default)</option>
              {profileOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                  {p.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
          <label className="mb-1 flex items-center gap-2.5 text-sm text-fg-dim">
            <Toggle
              on={settings?.autoDecompose ?? true}
              onChange={(v) => void patchSettings({ autoDecompose: v })}
              label="Auto-decompose triage tasks"
            />
            Auto-decompose triage tasks
          </label>
        </div>

        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-fg"
            onClick={() => setProfilesOpen((v) => !v)}
          >
            <span className="inline-block w-3">{profilesOpen ? "▾" : "▸"}</span>
            Profile descriptions
          </button>
          {profilesOpen && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted">
                Descriptions guide the decomposer&apos;s routing.
              </p>
              {profileOptions.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate font-mono text-xs text-fg-dim">
                    {p.id}
                  </span>
                  <input
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm placeholder:text-muted"
                    placeholder="What is this profile good at?"
                    value={descDrafts[p.id] ?? ""}
                    onChange={(e) =>
                      setDescDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs"
                    onClick={() => void saveProfileDesc(p.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2.5 py-1.5 text-xs"
                    onClick={() => {
                      const hint =
                        p.soulPreview?.replace(/\s+/g, " ").trim().slice(0, 160) ||
                        `${p.name || p.id} generalist`;
                      setDescDrafts((d) => ({ ...d, [p.id]: hint }));
                    }}
                  >
                    Auto
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!howDismissed && (
          <div className="rounded-lg border border-border-strong bg-surface-2 px-4 py-3">
            <p className="text-sm leading-relaxed text-fg-dim">
              You don&apos;t run the cards — agents do. Put a card in{" "}
              <strong className="text-fg">Ready</strong> with an assignee and an
              agent picks it up within a minute. Parent cards in{" "}
              <strong className="text-fg">Todo</strong> stay until children
              finish — that is not a duplicate of the running worker.
            </p>
            <button
              type="button"
              className="mt-2 rounded-md border border-border bg-surface-3 px-3 py-1 text-xs"
              onClick={dismissHow}
            >
              Got it
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Horizontally scrollable board */}
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-5 py-3">
        <div className="flex h-full w-max gap-2">
          {COLUMNS.map((col) => (
            <div
              key={col}
              className="flex h-full w-[220px] shrink-0 flex-col rounded-lg border border-border bg-surface-1"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <span>{col}</span>
                <span>{filtered[col]?.length ?? 0}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {(filtered[col] ?? []).map((task) => renderCard(task))}
                {col === "triage" && (
                  <button
                    type="button"
                    className="mt-auto rounded-md border border-dashed border-border py-2 text-xs text-muted hover:border-accent hover:text-fg"
                    onClick={openCreate}
                  >
                    + New task
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {total === 0 && (
        <p className="shrink-0 pb-2 text-center text-xs text-muted">
          Board kosong — buat task di Triage.
        </p>
      )}

      {/* Detail panel */}
      {detail && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border bg-surface-2 px-5 py-3 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <strong className="flex-1 truncate">{detail.task.title}</strong>
            <span className="font-mono text-[10px] text-muted">{detail.task.id}</span>
            <button
              type="button"
              className="text-muted"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
              }}
            >
              ×
            </button>
          </div>
          <p className="mb-1 text-xs text-fg-dim">
            Parents: {detail.parents.join(", ") || "—"} · Children:{" "}
            {detail.children.join(", ") || "—"}
          </p>
          {detail.task.result && (
            <p className="text-xs">
              <span className="text-muted">Result · </span>
              {detail.task.result}
            </p>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-4 shadow-2xl">
            <h3 className="mb-3 font-semibold">Edit task</h3>
            <input
              className="mb-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
              value={editTask.title}
              onChange={(e) =>
                setEditTask((t) => (t ? { ...t, title: e.target.value } : t))
              }
            />
            <textarea
              className="mb-2 min-h-[80px] w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
              value={editTask.body}
              onChange={(e) =>
                setEditTask((t) => (t ? { ...t, body: e.target.value } : t))
              }
            />
            <div className="mb-2 grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>Assignee</FieldLabel>
                <select
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
                  value={editTask.assignee ?? ""}
                  onChange={(e) =>
                    setEditTask((t) =>
                      t ? { ...t, assignee: e.target.value || null } : t,
                    )
                  }
                >
                  {profileOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Priority</FieldLabel>
                <input
                  type="number"
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
                  value={editTask.priority}
                  onChange={(e) =>
                    setEditTask((t) =>
                      t ? { ...t, priority: Number(e.target.value) || 0 } : t,
                    )
                  }
                />
              </div>
            </div>
            <div className="mb-2">
              <FieldLabel>Project scope</FieldLabel>
              <select
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
                value={editTask.projectId ?? ""}
                onChange={(e) =>
                  setEditTask((t) =>
                    t
                      ? {
                          ...t,
                          projectId: e.target.value || null,
                          workspaceKind: e.target.value ? "project" : "scratch",
                        }
                      : t,
                  )
                }
              >
                <option value="">scratch · isolated</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm text-fg-dim">
              <Toggle
                on={editTask.goalMode}
                onChange={(v) =>
                  setEditTask((t) => (t ? { ...t, goalMode: v } : t))
                }
                label="Goal mode"
              />
              Goal mode
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm text-muted"
                onClick={() => setEditTask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-white"
                onClick={() => void saveEdit()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule / timer modal */}
      {scheduleTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface-1 p-4 shadow-2xl">
            <h3 className="mb-1 font-semibold">Schedule · {scheduleTask.id}</h3>
            <p className="mb-3 text-xs text-muted">
              Dispatcher skips the card until this time, then claims it like a
              cron tick.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {(
                [
                  ["5 min", 5 * 60_000],
                  ["15 min", 15 * 60_000],
                  ["1 hour", 60 * 60_000],
                  ["Tomorrow 9am", null],
                ] as const
              ).map(([label, ms]) => (
                <button
                  key={label}
                  type="button"
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
                  onClick={() => {
                    if (ms != null) {
                      void applySchedule(scheduleTask.id, scheduleIso(ms));
                      return;
                    }
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    d.setHours(9, 0, 0, 0);
                    void applySchedule(scheduleTask.id, d.toISOString());
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <FieldLabel>Custom datetime</FieldLabel>
            <input
              type="datetime-local"
              className="mb-3 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm"
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const iso = new Date(v).toISOString();
                void applySchedule(scheduleTask.id, iso);
              }}
            />
            <div className="flex justify-between">
              <button
                type="button"
                className="text-xs text-danger"
                onClick={() => void applySchedule(scheduleTask.id, null)}
              >
                Clear schedule
              </button>
              <button
                type="button"
                className="text-sm text-muted"
                onClick={() => setScheduleTask(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New task modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <h2 className="text-base font-semibold">New task in Triage</h2>
              <button
                type="button"
                className="text-muted hover:text-fg"
                onClick={() => setCreateOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="space-y-3.5 px-5 py-4">
              <input
                autoFocus
                className="w-full rounded-md border border-accent bg-surface-2 px-3 py-2 text-sm outline-none ring-1 ring-accent/40 placeholder:text-muted"
                placeholder="Rough idea — a specifier will flesh it out"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
              <textarea
                className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm placeholder:text-muted"
                placeholder="Description (optional)"
                value={form.body}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Priority</FieldLabel>
                  <input
                    type="number"
                    className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        priority: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div>
                  <FieldLabel>Project scope</FieldLabel>
                  <select
                    className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
                    value={form.projectId}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        projectId: e.target.value,
                      }))
                    }
                  >
                    <option value="">scratch · isolated board folder</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                        {p.primaryFolder
                          ? ` · ${p.primaryFolder.split(/[/\\]/).pop()}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[10px] leading-snug text-muted">
                    Project-bound tasks run only inside that project folder.
                    Child tasks inherit the same scope.
                  </div>
                </div>
              </div>
              <div>
                <FieldLabel>Assignee</FieldLabel>
                <select
                  className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm"
                  value={form.assignee}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assignee: e.target.value }))
                  }
                >
                  {profileOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.id}
                      {p.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Skills (comma-separated)</FieldLabel>
                <input
                  className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm placeholder:text-muted"
                  placeholder="translation, github"
                  value={form.skills}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, skills: e.target.value }))
                  }
                />
              </div>
              <label className="flex items-center gap-3 text-sm text-fg-dim">
                <Toggle
                  on={form.goalMode}
                  onChange={(v) => setForm((f) => ({ ...f, goalMode: v }))}
                  label="Goal mode"
                />
                Goal mode (worker loops until a judge agrees it&apos;s done)
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-fg-dim"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!form.title.trim() || creating}
                className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                onClick={() => void createTask()}
              >
                {creating ? "Creating…" : "Create task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
