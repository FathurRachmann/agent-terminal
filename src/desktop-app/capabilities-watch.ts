/**
 * Watch skill / MCP / capability-pref paths and notify when catalogs may change.
 */
import fs from "node:fs";
import path from "node:path";

export type CapabilitiesWatchHandle = {
  /** Rebind to a new agent home (profile switch). */
  retarget: (agentHome: string) => void;
  close: () => void;
};

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

/**
 * Watch `.agent/skills` (recursive when supported), mcp.json files, and
 * capabilities-prefs.json under `agentHome`.
 */
export function startCapabilitiesWatch(
  agentHome: string,
  onChange: () => void,
): CapabilitiesWatchHandle {
  let closed = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watchers: fs.FSWatcher[] = [];

  const fire = () => {
    if (closed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!closed) onChange();
    }, 250);
  };

  const clearWatchers = () => {
    for (const w of watchers.splice(0)) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
  };

  const tryWatch = (target: string, recursive: boolean) => {
    try {
      if (!fs.existsSync(target)) return;
      const w = fs.watch(target, recursive ? { recursive: true } : {}, () => {
        fire();
      });
      w.on("error", () => {
        /* ignore */
      });
      watchers.push(w);
    } catch {
      /* unsupported / race */
    }
  };

  const attach = (root: string) => {
    clearWatchers();
    if (!root) return;
    const agentDir = path.join(root, ".agent");
    const skillsDir = path.join(agentDir, "skills");
    ensureDir(skillsDir);
    ensureDir(agentDir);

    tryWatch(skillsDir, true);
    tryWatch(agentDir, false);
    // Parent of optional root .mcp.json
    tryWatch(root, false);
  };

  attach(agentHome);

  return {
    retarget(nextHome: string) {
      if (closed) return;
      attach(nextHome);
      fire();
    },
    close() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      clearWatchers();
    },
  };
}
