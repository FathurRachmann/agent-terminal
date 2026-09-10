import fs from "node:fs";
import path from "node:path";
import * as pty from "node-pty";
import {
  BaseSandbox,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileUploadResponse,
} from "deepagents";
import { checkCommand, checkCommandWorkspaceAccess, isPathInsideAnyRoot } from "./guardrails.js";

export type PtySandboxOptions = {
  workingDirectory: string;
  timeoutMs?: number;
  shell?: string;
  cols?: number;
  rows?: number;
  /** When true, destructive commands that normally need approval are allowed. */
  autoApproveDestructive?: boolean;
  onOutput?: (chunk: string) => void;
};

const AWAITING_INPUT_RE =
  /(\[y\/N\]|\[Y\/n\]|\(y\/n\)|password:|passphrase:|Continue\?|Overwrite\?|\(yes\/no\)|Press RETURN|More\?|--More--)\s*$/i;

function defaultShell(): string {
  if (process.env.PTY_SHELL) return process.env.PTY_SHELL;
  if (process.platform === "win32") return "powershell.exe";
  // Prefer bash for predictable exit-marker scripting in the agent loop.
  // Override with PTY_SHELL=/bin/zsh if needed.
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
  return {
    text: [
      ...head,
      `\n...[${omitted} lines truncated]...\n`,
      ...tail,
    ].join("\n"),
    truncated: true,
  };
}

/**
 * Persistent PTY-backed sandbox for Deep Agents.
 * One interactive shell session per workspace; cwd/env persist across execute().
 */
export class PtySandbox extends BaseSandbox {
  readonly id: string;
  private workingDirectory: string;
  private allowedRoots: string[];
  private readonly timeoutMs: number;
  private readonly shellPath: string;
  private readonly cols: number;
  private readonly rows: number;
  private readonly autoApproveDestructive: boolean;
  private readonly onOutput?: (chunk: string) => void;

  private term: pty.IPty | null = null;
  private buffer = "";
  private commandSeq = 0;
  private disposed = false;
  private executeQueue: Promise<void> = Promise.resolve();
  private readonly maxBufferBytes = 10 * 1024 * 1024;
  private readonly minTimeoutMs = 5_000;
  private readonly maxTimeoutMs = 10 * 60 * 1000;

  constructor(options: PtySandboxOptions) {
    super();
    this.workingDirectory = path.resolve(options.workingDirectory);
    this.allowedRoots = [this.workingDirectory];
    this.timeoutMs = options.timeoutMs ?? Number(process.env.PTY_TIMEOUT_MS ?? 60_000);
    this.shellPath = options.shell ?? defaultShell();
    this.cols = options.cols ?? 120;
    this.rows = options.rows ?? 40;
    this.autoApproveDestructive = options.autoApproveDestructive ?? false;
    this.onOutput = options.onOutput;
    this.id = `pty-${this.workingDirectory.replace(/[^a-zA-Z0-9]/g, "-")}`;

    if (!fs.existsSync(this.workingDirectory)) {
      fs.mkdirSync(this.workingDirectory, { recursive: true });
    }
  }

  getWorkspaceRoot(): string {
    return this.workingDirectory;
  }

  getAllowedRoots(): string[] {
    return [...this.allowedRoots];
  }

  isPathAllowed(candidate: string): boolean {
    return isPathInsideAnyRoot(
      this.allowedRoots,
      candidate,
      this.workingDirectory,
    );
  }

  /**
   * After human approval: allow this folder and switch the shell cwd into it.
   * Access outside the allowlist remains blocked.
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
    // Restart PTY so the next command starts in the granted folder.
    this.resetSession();
    return real;
  }

  private resetSession(): void {
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

  private ensureSession(): pty.IPty {
    if (this.disposed) {
      throw new Error("PtySandbox has been disposed");
    }
    if (this.term) return this.term;

    const term = pty.spawn(this.shellPath, [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.workingDirectory,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        // Avoid interactive pagers hanging the agent by default
        PAGER: "cat",
        GIT_PAGER: "cat",
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

  /**
   * Write raw stdin to the active PTY (for answering [y/N] prompts).
   */
  writeStdin(data: string): void {
    const term = this.ensureSession();
    term.write(data);
  }

  async execute(command: string): Promise<ExecuteResponse> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.executeQueue;
    this.executeQueue = gate;
    await previous;
    try {
      return await this.executeSerialized(command);
    } finally {
      release();
    }
  }

  private async executeSerialized(command: string): Promise<ExecuteResponse> {
    // Parse optional JSON payload first, then guard the resolved shell command.
    // Payload shape: {"command":"...","stdin":"y\n","background":true,"timeoutMs":...}
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
      this.allowedRoots,
      this.workingDirectory,
    );
    if (!access.ok) {
      return {
        output: [
          `Workspace confinement blocked command: ${access.reason}`,
          `Allowed folders:\n${this.allowedRoots.map((r) => `- ${r}`).join("\n")}`,
          `Ask the user for permission, then call request_folder_access with the folder path.`,
          `Command: ${cmd}`,
        ].join("\n"),
        exitCode: 1,
        truncated: false,
      };
    }

    if (background) {
      return this.executeBackground(cmd);
    }

    const term = this.ensureSession();
    this.commandSeq += 1;
    const marker = `__AGENT_EXIT_${this.commandSeq}_${Date.now()}__`;
    const startLen = this.buffer.length;

    // Run command then print a unique exit marker the agent can detect.
    // Works for bash/zsh; PowerShell users should set PTY_SHELL accordingly.
    const wrapped =
      process.platform === "win32"
        ? `${cmd}\r\necho ${marker}$LASTEXITCODE\r\n`
        : `${cmd}\necho "${marker}$?"\n`;

    term.write(wrapped);
    if (stdin) {
      term.write(stdin.endsWith("\n") ? stdin : `${stdin}\n`);
    }

    return this.waitForMarker(marker, startLen, timeoutMs);
  }

  private async executeBackground(cmd: string): Promise<ExecuteResponse> {
    const term = this.ensureSession();
    const startLen = this.buffer.length;
    const bg =
      process.platform === "win32"
        ? `Start-Process -NoNewWindow -FilePath cmd -ArgumentList '/c ${cmd.replace(/'/g, "''")}'\r\n`
        : `( ${cmd} ) >/tmp/agent-bg-$$.log 2>&1 &\necho "__BG_PID_$!__"\n`;
    term.write(bg);

    await sleep(500);
    const slice = this.buffer.slice(startLen);
    const { text, truncated } = truncateOutput(slice);
    return {
      output: [
        `Started background command: ${cmd}`,
        text,
        "Note: process is running in the PTY session; check logs / poll as needed.",
      ].join("\n"),
      exitCode: 0,
      truncated,
    };
  }

  private waitForMarker(
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
        this.signalEscalate();
        const raw = this.buffer.slice(startLen);
        const { text, truncated } = truncateOutput(
          `${raw}\n[Command timed out after ${timeoutMs}ms; sent SIGINT/SIGTERM]`,
        );
        finish({ output: text, exitCode: null, truncated });
      }, timeoutMs);

      const poll = setInterval(() => {
        const slice = this.buffer.slice(startLen);
        const idx = slice.lastIndexOf(marker);
        if (idx !== -1) {
          // Expect markerEXITCODE at end of a line
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

        if (this.buffer.length !== lastLen) {
          lastLen = this.buffer.length;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            const current = this.buffer.slice(startLen).trimEnd();
            if (!awaitingNotified && AWAITING_INPUT_RE.test(current)) {
              awaitingNotified = true;
              const { text, truncated } = truncateOutput(
                [
                  current,
                  "",
                  "[awaitingInput] The PTY appears to be waiting for interactive input.",
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

  private signalEscalate(): void {
    if (!this.term) return;
    try {
      this.term.write("\x03"); // SIGINT via Ctrl-C
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
        const fullPath = path.resolve(this.workingDirectory, filePath);
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
        const fullPath = path.resolve(this.workingDirectory, filePath);
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
    try {
      this.term?.kill();
    } catch {
      /* ignore */
    }
    this.term = null;
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
  // Drop leading echoed command lines that only restate the wrapped invoke
  while (
    filtered.length &&
    (/^echo "__AGENT_EXIT_/.test(filtered[0]!.trim()) ||
      filtered[0]!.trim() === "")
  ) {
    filtered.shift();
  }
  return filtered.join("\n").trim();
}
