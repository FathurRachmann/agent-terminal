import fs from "node:fs";
import path from "node:path";

export type SessionStatus = "idle" | "running" | "completed" | "error";

export type SessionState = {
  threadId: string;
  workspaceRoot: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  turnCount: number;
  lastPrompt?: string;
  lastResponsePreview?: string;
  lastStatus: SessionStatus;
  lastError?: string;
};

export type TranscriptRole =
  | "user"
  | "assistant"
  | "tool"
  | "system"
  | "interrupt"
  | "error"
  | "reflection";

export type TranscriptEvent = {
  ts: string;
  threadId: string;
  role: TranscriptRole;
  content: string;
  meta?: Record<string, unknown>;
};

/**
 * Persistent Memory — raw session state + append-only interaction history.
 * Deterministic durability; no relevance filtering here.
 */
export class SessionStore {
  readonly workspaceRoot: string;
  readonly sessionPath: string;
  readonly transcriptsDir: string;
  readonly configSnapshotPath: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    const memoryDir = path.join(this.workspaceRoot, ".agent", "memory");
    this.transcriptsDir = path.join(memoryDir, "sessions");
    this.sessionPath = path.join(this.workspaceRoot, ".agent", "session.json");
    this.configSnapshotPath = path.join(memoryDir, "config-snapshot.json");
    fs.mkdirSync(this.transcriptsDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
  }

  readSession(): SessionState | null {
    if (!fs.existsSync(this.sessionPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.sessionPath, "utf8")) as SessionState;
    } catch {
      return null;
    }
  }

  writeSession(state: SessionState): void {
    const next: SessionState = {
      ...state,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.sessionPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  startOrResume(options: {
    threadId: string;
    model: string;
  }): SessionState {
    const existing = this.readSession();
    const now = new Date().toISOString();
    if (existing && existing.threadId === options.threadId) {
      const resumed: SessionState = {
        ...existing,
        model: options.model,
        workspaceRoot: this.workspaceRoot,
        updatedAt: now,
        lastStatus: "running",
        lastError: undefined,
      };
      this.writeSession(resumed);
      return resumed;
    }
    const created: SessionState = {
      threadId: options.threadId,
      workspaceRoot: this.workspaceRoot,
      model: options.model,
      startedAt: now,
      updatedAt: now,
      turnCount: 0,
      lastStatus: "running",
    };
    this.writeSession(created);
    return created;
  }

  markTurnStart(prompt: string): SessionState {
    const current = this.readSession();
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: SessionState = {
      ...current,
      lastPrompt: prompt,
      lastStatus: "running",
      lastError: undefined,
      turnCount: current.turnCount + 1,
    };
    this.writeSession(next);
    return next;
  }

  markTurnComplete(response: string): SessionState {
    const current = this.readSession();
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: SessionState = {
      ...current,
      lastStatus: "completed",
      lastResponsePreview: response.slice(0, 500),
      lastError: undefined,
    };
    this.writeSession(next);
    return next;
  }

  markTurnError(error: string): SessionState {
    const current = this.readSession();
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: SessionState = {
      ...current,
      lastStatus: "error",
      lastError: error.slice(0, 1000),
    };
    this.writeSession(next);
    return next;
  }

  appendTranscript(event: Omit<TranscriptEvent, "ts">): void {
    const full: TranscriptEvent = {
      ...event,
      ts: new Date().toISOString(),
    };
    const file = path.join(this.transcriptsDir, `${sanitizeThreadId(event.threadId)}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`, "utf8");
  }

  readTranscript(threadId: string, limit = 200): TranscriptEvent[] {
    const file = path.join(this.transcriptsDir, `${sanitizeThreadId(threadId)}.jsonl`);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const sliced = lines.slice(-limit);
    const events: TranscriptEvent[] = [];
    for (const line of sliced) {
      try {
        events.push(JSON.parse(line) as TranscriptEvent);
      } catch {
        // Skip corrupt/truncated lines from crash mid-write.
      }
    }
    return events;
  }

  /**
   * List chat sessions from transcript files (newest first).
   */
  listSessions(): Array<{
    threadId: string;
    updatedAt: string;
    preview: string;
    turnCount: number;
  }> {
    if (!fs.existsSync(this.transcriptsDir)) return [];
    const files = fs
      .readdirSync(this.transcriptsDir)
      .filter((f) => f.endsWith(".jsonl"));
    const sessions: Array<{
      threadId: string;
      updatedAt: string;
      preview: string;
      turnCount: number;
      mtime: number;
    }> = [];

    for (const file of files) {
      const full = path.join(this.transcriptsDir, file);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      const threadId = file.replace(/\.jsonl$/, "");
      const events = this.readTranscript(threadId, 80);
      const users = events.filter((e) => e.role === "user");
      const lastUser = users[users.length - 1];
      const lastAny = events[events.length - 1];
      sessions.push({
        threadId,
        mtime,
        updatedAt: lastAny?.ts ?? new Date(mtime).toISOString(),
        preview: (lastUser?.content || lastAny?.content || "(empty)").slice(0, 80),
        turnCount: users.length,
      });
    }

    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions.map(({ threadId, updatedAt, preview, turnCount }) => ({
      threadId,
      updatedAt,
      preview,
      turnCount,
    }));
  }

  writeConfigSnapshot(config: Record<string, unknown>): void {
    fs.writeFileSync(
      this.configSnapshotPath,
      `${JSON.stringify({ ...config, savedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }
}

function sanitizeThreadId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
}
