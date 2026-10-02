/**
 * Watch agent-written status/progress files and surface live lines to the UI.
 */
import fs from "node:fs";
import path from "node:path";

export type JobProgressEvent = {
  type: "job_progress";
  text: string;
  path: string;
  fraction?: number | null;
  done?: boolean;
  threadId?: string;
};

const STATUS_NAME_RE =
  /(^|[/\\])([^/\\]*status[^/\\]*|[^/\\]*progress[^/\\]*)\.(txt|log|md|json)$/i;

export function isProgressStatusPath(filePath: string): boolean {
  const p = String(filePath || "").trim();
  if (!p) return false;
  if (STATUS_NAME_RE.test(p)) return true;
  // Conventional bot scratch status under tmp/bots/
  if (/[/\\]tmp[/\\]bots[/\\].+\.(txt|log)$/i.test(p)) return true;
  return false;
}

export function extractWritePath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  return String(
    rec.path ?? rec.file_path ?? rec.filename ?? rec.file ?? "",
  ).trim();
}

/** Last non-empty line (status files are usually overwritten with one line). */
export function readProgressLine(absPath: string): string {
  try {
    if (!fs.existsSync(absPath)) return "";
    const raw = fs.readFileSync(absPath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length ? lines[lines.length - 1]! : "";
  } catch {
    return "";
  }
}

export function parseProgressFraction(text: string): number | null {
  const m = String(text || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const cur = Number(m[1]);
  const total = Number(m[2]);
  if (!(total > 0) || !(cur >= 0)) return null;
  return Math.max(0, Math.min(1, cur / total));
}

export function looksLikeProgressDone(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/\b(done|complete[d]?|finished|success)\b/i.test(t)) return true;
  const frac = parseProgressFraction(t);
  if (frac != null && frac >= 1) return true;
  const m = t.match(/(\d+)\s*\/\s*(\d+)/);
  if (m && Number(m[1]) >= Number(m[2]) && Number(m[2]) > 0) return true;
  return false;
}

type WatchEntry = {
  absPath: string;
  threadId?: string;
  lastText: string;
  timer: NodeJS.Timeout;
};

export class JobProgressWatcher {
  private watches = new Map<string, WatchEntry>();
  private emit: (ev: JobProgressEvent) => void;
  private resolveAbs: (relOrAbs: string) => string | null;
  private pollMs: number;

  constructor(options: {
    emit: (ev: JobProgressEvent) => void;
    resolveAbs: (relOrAbs: string) => string | null;
    pollMs?: number;
  }) {
    this.emit = options.emit;
    this.resolveAbs = options.resolveAbs;
    this.pollMs = options.pollMs ?? 1000;
  }

  watch(relOrAbs: string, threadId?: string): void {
    if (!isProgressStatusPath(relOrAbs)) return;
    const abs = this.resolveAbs(relOrAbs);
    if (!abs) return;
    const key = path.normalize(abs);
    const existing = this.watches.get(key);
    if (existing) {
      if (threadId) existing.threadId = threadId;
      this.tick(existing);
      return;
    }
    const entry: WatchEntry = {
      absPath: key,
      threadId,
      lastText: "",
      timer: setInterval(() => this.tick(entry), this.pollMs),
    };
    // Unref so polling doesn't keep the process alive alone.
    entry.timer.unref?.();
    this.watches.set(key, entry);
    this.tick(entry);
  }

  /** Scan conventional bot status dirs once (e.g. after boot / turn). */
  scanWorkspaceRoots(roots: string[], threadId?: string): void {
    for (const root of roots) {
      if (!root || !fs.existsSync(root)) continue;
      const bots = path.join(root, "tmp", "bots");
      if (!fs.existsSync(bots)) continue;
      let names: string[] = [];
      try {
        names = fs.readdirSync(bots);
      } catch {
        continue;
      }
      for (const name of names) {
        const full = path.join(bots, name);
        if (!isProgressStatusPath(full)) continue;
        try {
          if (!fs.statSync(full).isFile()) continue;
        } catch {
          continue;
        }
        this.watch(full, threadId);
      }
    }
  }

  clear(): void {
    for (const entry of this.watches.values()) {
      clearInterval(entry.timer);
    }
    this.watches.clear();
  }

  private tick(entry: WatchEntry): void {
    const text = readProgressLine(entry.absPath);
    if (!text || text === entry.lastText) {
      // If file vanished after we saw progress, mark done.
      if (entry.lastText && !fs.existsSync(entry.absPath)) {
        this.finish(entry, entry.lastText);
      }
      return;
    }
    entry.lastText = text;
    const done = looksLikeProgressDone(text);
    this.emit({
      type: "job_progress",
      text,
      path: entry.absPath,
      fraction: parseProgressFraction(text),
      done,
      threadId: entry.threadId,
    });
    if (done) {
      // Keep showing the final line briefly, then drop the watch.
      setTimeout(() => this.unwatch(entry.absPath), 8_000).unref?.();
    }
  }

  private finish(entry: WatchEntry, text: string): void {
    this.emit({
      type: "job_progress",
      text,
      path: entry.absPath,
      fraction: parseProgressFraction(text),
      done: true,
      threadId: entry.threadId,
    });
    this.unwatch(entry.absPath);
  }

  private unwatch(absPath: string): void {
    const key = path.normalize(absPath);
    const entry = this.watches.get(key);
    if (!entry) return;
    clearInterval(entry.timer);
    this.watches.delete(key);
  }
}
