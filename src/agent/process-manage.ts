import { tool } from "langchain";
import { z } from "zod";
import { exec, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type ManagedProcessSource = "process_manage" | "pty";

export type ManagedProcessSnapshot = {
  pid: number;
  command: string;
  startedAt: string;
  source: ManagedProcessSource;
  slot?: number;
  status: "running" | "exited" | "killed";
  logPreview: string;
};

type ProcessInfo = {
  pid: number;
  command: string;
  startedAt: string;
  source: ManagedProcessSource;
  slot?: number;
  process?: ChildProcess;
  logs: string[];
  status: "running" | "exited" | "killed";
};

const activeProcesses = new Map<number, ProcessInfo>();

function snapshotOf(info: ProcessInfo): ManagedProcessSnapshot {
  return {
    pid: info.pid,
    command: info.command,
    startedAt: info.startedAt,
    source: info.source,
    slot: info.slot,
    status: info.status,
    logPreview: info.logs.slice(-8).join("").slice(-500),
  };
}

export function listManagedProcesses(): ManagedProcessSnapshot[] {
  return [...activeProcesses.values()]
    .map(snapshotOf)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function pollManagedProcess(pid: number): {
  ok: boolean;
  detail: string;
  snapshot?: ManagedProcessSnapshot;
} {
  const info = activeProcesses.get(pid);
  if (!info) {
    return { ok: false, detail: `PID ${pid} not found in managed background list.` };
  }
  const recentLogs = info.logs.slice(-40).join("");
  return {
    ok: true,
    snapshot: snapshotOf(info),
    detail: [
      `Process PID ${pid} (${info.command})`,
      `Source: ${info.source}${info.slot != null ? ` · PTY slot ${info.slot}` : ""}`,
      `Status: ${info.status}`,
      `Started: ${info.startedAt}`,
      `Recent logs:\n${recentLogs || "(no output yet)"}`,
    ].join("\n"),
  };
}

export async function killManagedProcess(pid: number): Promise<{
  ok: boolean;
  detail: string;
}> {
  const info = activeProcesses.get(pid);
  if (info?.process) {
    info.process.kill("SIGTERM");
    info.status = "killed";
    activeProcesses.delete(pid);
    return { ok: true, detail: `Killed managed background process PID ${pid}.` };
  }
  if (info) {
    try {
      await execAsync(`kill -TERM ${pid}`);
      info.status = "killed";
      activeProcesses.delete(pid);
      return { ok: true, detail: `Sent SIGTERM to PTY-background PID ${pid}.` };
    } catch (err) {
      return {
        ok: false,
        detail: `Failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  try {
    await execAsync(`kill -9 ${pid}`);
    return { ok: true, detail: `System process PID ${pid} terminated via kill -9.` };
  } catch (err) {
    return {
      ok: false,
      detail: `Failed to kill PID ${pid}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Register a background job started from a PTY slot (execute background:true). */
export function registerPtyBackgroundProcess(options: {
  pid: number;
  command: string;
  slot: number;
}): void {
  if (!options.pid || activeProcesses.has(options.pid)) return;
  activeProcesses.set(options.pid, {
    pid: options.pid,
    command: options.command,
    startedAt: new Date().toISOString(),
    source: "pty",
    slot: options.slot,
    logs: [`[PTY slot ${options.slot}] started: ${options.command}\n`],
    status: "running",
  });
}

export function createProcessManagementTools() {
  const processManage = tool(
    async ({
      action,
      pid,
      command,
    }: {
      action: "start" | "list" | "poll" | "kill";
      pid?: number;
      command?: string;
    }) => {
      if (action === "start") {
        if (!command) return "Error: 'command' is required for action=start";
        const child = exec(command, { cwd: process.cwd() });
        const childPid = child.pid;
        if (!childPid) return "Error: Failed to spawn background process.";

        const info: ProcessInfo = {
          pid: childPid,
          command,
          startedAt: new Date().toISOString(),
          source: "process_manage",
          process: child,
          logs: [],
          status: "running",
        };

        child.stdout?.on("data", (data) => {
          info.logs.push(String(data));
          if (info.logs.length > 200) info.logs.shift();
        });
        child.stderr?.on("data", (data) => {
          info.logs.push(`[STDERR] ${String(data)}`);
          if (info.logs.length > 200) info.logs.shift();
        });
        child.on("exit", (code) => {
          info.status = "exited";
          info.logs.push(`[EXIT] Process exited with code ${code}`);
        });

        activeProcesses.set(childPid, info);
        return `Started background process PID ${childPid}: '${command}'`;
      }

      if (action === "list") {
        const list = listManagedProcesses();
        if (list.length === 0) {
          return "No active background processes managed by agent.";
        }
        return list
          .map((p) => {
            const src =
              p.source === "pty"
                ? `pty${p.slot != null ? `#${p.slot}` : ""}`
                : "process_manage";
            return `PID ${p.pid} [${p.status}] (${src}) | '${p.command}' | Started: ${p.startedAt}`;
          })
          .join("\n");
      }

      if (action === "poll") {
        if (!pid) return "Error: 'pid' is required for action=poll";
        const managed = pollManagedProcess(pid);
        if (managed.ok) return managed.detail;
        try {
          const { stdout } = await execAsync(`ps -p ${pid}`);
          return `System Process info:\n${stdout.trim()}`;
        } catch {
          return managed.detail;
        }
      }

      if (action === "kill") {
        if (!pid) return "Error: 'pid' is required for action=kill";
        const result = await killManagedProcess(pid);
        return result.detail;
      }

      return "Unknown action";
    },
    {
      name: "process_manage",
      description:
        "Manage background processes and dev servers (start, list, poll logs, kill PID). " +
        "Use this when launching long-lived servers, background workers, or monitoring process health.",
      schema: z.object({
        action: z.enum(["start", "list", "poll", "kill"]).describe("Action to perform"),
        pid: z.number().int().optional().describe("Process ID (required for poll and kill)"),
        command: z.string().optional().describe("Shell command (required for start)"),
      }),
    },
  );

  return [processManage];
}
