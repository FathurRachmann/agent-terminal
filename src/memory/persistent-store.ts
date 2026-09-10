import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { MemoryKind, MemoryRecord, MemoryWriteInput } from "./types.js";
import {
  deserializeEmbedding,
  serializeEmbedding,
  type EmbeddingClient,
} from "./embeddings.js";

/**
 * Durable store for cognitive memory records + optional embedding vectors.
 * Part of Persistent Memory infrastructure; Long-Term layer queries this store.
 */
export class PersistentMemoryStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(workspaceRoot: string) {
    const dir = path.join(workspaceRoot, ".agent", "memory");
    fs.mkdirSync(dir, { recursive: true });
    this.dbPath = path.join(dir, "persistent.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        embedding BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
    `);
    this.ensureEmbeddingColumn();
  }

  private ensureEmbeddingColumn(): void {
    const cols = this.db.prepare(`PRAGMA table_info(memories)`).all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === "embedding")) {
      this.db.exec(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
    }
  }

  close(): void {
    this.db.close();
  }

  upsert(input: MemoryWriteInput): MemoryRecord {
    const now = Date.now();
    const id = input.id ?? randomUUID();
    const existing = this.getById(id);
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const importance = clamp(input.importance ?? existing?.importance ?? 0.5, 0, 1);

    if (existing) {
      this.db
        .prepare(
          `UPDATE memories
           SET kind = ?, title = ?, content = ?, tags = ?, importance = ?,
               updated_at = ?, last_accessed_at = ?
           WHERE id = ?`,
        )
        .run(
          input.kind,
          input.title.trim(),
          input.content.trim(),
          tags.join(","),
          importance,
          now,
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO memories
           (id, kind, title, content, tags, importance, created_at, updated_at, last_accessed_at, access_count, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
        )
        .run(
          id,
          input.kind,
          input.title.trim(),
          input.content.trim(),
          tags.join(","),
          importance,
          now,
          now,
          now,
        );
    }

    const record = this.getById(id);
    if (!record) throw new Error(`Failed to persist memory ${id}`);
    return record;
  }

  async upsertWithEmbedding(
    input: MemoryWriteInput,
    embedder: EmbeddingClient,
  ): Promise<MemoryRecord> {
    const record = this.upsert(input);
    try {
      const [vec] = await embedder.embed([
        `${record.title}\n${record.content}\n${record.tags.join(" ")}`,
      ]);
      if (vec) this.setEmbedding(record.id, vec);
    } catch {
      // Lexical fallback remains available without embeddings.
    }
    return this.getById(record.id) ?? record;
  }

  setEmbedding(id: string, embedding: number[]): void {
    this.db
      .prepare(`UPDATE memories SET embedding = ? WHERE id = ?`)
      .run(serializeEmbedding(embedding), id);
  }

  getEmbedding(id: string): number[] | null {
    const row = this.db
      .prepare(`SELECT embedding FROM memories WHERE id = ?`)
      .get(id) as { embedding: Buffer | null } | undefined;
    return deserializeEmbedding(row?.embedding ?? null);
  }

  listWithEmbeddings(options?: {
    kind?: MemoryKind;
    limit?: number;
  }): Array<MemoryRecord & { embedding: number[] | null }> {
    const limit = options?.limit ?? 500;
    const rows = (
      options?.kind
        ? (this.db
            .prepare(
              `SELECT * FROM memories WHERE kind = ? ORDER BY updated_at DESC LIMIT ?`,
            )
            .all(options.kind, limit) as DbRow[])
        : (this.db
            .prepare(`SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?`)
            .all(limit) as DbRow[])
    );
    return rows.map((row) => ({
      ...rowToRecord(row),
      embedding: deserializeEmbedding(row.embedding ?? null),
    }));
  }

  getById(id: string): MemoryRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ?`)
      .get(id) as DbRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(options?: { kind?: MemoryKind; limit?: number }): MemoryRecord[] {
    return this.listWithEmbeddings(options).map(
      ({ embedding: _e, ...rest }) => rest,
    );
  }

  touch(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE memories
       SET last_accessed_at = ?, access_count = access_count + 1
       WHERE id = ?`,
    );
    this.db.exec("BEGIN");
    try {
      for (const id of ids) stmt.run(now, id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return Number(result.changes ?? 0) > 0;
  }

  syncRulesToAgentsMd(agentsMdPath: string): void {
    const rules = this.list({ kind: "rule", limit: 100 });
    const prefs = this.list({ kind: "preference", limit: 40 });
    const lines = [
      "# Agent Memory",
      "",
      "Persistent guidelines and user personalization. Synced from the durable memory store.",
      "",
      "## Known Pitfalls",
      "",
    ];
    for (const rule of rules) {
      lines.push(`- ${rule.content}`);
    }
    lines.push("", "## User preferences", "");
    if (prefs.length === 0) {
      lines.push("- (none yet — learned from ordinary chat)");
    } else {
      for (const pref of prefs) {
        lines.push(`- ${pref.content}`);
      }
    }
    lines.push("");
    fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
    fs.writeFileSync(agentsMdPath, lines.join("\n"), "utf8");
  }
}

type DbRow = {
  id: string;
  kind: string;
  title: string;
  content: string;
  tags: string;
  importance: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
  embedding?: Buffer | null;
};

function rowToRecord(row: DbRow): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    title: row.title,
    content: row.content,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
