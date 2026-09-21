import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureDefaultBoard } from "./boards.js";
import { boardDbPath, ensureKanbanRoot, isValidBoardSlug, normalizeBoardSlug } from "./paths.js";
import {
  DEFAULT_BOARD_SETTINGS,
  type BoardSettings,
  type CreateTaskInput,
  type KanbanStatus,
  type KanbanTask,
  type TaskAttachment,
  type TaskComment,
  type TaskDetail,
  type TaskEvent,
  type TaskRun,
  type WorkspaceKind,
} from "./types.js";

type TaskRow = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return `t_${randomBytes(4).toString("hex")}`;
}

function runId(): string {
  return `r_${randomBytes(5).toString("hex")}`;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function asNullableString(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function rowToTask(row: TaskRow): KanbanTask {
  return {
    id: asString(row.id),
    title: asString(row.title),
    body: asString(row.body ?? ""),
    status: asString(row.status) as KanbanStatus,
    assignee: asNullableString(row.assignee),
    tenant: asNullableString(row.tenant),
    priority: asNumber(row.priority, 0),
    projectId: asNullableString(row.project_id),
    workspaceKind: (asString(row.workspace_kind) || "scratch") as WorkspaceKind,
    workspacePath: asNullableString(row.workspace_path),
    branch: asNullableString(row.branch),
    result: asNullableString(row.result),
    scheduledAt: asNullableString(row.scheduled_at),
    goalMode: asBool(row.goal_mode),
    goalMaxTurns: asNumber(row.goal_max_turns, 20),
    idempotencyKey: asNullableString(row.idempotency_key),
    maxRuntimeSeconds:
      row.max_runtime_seconds == null
        ? null
        : asNumber(row.max_runtime_seconds),
    maxRetries:
      row.max_retries == null ? null : asNumber(row.max_retries),
    consecutiveFailures: asNumber(row.consecutive_failures, 0),
    blockRecurrences: asNumber(row.block_recurrences, 0),
    lastBlockReason: asNullableString(row.last_block_reason),
    currentRunId: asNullableString(row.current_run_id),
    claimLock: asNullableString(row.claim_lock),
    claimExpiresAt: asNullableString(row.claim_expires_at),
    lastHeartbeatAt: asNullableString(row.last_heartbeat_at),
    modelOverride: asNullableString(row.model_override),
    providerOverride: asNullableString(row.provider_override),
    skillsJson: asString(row.skills_json ?? "[]"),
    metadataJson: asString(row.metadata_json ?? "{}"),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export class KanbanStore {
  readonly boardSlug: string;
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(boardSlug = "default", root?: string) {
    ensureKanbanRoot(root);
    ensureDefaultBoard(root);
    this.boardSlug = boardSlug;
    this.dbPath = boardDbPath(boardSlug, root);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS board_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        assignee TEXT,
        tenant TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        workspace_kind TEXT NOT NULL DEFAULT 'scratch',
        workspace_path TEXT,
        branch TEXT,
        result TEXT,
        scheduled_at TEXT,
        goal_mode INTEGER NOT NULL DEFAULT 0,
        goal_max_turns INTEGER NOT NULL DEFAULT 20,
        idempotency_key TEXT,
        max_runtime_seconds INTEGER,
        max_retries INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        block_recurrences INTEGER NOT NULL DEFAULT 0,
        last_block_reason TEXT,
        current_run_id TEXT,
        claim_lock TEXT,
        claim_expires_at TEXT,
        last_heartbeat_at TEXT,
        model_override TEXT,
        provider_override TEXT,
        skills_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency
        ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
      CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant);
      CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);

      CREATE TABLE IF NOT EXISTS task_links (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        PRIMARY KEY (parent_id, child_id),
        FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (child_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        outcome TEXT,
        summary TEXT,
        metadata_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_runs_task ON task_runs(task_id);

      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        name TEXT NOT NULL,
        abs_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notify_subs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        thread_id TEXT,
        user_id TEXT,
        notifier_profile TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
    `);
    this.ensureColumn("tasks", "project_id", "project_id TEXT");
  }

  private ensureColumn(table: string, column: string, ddl: string): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  getSettings(): BoardSettings {
    const rows = this.db
      .prepare(`SELECT key, value FROM board_settings`)
      .all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: keyof BoardSettings, fallback: number | null) => {
      const raw = map.get(k);
      if (raw == null || raw === "") return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    const bool = (k: keyof BoardSettings, fallback: boolean) => {
      const raw = map.get(k);
      if (raw == null) return fallback;
      return raw === "1" || raw === "true";
    };
    const str = (k: keyof BoardSettings, fallback: string) =>
      map.get(k) ?? fallback;

    return {
      orchestratorProfile: str("orchestratorProfile", ""),
      defaultAssignee: str("defaultAssignee", ""),
      autoDecompose: bool("autoDecompose", true),
      autoDecomposePerTick: num("autoDecomposePerTick", 3) ?? 3,
      autoPromoteChildren: bool("autoPromoteChildren", true),
      maxInProgress: num("maxInProgress", 2),
      maxInProgressPerProfile: num("maxInProgressPerProfile", null),
      failureLimit: num("failureLimit", 2) ?? 2,
      defaultWorkdir: str("defaultWorkdir", ""),
      allowSelfReview: bool("allowSelfReview", false),
      dispatchStaleTimeoutSeconds:
        num("dispatchStaleTimeoutSeconds", 4 * 60 * 60) ?? 4 * 60 * 60,
      blockRecurrenceLimit: num("blockRecurrenceLimit", 2) ?? 2,
      profileDescriptionsJson: str("profileDescriptionsJson", "{}"),
    };
  }

  setSettings(patch: Partial<BoardSettings>): BoardSettings {
    const current = this.getSettings();
    const next = { ...current, ...patch };
    const upsert = this.db.prepare(
      `INSERT INTO board_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of Object.entries(next)) {
      let serialized: string;
      if (typeof value === "boolean") serialized = value ? "1" : "0";
      else if (value == null) serialized = "";
      else serialized = String(value);
      upsert.run(key, serialized);
    }
    return this.getSettings();
  }

  private appendEvent(
    taskId: string,
    kind: string,
    payload: Record<string, unknown> = {},
    runIdValue: string | null = null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO task_events (task_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(taskId, runIdValue, kind, JSON.stringify(payload), nowIso());
  }

  getTask(id: string): KanbanTask | null {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE id = ?`)
      .get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  listTasks(filters?: {
    status?: KanbanStatus | KanbanStatus[];
    assignee?: string;
    tenant?: string | null;
    includeArchived?: boolean;
    limit?: number;
  }): KanbanTask[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!filters?.includeArchived) {
      clauses.push(`status != 'archived'`);
    }
    if (filters?.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (filters?.assignee) {
      clauses.push(`assignee = ?`);
      params.push(filters.assignee);
    }
    if (filters?.tenant !== undefined) {
      if (filters.tenant == null || filters.tenant === "") {
        clauses.push(`tenant IS NULL`);
      } else {
        clauses.push(`tenant = ?`);
        params.push(filters.tenant);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit =
      filters?.limit && filters.limit > 0
        ? `LIMIT ${Math.min(filters.limit, 5000)}`
        : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at ASC ${limit}`,
      )
      .all(...(params as never[])) as TaskRow[];
    return rows.map(rowToTask);
  }

  createTask(input: CreateTaskInput): KanbanTask {
    if (input.idempotencyKey) {
      const existing = this.db
        .prepare(`SELECT * FROM tasks WHERE idempotency_key = ?`)
        .get(input.idempotencyKey) as TaskRow | undefined;
      if (existing) return rowToTask(existing);
    }

    const id = shortId();
    const created = nowIso();
    const status: KanbanStatus = input.triage
      ? "triage"
      : (input.status ??
        (input.assignee || this.getSettings().defaultAssignee
          ? "todo"
          : "todo"));
    const assignee =
      input.assignee !== undefined
        ? input.assignee
        : this.getSettings().defaultAssignee || null;
    const skills = JSON.stringify(input.skills ?? []);
    const projectId = input.projectId?.trim() || null;
    const workspaceKind: WorkspaceKind = projectId
      ? "project"
      : (input.workspaceKind ?? "scratch");
    const workspacePath = projectId
      ? (input.workspacePath ?? null)
      : (input.workspacePath ?? null);

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, title, body, status, assignee, tenant, priority,
          project_id, workspace_kind, workspace_path, branch, scheduled_at,
          goal_mode, goal_max_turns, idempotency_key,
          max_runtime_seconds, max_retries, skills_json,
          model_override, provider_override, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title.trim(),
        (input.body ?? "").trim(),
        status,
        assignee || null,
        input.tenant ?? null,
        input.priority ?? 0,
        projectId,
        workspaceKind,
        workspacePath,
        input.branch ?? null,
        input.scheduledAt ?? null,
        input.goalMode ? 1 : 0,
        input.goalMaxTurns ?? 20,
        input.idempotencyKey ?? null,
        input.maxRuntimeSeconds ?? null,
        input.maxRetries ?? null,
        skills,
        input.modelOverride ?? null,
        input.providerOverride ?? null,
        created,
        created,
      );

    this.appendEvent(id, "created", {
      assignee,
      status,
      parents: input.parents ?? [],
      tenant: input.tenant ?? null,
      projectId,
    });

    for (const parentId of input.parents ?? []) {
      this.linkTasks(parentId, id);
    }

    const task = this.getTask(id);
    if (!task) throw new Error(`Failed to create task ${id}`);
    return task;
  }

  updateTask(
    id: string,
    patch: Partial<{
      title: string;
      body: string;
      status: KanbanStatus;
      assignee: string | null;
      tenant: string | null;
      priority: number;
      result: string | null;
      scheduledAt: string | null;
      goalMode: boolean;
      goalMaxTurns: number;
      projectId: string | null;
      workspaceKind: WorkspaceKind;
      workspacePath: string | null;
      branch: string | null;
      modelOverride: string | null;
      providerOverride: string | null;
      skills: string[];
      metadataJson: string;
    }>,
  ): KanbanTask {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`Task ${id} not found`);

    const nextProjectId =
      patch.projectId !== undefined ? patch.projectId : existing.projectId;
    const nextWorkspaceKind: WorkspaceKind = nextProjectId
      ? "project"
      : (patch.workspaceKind ?? existing.workspaceKind);

    const next = {
      title: patch.title ?? existing.title,
      body: patch.body ?? existing.body,
      status: patch.status ?? existing.status,
      assignee:
        patch.assignee !== undefined ? patch.assignee : existing.assignee,
      tenant: patch.tenant !== undefined ? patch.tenant : existing.tenant,
      priority: patch.priority ?? existing.priority,
      result: patch.result !== undefined ? patch.result : existing.result,
      scheduledAt:
        patch.scheduledAt !== undefined
          ? patch.scheduledAt
          : existing.scheduledAt,
      goalMode: patch.goalMode ?? existing.goalMode,
      goalMaxTurns: patch.goalMaxTurns ?? existing.goalMaxTurns,
      projectId: nextProjectId,
      workspaceKind: nextWorkspaceKind,
      workspacePath:
        patch.workspacePath !== undefined
          ? patch.workspacePath
          : existing.workspacePath,
      branch: patch.branch !== undefined ? patch.branch : existing.branch,
      modelOverride:
        patch.modelOverride !== undefined
          ? patch.modelOverride
          : existing.modelOverride,
      providerOverride:
        patch.providerOverride !== undefined
          ? patch.providerOverride
          : existing.providerOverride,
      skillsJson: patch.skills
        ? JSON.stringify(patch.skills)
        : existing.skillsJson,
      metadataJson: patch.metadataJson ?? existing.metadataJson,
    };

    const updated = nowIso();
    this.db
      .prepare(
        `UPDATE tasks SET
          title=?, body=?, status=?, assignee=?, tenant=?, priority=?,
          result=?, scheduled_at=?, goal_mode=?, goal_max_turns=?,
          project_id=?, workspace_kind=?, workspace_path=?, branch=?,
          model_override=?, provider_override=?, skills_json=?, metadata_json=?,
          updated_at=?
         WHERE id=?`,
      )
      .run(
        next.title,
        next.body,
        next.status,
        next.assignee,
        next.tenant,
        next.priority,
        next.result,
        next.scheduledAt,
        next.goalMode ? 1 : 0,
        next.goalMaxTurns,
        next.projectId,
        next.workspaceKind,
        next.workspacePath,
        next.branch,
        next.modelOverride,
        next.providerOverride,
        next.skillsJson,
        next.metadataJson,
        updated,
        id,
      );

    if (patch.status && patch.status !== existing.status) {
      this.appendEvent(id, "status", { status: patch.status }, existing.currentRunId);
      if (existing.status === "running" && patch.status !== "running") {
        this.reclaimRun(id, "reclaimed");
      }
    }
    if (patch.assignee !== undefined && patch.assignee !== existing.assignee) {
      this.appendEvent(id, "assigned", { assignee: patch.assignee });
    }
    if (
      (patch.title !== undefined && patch.title !== existing.title) ||
      (patch.body !== undefined && patch.body !== existing.body)
    ) {
      this.appendEvent(id, "edited", {
        fields: [
          ...(patch.title !== undefined ? ["title"] : []),
          ...(patch.body !== undefined ? ["body"] : []),
        ],
      });
    }
    if (patch.priority !== undefined && patch.priority !== existing.priority) {
      this.appendEvent(id, "reprioritized", { priority: patch.priority });
    }

    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} missing after update`);
    return task;
  }

  deleteTask(id: string): void {
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  }

  linkTasks(parentId: string, childId: string): void {
    if (parentId === childId) throw new Error("Cannot link a task to itself");
    if (!this.getTask(parentId) || !this.getTask(childId)) {
      throw new Error("Parent or child task not found");
    }
    if (this.wouldCreateCycle(parentId, childId)) {
      throw new Error("Link would create a dependency cycle");
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)`,
      )
      .run(parentId, childId);
  }

  unlinkTasks(parentId: string, childId: string): void {
    this.db
      .prepare(`DELETE FROM task_links WHERE parent_id = ? AND child_id = ?`)
      .run(parentId, childId);
  }

  private wouldCreateCycle(parentId: string, childId: string): boolean {
    // Adding parent → child: cycle if parent is reachable from child
    const stack = [childId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === parentId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const kids = this.getChildren(cur);
      stack.push(...kids);
    }
    return false;
  }

  getParents(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT parent_id FROM task_links WHERE child_id = ?`)
      .all(taskId) as Array<{ parent_id: string }>;
    return rows.map((r) => r.parent_id);
  }

  getChildren(taskId: string): string[] {
    const rows = this.db
      .prepare(`SELECT child_id FROM task_links WHERE parent_id = ?`)
      .all(taskId) as Array<{ child_id: string }>;
    return rows.map((r) => r.child_id);
  }

  addComment(taskId: string, body: string, author = "user"): TaskComment {
    if (!this.getTask(taskId)) throw new Error(`Task ${taskId} not found`);
    const id = randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO task_comments (id, task_id, author, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, author, body.trim(), createdAt);
    return { id, taskId, author, body: body.trim(), createdAt };
  }

  listComments(taskId: string): TaskComment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC`,
      )
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: asString(r.id),
      taskId: asString(r.task_id),
      author: asString(r.author),
      body: asString(r.body),
      createdAt: asString(r.created_at),
    }));
  }

  listEvents(taskId: string, limit = 50): TaskEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(taskId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: asNumber(r.id),
      taskId: asString(r.task_id),
      runId: asNullableString(r.run_id),
      kind: asString(r.kind),
      payloadJson: asString(r.payload_json),
      createdAt: asString(r.created_at),
    }));
  }

  listRuns(taskId: string): TaskRun[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC`,
      )
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: asString(r.id),
      taskId: asString(r.task_id),
      profile: asString(r.profile),
      outcome: asNullableString(r.outcome),
      summary: asNullableString(r.summary),
      metadataJson: asNullableString(r.metadata_json),
      error: asNullableString(r.error),
      startedAt: asString(r.started_at),
      endedAt: asNullableString(r.ended_at),
    }));
  }

  listAttachments(taskId: string): TaskAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC`,
      )
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: asString(r.id),
      taskId: asString(r.task_id),
      name: asString(r.name),
      absPath: asString(r.abs_path),
      sizeBytes: asNumber(r.size_bytes),
      createdAt: asString(r.created_at),
    }));
  }

  addAttachment(
    taskId: string,
    name: string,
    absPath: string,
    sizeBytes: number,
  ): TaskAttachment {
    if (!this.getTask(taskId)) throw new Error(`Task ${taskId} not found`);
    const id = randomUUID();
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO task_attachments (id, task_id, name, abs_path, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, name, absPath, sizeBytes, createdAt);
    return { id, taskId, name, absPath, sizeBytes, createdAt };
  }

  getDetail(id: string): TaskDetail | null {
    const task = this.getTask(id);
    if (!task) return null;
    return {
      task,
      comments: this.listComments(id),
      events: this.listEvents(id),
      runs: this.listRuns(id),
      parents: this.getParents(id),
      children: this.getChildren(id),
      attachments: this.listAttachments(id),
    };
  }

  /** Promote todo → ready when parents done and assignee present. Respects scheduled_at for dispatch, not promotion. */
  recomputeReady(): string[] {
    const settings = this.getSettings();
    const todos = this.listTasks({ status: "todo" });
    const promoted: string[] = [];
    for (const task of todos) {
      const assignee = task.assignee || settings.defaultAssignee || null;
      if (!assignee) continue;
      const parents = this.getParents(task.id);
      const allDone = parents.every((pid) => {
        const p = this.getTask(pid);
        return p?.status === "done";
      });
      if (!allDone) continue;
      if (!task.assignee && settings.defaultAssignee) {
        this.updateTask(task.id, { assignee: settings.defaultAssignee });
      }
      this.db
        .prepare(
          `UPDATE tasks SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'todo'`,
        )
        .run(nowIso(), task.id);
      this.appendEvent(task.id, "promoted", {});
      promoted.push(task.id);
    }
    return promoted;
  }

  private isScheduledDue(task: KanbanTask, now = Date.now()): boolean {
    if (!task.scheduledAt) return true;
    const t = Date.parse(task.scheduledAt);
    return Number.isFinite(t) && t <= now;
  }

  listClaimableReady(now = Date.now()): KanbanTask[] {
    return this.listTasks({ status: "ready" }).filter((t) =>
      this.isScheduledDue(t, now),
    );
  }

  listClaimableReview(): KanbanTask[] {
    return this.listTasks({ status: "review" });
  }

  countRunning(assignee?: string): number {
    const running = this.listTasks({ status: "running" });
    if (!assignee) return running.length;
    return running.filter((t) => t.assignee === assignee).length;
  }

  claimTask(
    taskId: string,
    profile: string,
    ttlSeconds = 3600,
  ): { task: KanbanTask; run: TaskRun } | null {
    const lock = randomUUID();
    const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const started = nowIso();
    const rid = runId();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(`SELECT * FROM tasks WHERE id = ?`)
        .get(taskId) as TaskRow | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const task = rowToTask(row);
      if (task.status !== "ready" && task.status !== "review") {
        this.db.exec("ROLLBACK");
        return null;
      }
      if (task.status === "ready" && !this.isScheduledDue(task)) {
        this.db.exec("ROLLBACK");
        return null;
      }
      if (task.claimLock && task.claimExpiresAt) {
        const exp = Date.parse(task.claimExpiresAt);
        if (Number.isFinite(exp) && exp > Date.now()) {
          this.db.exec("ROLLBACK");
          return null;
        }
      }

      this.db
        .prepare(
          `UPDATE tasks SET
            status = 'running',
            assignee = ?,
            claim_lock = ?,
            claim_expires_at = ?,
            current_run_id = ?,
            last_heartbeat_at = ?,
            updated_at = ?
           WHERE id = ?`,
        )
        .run(profile, lock, expires, rid, started, started, taskId);

      this.db
        .prepare(
          `INSERT INTO task_runs (id, task_id, profile, started_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(rid, taskId, profile, started);

      this.appendEvent(taskId, "claimed", { lock, expires, run_id: rid }, rid);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    const task = this.getTask(taskId);
    const run = this.listRuns(taskId).find((r) => r.id === rid);
    if (!task || !run) return null;
    return { task, run };
  }

  claimReviewTask(
    taskId: string,
    reviewerProfile: string,
    ttlSeconds = 3600,
  ): { task: KanbanTask; run: TaskRun } | null {
    const task = this.getTask(taskId);
    if (!task || task.status !== "review") return null;
    return this.claimTask(taskId, reviewerProfile, ttlSeconds);
  }

  heartbeat(taskId: string, note?: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== "running") {
      throw new Error(`Task ${taskId} is not running`);
    }
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE tasks SET last_heartbeat_at = ?, claim_expires_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        ts,
        new Date(Date.now() + 3600 * 1000).toISOString(),
        ts,
        taskId,
      );
    this.appendEvent(taskId, "heartbeat", { note: note ?? null }, task.currentRunId);
  }

  private closeRun(
    taskId: string,
    outcome: string,
    fields?: {
      summary?: string | null;
      metadata?: Record<string, unknown> | null;
      error?: string | null;
    },
  ): string | null {
    const task = this.getTask(taskId);
    const rid = task?.currentRunId;
    if (!rid) {
      // Synthesize zero-duration run for never-claimed completions
      const synth = runId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO task_runs (id, task_id, profile, outcome, summary, metadata_json, error, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          synth,
          taskId,
          task?.assignee ?? "manual",
          outcome,
          fields?.summary ?? null,
          fields?.metadata ? JSON.stringify(fields.metadata) : null,
          fields?.error ?? null,
          ts,
          ts,
        );
      return synth;
    }
    this.db
      .prepare(
        `UPDATE task_runs SET outcome = ?, summary = COALESCE(?, summary),
          metadata_json = COALESCE(?, metadata_json), error = COALESCE(?, error),
          ended_at = ? WHERE id = ?`,
      )
      .run(
        outcome,
        fields?.summary ?? null,
        fields?.metadata ? JSON.stringify(fields.metadata) : null,
        fields?.error ?? null,
        nowIso(),
        rid,
      );
    this.db
      .prepare(
        `UPDATE tasks SET current_run_id = NULL, claim_lock = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(nowIso(), taskId);
    return rid;
  }

  private reclaimRun(taskId: string, outcome: string): void {
    const task = this.getTask(taskId);
    if (!task?.currentRunId) return;
    this.closeRun(taskId, outcome);
  }

  completeTask(
    taskId: string,
    opts?: {
      summary?: string;
      result?: string;
      metadata?: Record<string, unknown>;
    },
  ): KanbanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const rid = this.closeRun(taskId, "completed", {
      summary: opts?.summary ?? null,
      metadata: opts?.metadata ?? null,
    });
    this.db
      .prepare(
        `UPDATE tasks SET status = 'done', result = ?, consecutive_failures = 0,
          block_recurrences = 0, last_block_reason = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(opts?.result ?? opts?.summary ?? task.result, nowIso(), taskId);
    this.appendEvent(
      taskId,
      "completed",
      {
        result_len: (opts?.result ?? opts?.summary ?? "").length,
        summary: (opts?.summary ?? "").slice(0, 400) || undefined,
      },
      rid,
    );
    this.recomputeReady();
    return this.getTask(taskId)!;
  }

  blockTask(
    taskId: string,
    reason: string,
    kind: string | null = null,
  ): KanbanTask {
    const settings = this.getSettings();
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (kind === "dependency") {
      const rid = this.closeRun(taskId, "blocked", { error: reason });
      this.db
        .prepare(
          `UPDATE tasks SET status = 'todo', last_block_reason = ?, updated_at = ? WHERE id = ?`,
        )
        .run(reason, nowIso(), taskId);
      this.appendEvent(
        taskId,
        "dependency_wait",
        { reason, kind },
        rid,
      );
      return this.getTask(taskId)!;
    }

    const sameReason =
      task.lastBlockReason != null &&
      task.lastBlockReason.trim() === reason.trim();
    const recurrences = sameReason ? task.blockRecurrences + 1 : 1;
    const rid = this.closeRun(taskId, "blocked", { error: reason });

    if (recurrences > settings.blockRecurrenceLimit) {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'triage', block_recurrences = ?, last_block_reason = ?,
            updated_at = ? WHERE id = ?`,
        )
        .run(recurrences, reason, nowIso(), taskId);
      this.appendEvent(
        taskId,
        "block_loop_detected",
        {
          reason,
          kind,
          recurrences,
          limit: settings.blockRecurrenceLimit,
        },
        rid,
      );
    } else {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'blocked', block_recurrences = ?, last_block_reason = ?,
            updated_at = ? WHERE id = ?`,
        )
        .run(recurrences, reason, nowIso(), taskId);
      this.appendEvent(
        taskId,
        "blocked",
        { reason, kind, recurrences },
        rid,
      );
    }
    return this.getTask(taskId)!;
  }

  unblockTask(taskId: string): KanbanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const parents = this.getParents(taskId);
    const allDone = parents.every((pid) => this.getTask(pid)?.status === "done");
    const nextStatus: KanbanStatus = allDone ? "ready" : "todo";
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, consecutive_failures = 0, updated_at = ? WHERE id = ?`,
      )
      .run(nextStatus, nowIso(), taskId);
    this.appendEvent(taskId, "unblocked", {});
    return this.getTask(taskId)!;
  }

  archiveTask(taskId: string): KanbanTask {
    return this.updateTask(taskId, { status: "archived" });
  }

  recordSpawnFailed(taskId: string, error: string): KanbanTask {
    const settings = this.getSettings();
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const failures = task.consecutiveFailures + 1;
    const limit = task.maxRetries ?? settings.failureLimit;
    this.closeRun(taskId, "spawn_failed", { error });
    this.appendEvent(taskId, "spawn_failed", { error, failures });
    if (failures >= limit) {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'blocked', consecutive_failures = ?, last_block_reason = ?,
            updated_at = ? WHERE id = ?`,
        )
        .run(failures, error, nowIso(), taskId);
      this.appendEvent(taskId, "gave_up", {
        failures,
        effective_limit: limit,
        limit_source: task.maxRetries != null ? "task" : "board",
        error,
      });
    } else {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'ready', consecutive_failures = ?,
            claim_lock = NULL, claim_expires_at = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(failures, nowIso(), taskId);
    }
    return this.getTask(taskId)!;
  }

  recordProtocolViolation(taskId: string): KanbanTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const settings = this.getSettings();
    const limit = task.maxRetries ?? 3;
    const failures = task.consecutiveFailures + 1;
    this.closeRun(taskId, "protocol_violation", {
      error: "exited while still running",
      metadata: { protocol_violation: true },
    });
    this.appendEvent(taskId, "protocol_violation", {
      protocol_violation: true,
      failures,
    });
    if (failures >= limit) {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'blocked', consecutive_failures = ?,
            last_block_reason = ?, updated_at = ? WHERE id = ?`,
        )
        .run(failures, "protocol_violation", nowIso(), taskId);
      this.appendEvent(taskId, "gave_up", {
        failures,
        effective_limit: limit,
        error: "protocol_violation",
      });
    } else {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'ready', consecutive_failures = ?,
            claim_lock = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(failures, nowIso(), taskId);
    }
    return this.getTask(taskId)!;
  }

  reclaimStaleClaims(now = Date.now()): string[] {
    const settings = this.getSettings();
    const running = this.listTasks({ status: "running" });
    const reclaimed: string[] = [];
    for (const task of running) {
      const expires = task.claimExpiresAt
        ? Date.parse(task.claimExpiresAt)
        : NaN;
      const hb = task.lastHeartbeatAt
        ? Date.parse(task.lastHeartbeatAt)
        : Date.parse(task.updatedAt);
      const staleTimeout = settings.dispatchStaleTimeoutSeconds * 1000;
      const noHeartbeat = Number.isFinite(hb) && now - hb > 60 * 60 * 1000;
      const tooLong =
        Number.isFinite(hb) && now - hb > staleTimeout && noHeartbeat;
      const lockExpired = Number.isFinite(expires) && expires <= now;

      if (tooLong) {
        this.closeRun(task.id, "stale");
        this.db
          .prepare(
            `UPDATE tasks SET status = 'ready', claim_lock = NULL, claim_expires_at = NULL,
              current_run_id = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(nowIso(), task.id);
        this.appendEvent(task.id, "stale", {
          elapsed_seconds: Math.floor((now - hb) / 1000),
          timeout_seconds: settings.dispatchStaleTimeoutSeconds,
        });
        reclaimed.push(task.id);
      } else if (lockExpired) {
        this.closeRun(task.id, "reclaimed");
        this.db
          .prepare(
            `UPDATE tasks SET status = 'ready', claim_lock = NULL, claim_expires_at = NULL,
              current_run_id = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(nowIso(), task.id);
        this.appendEvent(task.id, "reclaimed", { stale_lock: true });
        reclaimed.push(task.id);
      }
    }
    return reclaimed;
  }

  countChangesRequested(taskId: string): number {
    const rows = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM task_events WHERE task_id = ? AND kind = 'changes_requested'`,
      )
      .get(taskId) as { c: number };
    return asNumber(rows?.c, 0);
  }

  getLastEventOfKind(
    taskId: string,
    kind: string,
  ): TaskEvent | null {
    const row = this.db
      .prepare(
        `SELECT * FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId, kind) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: asNumber(row.id),
      taskId: asString(row.task_id),
      runId: asNullableString(row.run_id),
      kind: asString(row.kind),
      payloadJson: asString(row.payload_json),
      createdAt: asString(row.created_at),
    };
  }

  /** Expose append for review/goal modules */
  emitEvent(
    taskId: string,
    kind: string,
    payload: Record<string, unknown> = {},
    runIdValue: string | null = null,
  ): void {
    this.appendEvent(taskId, kind, payload, runIdValue);
  }

  clearClaim(taskId: string): void {
    this.db
      .prepare(
        `UPDATE tasks SET claim_lock = NULL, claim_expires_at = NULL, current_run_id = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(nowIso(), taskId);
  }

  /** Close current run with an outcome without changing task status. */
  finalizeRun(
    taskId: string,
    outcome: string,
    fields?: {
      summary?: string | null;
      metadata?: Record<string, unknown> | null;
      error?: string | null;
    },
  ): string | null {
    return this.closeRun(taskId, outcome, fields);
  }

  setStatusRaw(taskId: string, status: KanbanStatus): void {
    this.db
      .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, nowIso(), taskId);
  }
}

const storeCache = new Map<string, KanbanStore>();

export function openBoardStore(boardSlug: string, root?: string): KanbanStore {
  const slug = normalizeBoardSlug(boardSlug);
  if (!isValidBoardSlug(slug)) {
    throw new Error(`Invalid board slug: ${boardSlug}`);
  }
  const key = `${root ?? ""}::${slug}`;
  let store = storeCache.get(key);
  if (!store) {
    store = new KanbanStore(slug, root);
    storeCache.set(key, store);
  }
  return store;
}

export function closeAllBoardStores(): void {
  for (const store of storeCache.values()) store.close();
  storeCache.clear();
}

export { DEFAULT_BOARD_SETTINGS };
