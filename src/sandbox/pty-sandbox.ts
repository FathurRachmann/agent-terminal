import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as pty from "node-pty";
import {
  BaseSandbox,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileUploadResponse,
} from "deepagents";
import { checkCommand, checkCommandWorkspaceAccess, ensureLsLongListing } from "./guardrails.js";
import { registerPtyBackgroundProcess } from "../agent/process-manage.js";
import { resolveWorkingAwarePath } from "../agent/working-paths.js";
import {
  isBroadFilesystemRoot,
  mergeAllowedRoots,
  unrestrictedFilesystemRoots,
} from "../agent/default-sandbox-roots.js";

export type PtySandboxOptions = {
  workingDirectory: string;
  /** Extra allowed roots beyond workingDirectory (e.g. project folders). */
  initialAllowedRoots?: string[];
  /**
   * Agent repo root where `tmp/global|bots|project/...` artifacts live.
   * Relative paths starting with `tmp/` (or legacy `working/`) resolve here instead of cwd.
   */
  artifactHome?: string;
  /**
   * Privacy ON: confine to workspace/artifact (+ explicit grants).
   * Privacy OFF: ensure unrestricted filesystem roots stay on the allowlist.
   */
  privacyStrict?: boolean;
  timeoutMs?: number;
  shell?: string;
  cols?: number;
  rows?: number;
  /** Parallel interactive shells (default 3, env PTY_POOL_SIZE, max 10). */
  poolSize?: number;
  /** When true, destructive commands that normally need approval are allowed. */
  autoApproveDestructive?: boolean;
  onOutput?: (chunk: string) => void;
};

const AWAITING_INPUT_RE =
  /(\[y\/N\]|\[Y\/n\]|\(y\/n\)|password:|passphrase:|Continue\?|Overwrite\?|\(yes\/no\)|Press RETURN|More\?|--More--)\s*$/i;

const DEFAULT_POOL = 3;
/** Max shells for group-chat parallel bots (3 per bot × several bots). */
export const MAX_POOL = 10;
/** Pool size used for workspace group turns. */
export const GROUP_CHAT_PTY_POOL = 10;

export function resolvePoolSize(requested?: number): number {
  const fromEnv = Number(process.env.PTY_POOL_SIZE);
  const raw =
    typeof requested === "number" && Number.isFinite(requested)
      ? requested
      : Number.isFinite(fromEnv) && fromEnv > 0
        ? fromEnv
        : DEFAULT_POOL;
  return Math.max(1, Math.min(MAX_POOL, Math.floor(raw)));
}

function defaultShell(): string {
  if (process.env.PTY_SHELL) return process.env.PTY_SHELL;
  if (process.platform === "win32") return "powershell.exe";
  return "/bin/bash";
}

export function truncateOutput(
  text: string,
  headLines = 50,
  tailLines = 100,
): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= headLines + tailLines) {
    return { text, truncated: false };
  }
  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const omitted = lines.length - headLines - tailLines;
  // Prefer keeping error/signal lines from the omitted middle.
  const signalRe =
    /\b(error|exception|traceback|failed|FAIL|ENOENT|ELIFECYCLE|TypeError|ReferenceError)\b/i;
  const middle = lines.slice(headLines, -tailLines);
  const signals = middle.filter((l) => signalRe.test(l)).slice(0, 20);
  return {
    text: [
      ...head,
      `\n...[${omitted} lines truncated]...\n`,
      ...(signals.length ? ["[signal lines]", ...signals, ""] : []),
      ...tail,
    ].join("\n"),
    truncated: true,
  };
}

type SessionSpawnOpts = {
  id: number;
  shellPath: string;
  cols: number;
  rows: number;
  cwd: string;
  maxBufferBytes: number;
  onOutput?: (chunk: string) => void;
};

/** One interactive shell slot in the pool. */
class PtySession {
  readonly id: number;
  busy = false;
  private term: pty.IPty | null = null;
  private buffer = "";
  private readonly shellPath: string;
  private readonly cols: number;
  private readonly rows: number;
  private cwd: string;
  private readonly maxBufferBytes: number;
  private readonly onOutput?: (chunk: string) => void;

  constructor(opts: SessionSpawnOpts) {
    this.id = opts.id;
    this.shellPath = opts.shellPath;
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.cwd = opts.cwd;
    this.maxBufferBytes = opts.maxBufferBytes;
    this.onOutput = opts.onOutput;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  kill(): void {
    if (this.term) {
      try {
        this.term.kill();
      } catch {
        /* ignore */
      }
      this.term = null;
    }
    this.buffer = "";
  }

  ensure(): pty.IPty {
    if (this.term) return this.term;

    const term = pty.spawn(this.shellPath, [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        PAGER: "cat",
        GIT_PAGER: "cat",
        AGENT_PTY_SLOT: String(this.id),
      } as Record<string, string>,
    });

    term.onData((data) => {
      this.buffer += data;
      if (this.buffer.length > this.maxBufferBytes) {
        this.buffer = this.buffer.slice(this.buffer.length - this.maxBufferBytes);
      }
      this.onOutput?.(data);
    });

    term.onExit(() => {
      this.term = null;
    });

    this.term = term;
    return term;
  }

  write(data: string): void {
    this.ensure().write(data);
  }

  bufferLength(): number {
    return this.buffer.length;
  }

  bufferSlice(start: number): string {
    return this.buffer.slice(start);
  }

  signalEscalate(): void {
    if (!this.term) return;
    try {
      this.term.write("\x03");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        this.term?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 1500);
  }
}

/**
 * Persistent PTY-backed sandbox for Deep Agents.
 * Pool of interactive shells (default 3) so independent execute() calls can run in parallel.
 * cwd/env persist per slot across commands; grantFolderAccess restarts all slots.
 */
export class PtySandbox extends BaseSandbox {
  readonly id: string;
  private workingDirectory: string;
  private allowedRoots: string[];
  /** Agent root for remapping tmp/* (and legacy working/*) artifact paths. */
  private readonly artifactHome: string | null;
  /** Privacy ON → true: no auto-expand to Users / filesystem root. */
  private privacyStrict: boolean;
  private readonly timeoutMs: number;
  private readonly shellPath: string;
  private readonly cols: number;
  private readonly rows: number;
  private readonly autoApproveDestructive: boolean;
  private readonly onOutput?: (chunk: string) => void;
  private poolSize: number;
  private readonly sessions: PtySession[];
  private readonly waitQueue: Array<(session: PtySession) => void> = [];
  private lastSession: PtySession | null = null;

  private commandSeq = 0;
  private disposed = false;
  private readonly maxBufferBytes = 10 * 1024 * 1024;
  private readonly minTimeoutMs = 5_000;
  private readonly maxTimeoutMs = 10 * 60 * 1000;

  constructor(options: PtySandboxOptions) {
    super();
    this.workingDirectory = path.resolve(options.workingDirectory);
    this.artifactHome = options.artifactHome
      ? path.resolve(options.artifactHome)
      : null;
    this.privacyStrict = Boolean(options.privacyStrict);
    const extras = (options.initialAllowedRoots ?? [])
      .map((r) => path.resolve(r))
      .filter((r) => r && r !== this.workingDirectory);
    if (
      this.artifactHome &&
      this.artifactHome !== this.workingDirectory &&
      !extras.includes(this.artifactHome)
    ) {
      extras.push(this.artifactHome);
    }
    this.allowedRoots = [this.workingDirectory, ...extras];
    // Privacy OFF: guarantee whole-machine roots stay on the allowlist.
    this.ensureBroadAccess();
    // Ensure scoped working dirs exist under Agent root.
    if (this.artifactHome) {
      for (const sub of ["global", "bots", "templates"]) {
        fs.mkdirSync(path.join(this.artifactHome, "tmp", sub), {
          recursive: true,
        });
      }
      fs.mkdirSync(path.join(this.artifactHome, "tmp", "project"), {
        recursive: true,
      });
    }
    this.timeoutMs = options.timeoutMs ?? Number(process.env.PTY_TIMEOUT_MS ?? 60_000);
    this.shellPath = options.shell ?? defaultShell();
    this.cols = options.cols ?? 120;
    this.rows = options.rows ?? 40;
    this.autoApproveDestructive = options.autoApproveDestructive ?? false;
    this.onOutput = options.onOutput;
    this.poolSize = resolvePoolSize(options.poolSize);
    this.id = `pty-${this.workingDirectory.replace(/[^a-zA-Z0-9]/g, "-")}`;

    if (!fs.existsSync(this.workingDirectory)) {
      fs.mkdirSync(this.workingDirectory, { recursive: true });
    }

    this.sessions = Array.from({ length: this.poolSize }, (_, i) =>
      this.createSession(i),
    );
  }

  getPoolSize(): number {
    return this.poolSize;
  }

  /**
   * Grow the pool up to `wanted` (clamped by MAX_POOL) without killing busy slots.
   * Used by workspace group turns so several bots can share up to 10 shells.
   */
  ensurePoolSize(wanted: number): number {
    if (this.disposed) {
      throw new Error("PtySandbox has been disposed");
    }
    const target = resolvePoolSize(wanted);
    while (this.sessions.length < target) {
      const id = this.sessions.length;
      this.sessions.push(this.createSession(id));
    }
    this.poolSize = Math.max(this.poolSize, this.sessions.length);
    return this.poolSize;
  }

  private createSession(id: number): PtySession {
    return new PtySession({
      id,
      shellPath: this.shellPath,
      cols: this.cols,
      rows: this.rows,
      cwd: this.workingDirectory,
      maxBufferBytes: this.maxBufferBytes,
      onOutput: this.onOutput,
    });
  }

  getWorkspaceRoot(): string {
    return this.workingDirectory;
  }

  isPrivacyStrict(): boolean {
    return this.privacyStrict;
  }

  getAllowedRoots(): string[] {
    this.ensureBroadAccess();
    return [...this.allowedRoots];
  }

  /**
   * Privacy OFF: keep unrestricted filesystem roots on the allowlist forever —
   * project soft-allow and cwd switches must not shrink access back to Agent-only.
   * Privacy ON: no-op (project confinement).
   */
  ensureBroadAccess(): void {
    if (this.privacyStrict) return;
    try {
      for (const c of unrestrictedFilesystemRoots()) {
        let real = path.resolve(c);
        try {
          if (fs.existsSync(real)) real = fs.realpathSync(real);
        } catch {
          /* keep */
        }
        if (!this.allowedRoots.some((r) => path.resolve(r) === real)) {
          this.allowedRoots.push(real);
        }
      }
      // Also keep /Users|home as explicit roots for clearer show_allowed_folders.
      const home = path.resolve(os.homedir());
      const candidates: string[] = [];
      if (home && fs.existsSync(home)) {
        candidates.push(home);
        const parent = path.dirname(home);
        const base = path.basename(parent);
        if (
          (parent === "/Users" || /^users$/i.test(base)) &&
          fs.existsSync(parent)
        ) {
          candidates.unshift(parent);
        }
      }
      for (const c of candidates) {
        let real = c;
        try {
          real = fs.realpathSync(c);
        } catch {
          /* keep */
        }
        if (!this.allowedRoots.some((r) => path.resolve(r) === real)) {
          this.allowedRoots.push(real);
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** @deprecated Use ensureBroadAccess — kept for callers that still name Users. */
  ensureUsersScopeRoot(): void {
    this.ensureBroadAccess();
  }

  /**
   * Apply Privacy ON/OFF. ON strips broad roots; OFF restores whole-machine access.
   * Explicit HITL / soft-allow project folders that are not broad roots are kept.
   */
  setPrivacyMode(strict: boolean): {
    privacyStrict: boolean;
    allowedRoots: string[];
  } {
    this.privacyStrict = Boolean(strict);
    if (this.privacyStrict) {
      const keepers = this.allowedRoots.filter(
        (r) => !isBroadFilesystemRoot(r),
      );
      this.allowedRoots = mergeAllowedRoots(
        [this.workingDirectory],
        this.artifactHome ? [this.artifactHome] : null,
        keepers,
      );
    } else {
      this.allowedRoots = mergeAllowedRoots(
        this.allowedRoots,
        [this.workingDirectory],
        this.artifactHome ? [this.artifactHome] : null,
        unrestrictedFilesystemRoots(),
      );
      this.ensureBroadAccess();
    }
    return {
      privacyStrict: this.privacyStrict,
      allowedRoots: [...this.allowedRoots],
    };
  }

  isPathAllowed(candidate: string): boolean {
    let resolved = this.resolveFsPath(candidate);
    try {
      if (fs.existsSync(resolved)) resolved = fs.realpathSync(resolved);
    } catch {
      /* keep resolved */
    }
    return this.allowedRoots.some((root) => {
      let realRoot = path.resolve(root);
      try {
        if (fs.existsSync(realRoot)) realRoot = fs.realpathSync(realRoot);
      } catch {
        /* keep */
      }
      const rel = path.relative(realRoot, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
  }

  /** Resolve tool paths; remap tmp/* (and legacy working/*) onto artifactHome when set. */
  resolveFsPath(filePath: string): string {
    if (this.artifactHome) {
      return resolveWorkingAwarePath(
        this.artifactHome,
        this.workingDirectory,
        filePath,
      );
    }
    return path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.workingDirectory, filePath);
  }

  /**
   * Expand the filesystem allowlist without changing cwd or killing PTYs.
   * Used when another turn is busy so session↔workspace can share access
   * without rebooting the agent mid-turn.
   */
  allowFolders(folderPaths: string[]): string[] {
    if (this.disposed) {
      throw new Error("PtySandbox has been disposed");
    }
    this.ensureBroadAccess();
    const added: string[] = [];
    for (const folderPath of folderPaths) {
      const trimmed = String(folderPath || "").trim();
      if (!trimmed) continue;
      const resolved = path.resolve(trimmed);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        continue;
      }
      let real = resolved;
      try {
        real = fs.realpathSync(resolved);
      } catch {
        /* use resolved */
      }
      if (!this.allowedRoots.some((r) => path.resolve(r) === real)) {
        this.allowedRoots.push(real);
        added.push(real);
      }
    }
    return added;
  }

  /**
   * After human approval: allow this folder and switch all shell cwds into it.
   */
  grantFolderAccess(folderPath: string): string {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a directory: ${resolved}`);
    }
    let real = resolved;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      /* use resolved */
    }
    if (!this.allowedRoots.some((r) => path.resolve(r) === real)) {
      this.allowedRoots.push(real);
    }
    this.workingDirectory = real;
    this.resetAllSessions();
    return real;
  }

  private resetAllSessions(): void {
    for (const session of this.sessions) {
      session.kill();
      session.setCwd(this.workingDirectory);
    }
  }

  private async acquireSession(): Promise<PtySession> {
    if (this.disposed) {
      throw new Error("PtySandbox has been disposed");
    }
    const free = this.sessions.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      this.lastSession = free;
      return free;
    }
    return new Promise<PtySession>((resolve) => {
      this.waitQueue.push((session) => {
        this.lastSession = session;
        resolve(session);
      });
    });
  }

  private releaseSession(session: PtySession): void {
    const next = this.waitQueue.shift();
    if (next) {
      // Keep busy=true; hand off to waiter.
      next(session);
      return;
    }
    session.busy = false;
  }

  /**
   * Write raw stdin to the last-used (or first) PTY slot — for answering [y/N] prompts.
   */
  writeStdin(data: string): void {
    const session = this.lastSession ?? this.sessions[0];
    if (!session) throw new Error("No PTY session available");
    session.write(data);
  }

  /**
   * List directory via Node fs (not the BaseSandbox find/stat shell pipeline).
   * macOS PTY strips tabs from BSD `stat -f`, which made deepagents `ls` return
   * empty — so Downloads looked empty. Always includes hidden files (ls -la).
   */
  async ls(dirPath: string): Promise<{
    files?: Array<{
      path: string;
      is_dir: boolean;
      size: number;
      modified_at: string;
    }>;
    error?: string;
  }> {
    const resolved = this.resolveFsPath(dirPath || ".");
    if (!this.isPathAllowed(resolved)) {
      return { error: `Permission denied listing '${dirPath}'` };
    }
    try {
      if (!fs.existsSync(resolved)) {
        return { error: `Directory not found: ${dirPath}` };
      }
      const st = fs.statSync(resolved);
      if (!st.isDirectory()) {
        return { error: `Not a directory: ${dirPath}` };
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const files: Array<{
        path: string;
        is_dir: boolean;
        size: number;
        modified_at: string;
      }> = [];
      for (const entry of entries) {
        const fullPath = path.join(resolved, entry.name);
        try {
          const est = fs.lstatSync(fullPath);
          const isDir = est.isDirectory();
          // Follow symlink-to-dir for is_dir when useful, but keep listing the entry.
          let size = 0;
          let mtime = est.mtime;
          let dir = isDir;
          if (est.isSymbolicLink()) {
            try {
              const target = fs.statSync(fullPath);
              dir = target.isDirectory();
              size = dir ? 0 : target.size;
              mtime = target.mtime;
            } catch {
              size = 0;
            }
          } else if (!isDir) {
            size = est.size;
          }
          files.push({
            path: dir ? fullPath + path.sep : fullPath,
            is_dir: dir,
            size,
            modified_at: mtime.toISOString(),
          });
        } catch {
          /* skip unreadable entries */
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { files };
    } catch (err) {
      return {
        error: `Error listing '${dirPath}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async execute(command: string): Promise<ExecuteResponse> {
    const session = await this.acquireSession();
    try {
      return await this.executeOnSession(session, command);
    } finally {
      this.releaseSession(session);
    }
  }

  private async executeOnSession(
    session: PtySession,
    command: string,
  ): Promise<ExecuteResponse> {
    let cmd = command;
    let stdin: string | undefined;
    let background = false;
    let timeoutMs = this.timeoutMs;
    try {
      const parsed = JSON.parse(command) as {
        command?: string;
        stdin?: string;
        background?: boolean;
        timeoutMs?: number;
      };
      if (parsed && typeof parsed.command === "string") {
        cmd = parsed.command;
        stdin = parsed.stdin;
        background = Boolean(parsed.background);
        if (typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs)) {
          timeoutMs = Math.min(
            Math.max(parsed.timeoutMs, this.minTimeoutMs),
            this.maxTimeoutMs,
          );
        }
      }
    } catch {
      // plain shell string
    }

    cmd = ensureLsLongListing(cmd);

    const guard = checkCommand(cmd);
    if (!guard.ok) {
      return {
        output: `Guardrail blocked command: ${guard.reason}\nCommand: ${cmd}`,
        exitCode: 1,
        truncated: false,
      };
    }
    if (guard.requiresApproval && !this.autoApproveDestructive) {
      return {
        output: [
          `Guardrail: command requires human approval (${guard.reason}).`,
          `Re-run with CLI --yes to auto-approve destructive commands, or confirm via interrupt.`,
          `Command: ${cmd}`,
        ].join("\n"),
        exitCode: 1,
        truncated: false,
      };
    }

    const access = checkCommandWorkspaceAccess(
      cmd,
      this.getAllowedRoots(),
      this.workingDirectory,
    );
    if (!access.ok) {
      return {
        output: [
          `Workspace confinement blocked command: ${access.reason}`,
          `Allowed folders:\n${this.allowedRoots.map((r) => `- ${r}`).join("\n")}`,
          `Call request_folder_access with the folder path NOW (do not ask in chat). That tool opens the Approve/Deny UI; after approval, retry this command.`,
          `Command: ${cmd}`,
        ].join("\n"),
        exitCode: 1,
        truncated: false,
      };
    }

    if (background) {
      return this.executeBackground(session, cmd);
    }

    session.ensure();
    this.commandSeq += 1;
    const marker = `__AGENT_EXIT_${session.id}_${this.commandSeq}_${Date.now()}__`;
    const startLen = session.bufferLength();

    const wrapped =
      process.platform === "win32"
        ? `${cmd}\r\necho ${marker}$LASTEXITCODE\r\n`
        : `${cmd}\necho "${marker}$?"\n`;

    session.write(wrapped);
    if (stdin) {
      session.write(stdin.endsWith("\n") ? stdin : `${stdin}\n`);
    }

    return this.waitForMarker(session, marker, startLen, timeoutMs);
  }

  private async executeBackground(
    session: PtySession,
    cmd: string,
  ): Promise<ExecuteResponse> {
    session.ensure();
    const startLen = session.bufferLength();
    const bg =
      process.platform === "win32"
        ? `Start-Process -NoNewWindow -FilePath cmd -ArgumentList '/c ${cmd.replace(/'/g, "''")}'\r\n`
        : `( ${cmd} ) >/tmp/agent-bg-$$.log 2>&1 &\necho "__BG_PID_$!__"\n`;
    session.write(bg);

    await sleep(500);
    const slice = session.bufferSlice(startLen);
    const pidMatch = slice.match(/__BG_PID_(\d+)__/);
    if (pidMatch) {
      registerPtyBackgroundProcess({
        pid: Number(pidMatch[1]),
        command: cmd,
        slot: session.id,
      });
    }
    const { text, truncated } = truncateOutput(slice);
    return {
      output: [
        `Started background command on PTY slot ${session.id}: ${cmd}`,
        pidMatch ? `Registered PID ${pidMatch[1]} in process_manage list.` : "",
        text,
        "Note: process is running in this PTY session; check logs / poll as needed.",
      ]
        .filter(Boolean)
        .join("\n"),
      exitCode: 0,
      truncated,
    };
  }

  private waitForMarker(
    session: PtySession,
    marker: string,
    startLen: number,
    timeoutMs: number,
  ): Promise<ExecuteResponse> {
    return new Promise((resolve) => {
      let settled = false;
      let idleTimer: NodeJS.Timeout | undefined;
      let lastLen = startLen;
      let awaitingNotified = false;

      const finish = (payload: ExecuteResponse) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        resolve(payload);
      };

      const hardTimer = setTimeout(() => {
        session.signalEscalate();
        const raw = session.bufferSlice(startLen);
        const { text, truncated } = truncateOutput(
          `${raw}\n[Command timed out after ${timeoutMs}ms on PTY slot ${session.id}; sent SIGINT/SIGTERM]`,
        );
        finish({ output: text, exitCode: null, truncated });
      }, timeoutMs);

      const poll = setInterval(() => {
        const slice = session.bufferSlice(startLen);
        const idx = slice.lastIndexOf(marker);
        if (idx !== -1) {
          const after = slice.slice(idx + marker.length);
          const m = after.match(/^(\d+)/);
          if (m) {
            const exitCode = Number(m[1]);
            const before = slice.slice(0, idx);
            let cleaned = stripPtyChrome(before);
            let { text, truncated } = truncateOutput(cleaned);
            if (exitCode !== 0) {
              text = [
                text,
                "",
                `Command failed with exit code ${exitCode}.`,
                "Analyze the root cause and propose an alternative command or fix.",
              ].join("\n");
            }
            finish({ output: text, exitCode, truncated });
            return;
          }
        }

        if (session.bufferLength() !== lastLen) {
          lastLen = session.bufferLength();
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            const current = session.bufferSlice(startLen).trimEnd();
            if (!awaitingNotified && AWAITING_INPUT_RE.test(current)) {
              awaitingNotified = true;
              const { text, truncated } = truncateOutput(
                [
                  current,
                  "",
                  `[awaitingInput] PTY slot ${session.id} appears to be waiting for interactive input.`,
                  'Provide stdin on the next execute call as JSON: {"command":"...","stdin":"y"}',
                  "or answer the prompt yourself.",
                ].join("\n"),
              );
              finish({ output: text, exitCode: null, truncated });
            }
          }, 2500);
        }
      }, 100);
    });
  }

  async uploadFiles(
    files: Array<[string, Uint8Array]>,
  ): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];
    for (const [filePath, content] of files) {
      try {
        if (!this.isPathAllowed(filePath)) {
          results.push({ path: filePath, error: "permission_denied" });
          continue;
        }
        const fullPath = this.resolveFsPath(filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
        results.push({ path: filePath, error: null });
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "EACCES") {
          results.push({ path: filePath, error: "permission_denied" });
        } else if (error.code === "EISDIR") {
          results.push({ path: filePath, error: "is_directory" });
        } else {
          results.push({ path: filePath, error: "invalid_path" });
        }
      }
    }
    return results;
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const results: FileDownloadResponse[] = [];
    for (const filePath of paths) {
      try {
        if (!this.isPathAllowed(filePath)) {
          results.push({
            path: filePath,
            content: null,
            error: "permission_denied",
          });
          continue;
        }
        const fullPath = this.resolveFsPath(filePath);
        if (!fs.existsSync(fullPath)) {
          results.push({
            path: filePath,
            content: null,
            error: "file_not_found",
          });
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results.push({ path: filePath, content: null, error: "is_directory" });
          continue;
        }
        const content = fs.readFileSync(fullPath);
        results.push({
          path: filePath,
          content: new Uint8Array(content),
          error: null,
        });
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "EACCES") {
          results.push({
            path: filePath,
            content: null,
            error: "permission_denied",
          });
        } else {
          results.push({
            path: filePath,
            content: null,
            error: "file_not_found",
          });
        }
      }
    }
    return results;
  }

  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions) {
      session.kill();
    }
    this.waitQueue.length = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip shell prompts, ANSI, and echoed control lines from PTY capture. */
function stripPtyChrome(raw: string): string {
  const withoutAnsi = raw
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r/g, "");
  const lines = withoutAnsi.split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (/^bash-\d[\d.]*\$/.test(t)) return false;
    if (/^\$\s*$/.test(t)) return false;
    if (/^\%\s*$/.test(t)) return false;
    if (/@.*[\%\$#]\s*$/.test(t) && !t.includes(" ")) return false;
    if (/@\S+\s+\S+\s+[\%\$#]\s*$/.test(t)) return false;
    if (t.includes("__AGENT_EXIT_")) return false;
    if (t.startsWith("The default interactive shell is now")) return false;
    if (t.startsWith("To update your account to use zsh")) return false;
    if (t.startsWith("For more details, please visit")) return false;
    return true;
  });
  while (
    filtered.length &&
    (/^echo "__AGENT_EXIT_/.test(filtered[0]!.trim()) ||
      filtered[0]!.trim() === "")
  ) {
    filtered.shift();
  }
  return filtered.join("\n").trim();
}
