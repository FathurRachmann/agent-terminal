import { randomUUID } from "node:crypto";
import * as pty from "node-pty";

export type TerminalSessionInfo = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  pid: number;
};

export type TerminalCreateOptions = {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
};

type SessionRecord = {
  id: string;
  term: pty.IPty;
  cwd: string;
  cols: number;
  rows: number;
};

export type TerminalServiceHandlers = {
  onData: (sessionId: string, data: string) => void;
  onExit: (sessionId: string, exitCode: number, signal?: number) => void;
};

function defaultShell(): string {
  if (process.env.PTY_SHELL) return process.env.PTY_SHELL;
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "win32") return "powershell.exe";
  return "/bin/bash";
}

/**
 * Interactive user terminals for the desktop UI.
 * Separate from the agent PtySandbox pool used by `execute`.
 */
export class TerminalService {
  private readonly sessions = new Map<string, SessionRecord>();
  private handlers: TerminalServiceHandlers | null = null;

  setHandlers(handlers: TerminalServiceHandlers | null): void {
    this.handlers = handlers;
  }

  create(options: TerminalCreateOptions = {}): TerminalSessionInfo {
    const cols = Math.max(20, Math.floor(options.cols ?? 120));
    const rows = Math.max(5, Math.floor(options.rows ?? 30));
    const cwd = options.cwd || process.cwd();
    const shellPath = options.shell || defaultShell();
    const id = randomUUID();

    const term = pty.spawn(shellPath, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    const record: SessionRecord = { id, term, cwd, cols, rows };
    this.sessions.set(id, record);

    term.onData((data) => {
      this.handlers?.onData(id, data);
    });

    term.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.handlers?.onExit(id, exitCode, signal);
    });

    return {
      id,
      cwd,
      cols,
      rows,
      pid: term.pid,
    };
  }

  write(id: string, data: string): { ok: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: "session not found" };
    if (typeof data !== "string" || data.length === 0) {
      return { ok: true };
    }
    try {
      session.term.write(data);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  resize(
    id: string,
    cols: number,
    rows: number,
  ): { ok: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: "session not found" };
    const nextCols = Math.max(20, Math.floor(cols));
    const nextRows = Math.max(5, Math.floor(rows));
    try {
      session.term.resize(nextCols, nextRows);
      session.cols = nextCols;
      session.rows = nextRows;
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  kill(id: string): { ok: boolean; error?: string } {
    const session = this.sessions.get(id);
    if (!session) return { ok: false, error: "session not found" };
    try {
      session.term.kill();
    } catch {
      /* ignore */
    }
    this.sessions.delete(id);
    return { ok: true };
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      pid: s.term.pid,
    }));
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.term.kill();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }
}

export const terminalService = new TerminalService();
