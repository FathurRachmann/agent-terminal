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
  /** Null/undefined = global (non-project) session. */
  projectId?: string | null;
};

export type SessionListItem = {
  threadId: string;
  updatedAt: string;
  preview: string;
  turnCount: number;
  projectId: string | null;
  workspaceId: string | null;
  chatId: string | null;
};

export type SessionMeta = {
  projectId: string | null;
  workspaceId?: string | null;
  chatId?: string | null;
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
  /** Project workspace (tool cwd). */
  readonly workspaceRoot: string;
  /** Profile/agent state root (contains `.agent/`). Defaults to workspaceRoot. */
  readonly agentHome: string;
  readonly sessionPath: string;
  readonly transcriptsDir: string;
  readonly configSnapshotPath: string;

  constructor(workspaceRoot: string, agentHome?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.agentHome = path.resolve(agentHome ?? workspaceRoot);
    const memoryDir = path.join(this.agentHome, ".agent", "memory");
    this.transcriptsDir = path.join(memoryDir, "sessions");
    this.sessionPath = path.join(this.agentHome, ".agent", "session.json");
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

  threadStatePath(threadId: string): string {
    return path.join(
      this.transcriptsDir,
      `${sanitizeThreadId(threadId)}.state.json`,
    );
  }

  readThreadSession(threadId: string): SessionState | null {
    const file = this.threadStatePath(threadId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as SessionState;
    } catch {
      return null;
    }
  }

  writeThreadSession(threadId: string, state: SessionState): void {
    const next: SessionState = {
      ...state,
      threadId,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(this.transcriptsDir, { recursive: true });
    fs.writeFileSync(
      this.threadStatePath(threadId),
      `${JSON.stringify(next, null, 2)}\n`,
      "utf8",
    );
    // Keep global pointer as last-touched thread for UI compatibility.
    this.writeSession(next);
  }

  startOrResume(options: {
    threadId: string;
    model: string;
    projectId?: string | null;
    workspaceId?: string | null;
    chatId?: string | null;
  }): SessionState {
    const existing =
      this.readThreadSession(options.threadId) ??
      (() => {
        const global = this.readSession();
        return global?.threadId === options.threadId ? global : null;
      })();
    const now = new Date().toISOString();
    const projectId =
      options.projectId === undefined ? null : options.projectId;
    const workspaceId =
      options.workspaceId === undefined ? undefined : options.workspaceId;
    const chatId = options.chatId === undefined ? undefined : options.chatId;
    if (existing && existing.threadId === options.threadId) {
      const prevMeta = this.readSessionMeta(options.threadId);
      const resumed: SessionState = {
        ...existing,
        model: options.model,
        workspaceRoot: this.workspaceRoot,
        updatedAt: now,
        lastStatus: "running",
        lastError: undefined,
        projectId:
          options.projectId !== undefined
            ? projectId
            : (existing.projectId ?? null),
      };
      this.writeThreadSession(options.threadId, resumed);
      this.writeSessionMeta(options.threadId, {
        projectId: resumed.projectId ?? null,
        workspaceId:
          workspaceId !== undefined
            ? workspaceId
            : (prevMeta.workspaceId ?? null),
        chatId: chatId !== undefined ? chatId : (prevMeta.chatId ?? null),
      });
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
      projectId,
    };
    this.writeThreadSession(options.threadId, created);
    this.writeSessionMeta(options.threadId, {
      projectId,
      workspaceId: workspaceId ?? null,
      chatId: chatId ?? null,
    });
    return created;
  }

  metaPath(threadId: string): string {
    return path.join(
      this.transcriptsDir,
      `${sanitizeThreadId(threadId)}.meta.json`,
    );
  }

  readSessionMeta(threadId: string): SessionMeta {
    try {
      const file = this.metaPath(threadId);
      if (!fs.existsSync(file)) return { projectId: null };
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SessionMeta>;
      return {
        projectId:
          typeof raw.projectId === "string" && raw.projectId
            ? raw.projectId
            : null,
        workspaceId:
          typeof raw.workspaceId === "string" && raw.workspaceId
            ? raw.workspaceId
            : null,
        chatId:
          typeof raw.chatId === "string" && raw.chatId ? raw.chatId : null,
      };
    } catch {
      return { projectId: null };
    }
  }

  writeSessionMeta(threadId: string, meta: SessionMeta): void {
    fs.mkdirSync(this.transcriptsDir, { recursive: true });
    fs.writeFileSync(
      this.metaPath(threadId),
      `${JSON.stringify(
        {
          projectId: meta.projectId ?? null,
          workspaceId: meta.workspaceId ?? null,
          chatId: meta.chatId ?? null,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  markTurnStart(prompt: string, threadId?: string): SessionState {
    const tid = threadId ?? this.readSession()?.threadId;
    if (!tid) throw new Error("Session not initialized");
    const current =
      this.readThreadSession(tid) ??
      (this.readSession()?.threadId === tid ? this.readSession() : null);
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
    this.writeThreadSession(tid, next);
    return next;
  }

  markTurnComplete(response: string, threadId?: string): SessionState {
    const tid = threadId ?? this.readSession()?.threadId;
    if (!tid) throw new Error("Session not initialized");
    const current =
      this.readThreadSession(tid) ??
      (this.readSession()?.threadId === tid ? this.readSession() : null);
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: SessionState = {
      ...current,
      lastStatus: "completed",
      lastResponsePreview: response.slice(0, 500),
      lastError: undefined,
    };
    this.writeThreadSession(tid, next);
    return next;
  }

  markTurnError(error: string, threadId?: string): SessionState {
    const tid = threadId ?? this.readSession()?.threadId;
    if (!tid) throw new Error("Session not initialized");
    const current =
      this.readThreadSession(tid) ??
      (this.readSession()?.threadId === tid ? this.readSession() : null);
    if (!current) {
      throw new Error("Session not initialized");
    }
    const next: SessionState = {
      ...current,
      lastStatus: "error",
      lastError: error.slice(0, 1000),
    };
    this.writeThreadSession(tid, next);
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

  transcriptPath(threadId: string): string {
    return path.join(
      this.transcriptsDir,
      `${sanitizeThreadId(threadId)}.jsonl`,
    );
  }

  /** Wipe chat history for a thread; keep the session id / meta. */
  clearTranscript(threadId: string): void {
    const file = this.transcriptPath(threadId);
    fs.mkdirSync(this.transcriptsDir, { recursive: true });
    fs.writeFileSync(file, "", "utf8");
    const current = this.readSession();
    if (current?.threadId === threadId) {
      this.writeSession({
        ...current,
        turnCount: 0,
        lastPrompt: undefined,
        lastResponsePreview: undefined,
        lastStatus: "idle",
        lastError: undefined,
      });
    }
  }

  /** Remove transcript + meta for a thread. */
  deleteSession(threadId: string): void {
    const id = sanitizeThreadId(threadId);
    for (const file of [
      this.transcriptPath(threadId),
      this.metaPath(threadId),
      path.join(this.transcriptsDir, `${id}.jsonl`),
    ]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
    const current = this.readSession();
    if (current?.threadId === threadId) {
      try {
        if (fs.existsSync(this.sessionPath)) fs.unlinkSync(this.sessionPath);
      } catch {
        /* ignore */
      }
    }
  }

  /** Assign / unassign a session to a project (`null` = global). */
  setSessionProject(threadId: string, projectId: string | null): void {
    const prev = this.readSessionMeta(threadId);
    this.writeSessionMeta(threadId, {
      ...prev,
      projectId: projectId || null,
    });
    const current = this.readSession();
    if (current?.threadId === threadId) {
      this.writeSession({
        ...current,
        projectId: projectId || null,
      });
    }
  }

  /**
   * List chat sessions from transcript files (newest first).
   * @param projectId `null` = global only; string = that project; `undefined` = all
   */
  listSessions(projectId?: string | null): SessionListItem[] {
    if (!fs.existsSync(this.transcriptsDir)) return [];
    const files = fs
      .readdirSync(this.transcriptsDir)
      .filter((f) => f.endsWith(".jsonl"));
    const sessions: Array<SessionListItem & { mtime: number }> = [];

    for (const file of files) {
      const full = path.join(this.transcriptsDir, file);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      const threadId = file.replace(/\.jsonl$/, "");
      const meta = this.readSessionMeta(threadId);
      if (projectId !== undefined) {
        const want = projectId ?? null;
        if ((meta.projectId ?? null) !== want) continue;
      }
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
        projectId: meta.projectId ?? null,
        workspaceId: meta.workspaceId ?? null,
        chatId: meta.chatId ?? null,
      });
    }

    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions.map(
      ({ threadId, updatedAt, preview, turnCount, projectId, workspaceId, chatId }) => ({
        threadId,
        updatedAt,
        preview,
        turnCount,
        projectId,
        workspaceId,
        chatId,
      }),
    );
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
