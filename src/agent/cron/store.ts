import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { agentTerminalRoot } from "../profiles/paths.js";
import {
  applyCronKanbanAction,
  type CronKanbanAction,
} from "../kanban/cron-bridge.js";
import { openBoardStore } from "../kanban/store.js";

export type CronSchedule =
  | { kind: "interval"; everyMs: number }
  | { kind: "cron"; expr: string }
  | { kind: "once"; at: string };

export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  action: CronKanbanAction;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function cronRoot(root?: string): string {
  return path.join(agentTerminalRoot(root), "cron");
}

function jobsDbPath(root?: string): string {
  return path.join(cronRoot(root), "jobs.sqlite");
}

function parseCronExpr(expr: string, from: Date): Date | null {
  // Minimal 5-field support: m h dom mon dow — only handles simple numeric fields + *
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour] = parts;
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  for (let i = 0; i < 24 * 60; i++) {
    const mOk = min === "*" || Number(min) === next.getMinutes();
    const hOk = hour === "*" || Number(hour) === next.getHours();
    if (mOk && hOk) return next;
    next.setMinutes(next.getMinutes() + 1);
  }
  return null;
}

function computeNextRun(schedule: CronSchedule, from = new Date()): string | null {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.everyMs).toISOString();
  }
  if (schedule.kind === "once") {
    const t = Date.parse(schedule.at);
    if (!Number.isFinite(t)) return null;
    return t > from.getTime() ? schedule.at : null;
  }
  const next = parseCronExpr(schedule.expr, from);
  return next ? next.toISOString() : null;
}

export class CronStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(root?: string) {
    const dir = cronRoot(root);
    fs.mkdirSync(dir, { recursive: true });
    this.dbPath = jobsDbPath(root);
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        schedule_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private rowToJob(row: Record<string, unknown>): CronJob {
    return {
      id: String(row.id),
      name: String(row.name),
      enabled: row.enabled === 1 || row.enabled === true,
      schedule: JSON.parse(String(row.schedule_json)) as CronSchedule,
      action: JSON.parse(String(row.action_json)) as CronKanbanAction,
      lastRunAt: row.last_run_at == null ? null : String(row.last_run_at),
      nextRunAt: row.next_run_at == null ? null : String(row.next_run_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  list(): CronJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM cron_jobs ORDER BY created_at ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToJob(r));
  }

  get(id: string): CronJob | null {
    const row = this.db
      .prepare(`SELECT * FROM cron_jobs WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToJob(row) : null;
  }

  create(input: {
    name: string;
    schedule: CronSchedule;
    action: CronKanbanAction;
    enabled?: boolean;
  }): CronJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    const next = computeNextRun(input.schedule);
    this.db
      .prepare(
        `INSERT INTO cron_jobs
         (id, name, enabled, schedule_json, action_json, last_run_at, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        input.enabled === false ? 0 : 1,
        JSON.stringify(input.schedule),
        JSON.stringify(input.action),
        next,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(
    id: string,
    patch: Partial<{
      name: string;
      schedule: CronSchedule;
      action: CronKanbanAction;
      enabled: boolean;
    }>,
  ): CronJob {
    const job = this.get(id);
    if (!job) throw new Error(`Cron job ${id} not found`);
    const next: CronJob = {
      ...job,
      name: patch.name ?? job.name,
      schedule: patch.schedule ?? job.schedule,
      action: patch.action ?? job.action,
      enabled: patch.enabled ?? job.enabled,
      updatedAt: new Date().toISOString(),
    };
    if (patch.schedule) {
      next.nextRunAt = computeNextRun(next.schedule);
    }
    this.db
      .prepare(
        `UPDATE cron_jobs SET name=?, enabled=?, schedule_json=?, action_json=?,
          next_run_at=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.enabled ? 1 : 0,
        JSON.stringify(next.schedule),
        JSON.stringify(next.action),
        next.nextRunAt,
        next.updatedAt,
        id,
      );
    return this.get(id)!;
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM cron_jobs WHERE id = ?`).run(id);
  }

  tick(root?: string, now = Date.now()): Array<{ jobId: string; ok: boolean; error?: string }> {
    const due = this.list().filter((j) => {
      if (!j.enabled || !j.nextRunAt) return false;
      const t = Date.parse(j.nextRunAt);
      return Number.isFinite(t) && t <= now;
    });
    const results: Array<{ jobId: string; ok: boolean; error?: string }> = [];
    for (const job of due) {
      try {
        const board = job.action.board || "default";
        const store = openBoardStore(board, root);
        const result = applyCronKanbanAction(store, job.action);
        const ranAt = new Date(now).toISOString();
        let nextRun: string | null = null;
        if (job.schedule.kind === "once") {
          nextRun = null;
        } else {
          nextRun = computeNextRun(job.schedule, new Date(now));
        }
        this.db
          .prepare(
            `UPDATE cron_jobs SET last_run_at=?, next_run_at=?, enabled=?, updated_at=? WHERE id=?`,
          )
          .run(
            ranAt,
            nextRun,
            job.schedule.kind === "once" ? 0 : job.enabled ? 1 : 0,
            ranAt,
            job.id,
          );
        results.push({
          jobId: job.id,
          ok: result.ok,
          error: result.ok ? undefined : result.error,
        });
      } catch (err) {
        results.push({
          jobId: job.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}

export function parseInterval(spec: string): number | null {
  const m = /^(\d+)(s|m|h|d)$/i.exec(spec.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}
