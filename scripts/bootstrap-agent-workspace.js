/**
 * Idempotent workspace bootstrap for fresh clones.
 * - Ensures .agent layout exists
 * - Copies AGENTS.md.example → AGENTS.md if missing (does not overwrite)
 * - Creates empty persistent.sqlite with the same schema as PersistentMemoryStore
 * - Never deletes existing personal memory / sessions
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(root, ".agent");
const memoryDir = path.join(agentDir, "memory");
const sessionsDir = path.join(memoryDir, "sessions");
const contextDir = path.join(agentDir, "context");
const taskDir = path.join(agentDir, "task");
const skillsDir = path.join(agentDir, "skills");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureAgentsMd() {
  const target = path.join(agentDir, "AGENTS.md");
  const example = path.join(agentDir, "AGENTS.md.example");
  if (fs.existsSync(target)) return;
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, target);
    return;
  }
  fs.writeFileSync(
    target,
    `# Agent Memory\n\n## Known Pitfalls\n\n## User preferences\n\n- (none yet)\n`,
    "utf8",
  );
}

function ensurePersistentSchema() {
  ensureDir(memoryDir);
  const dbPath = path.join(memoryDir, "persistent.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
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
    const cols = db.prepare(`PRAGMA table_info(memories)`).all();
    if (!cols.some((c) => c.name === "embedding")) {
      db.exec(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
    }
  } finally {
    db.close();
  }
}

ensureDir(agentDir);
ensureDir(memoryDir);
ensureDir(sessionsDir);
ensureDir(contextDir);
ensureDir(taskDir);
ensureDir(skillsDir);
ensureDir(path.join(root, "working", "templates"));
ensureDir(path.join(root, "working", "global"));
ensureDir(path.join(root, "working", "bots"));
ensureAgentsMd();
ensurePersistentSchema();

console.log("[bootstrap] .agent workspace ready (empty schema if new)");
