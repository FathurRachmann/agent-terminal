import fs from "node:fs";
import path from "node:path";
import type { TranscriptEvent } from "../memory/session-store.js";
import type { SessionStore } from "../memory/session-store.js";
import {
  asRecord,
  basenamePath,
  extensionOf,
  extractResultPathsFromText,
  inferPreviewKind,
  resolveArtifactsFromTool,
} from "./renderer/activity-artifact.js";

export type ArtifactCategory = "all" | "images" | "files" | "links";

export type ArtifactRecord = {
  id: string;
  title: string;
  location: string;
  category: "images" | "files" | "links";
  threadId: string;
  sessionPreview: string;
  at: string;
  toolName?: string;
  kind?: string;
  /** Local workspace-relative path when applicable. */
  path?: string;
};

const URL_RE = /https?:\/\/[^\s"'<>\]`)]+/gi;
const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
]);

function classifyLocation(location: string): ArtifactRecord["category"] {
  if (/^https?:\/\//i.test(location)) {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?|$)/i.test(location)) {
      return "images";
    }
    return "links";
  }
  const ext = extensionOf(location);
  if (IMAGE_EXT.has(ext)) return "images";
  return "files";
}

function titleFor(location: string, category: ArtifactRecord["category"]): string {
  if (category === "links") {
    try {
      const u = new URL(location);
      return u.hostname + (u.pathname === "/" ? "" : u.pathname);
    } catch {
      return location.slice(0, 80);
    }
  }
  return basenamePath(location);
}

function pushUnique(
  map: Map<string, ArtifactRecord>,
  row: Omit<ArtifactRecord, "id">,
) {
  const key = `${row.threadId}::${row.location}`;
  const existing = map.get(key);
  if (existing && existing.at >= row.at) return;
  map.set(key, { ...row, id: key });
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(URL_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const url = (m[0] || "").replace(/[),.;]+$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push(url);
  }
  return found;
}

function pickUrlFromToolInput(name: string, input: unknown): string[] {
  const args = asRecord(input);
  const urls: string[] = [];
  for (const key of ["url", "href", "link", "uri", "target"]) {
    const v = String(args[key] ?? "").trim();
    if (/^https?:\/\//i.test(v)) urls.push(v);
  }
  if (name === "desktop_automate" || name === "browser_open") {
    const action = String(args.action ?? "");
    if (action === "open_url" || args.url) {
      const v = String(args.url ?? "").trim();
      if (v) urls.push(v);
    }
  }
  // Also scrape free-form command / query strings
  for (const key of ["command", "cmd", "query", "content", "text"]) {
    urls.push(...extractUrls(String(args[key] ?? "")));
  }
  return urls;
}

/** Index artifacts from a single session transcript. */
export function indexArtifactsFromTranscript(
  events: TranscriptEvent[],
  meta: { threadId: string; sessionPreview: string },
): ArtifactRecord[] {
  const map = new Map<string, ArtifactRecord>();
  const pending = new Map<string, { input: unknown; at: string }>();

  for (const ev of events) {
    const ui = ev.meta?.uiEvent as
      | { type?: string; name?: string; input?: unknown; output?: string }
      | undefined;

    if (ui?.type === "tool_start" && ui.name) {
      pending.set(ui.name, { input: ui.input, at: ev.ts });
      for (const url of pickUrlFromToolInput(ui.name, ui.input)) {
        const category = classifyLocation(url);
        pushUnique(map, {
          title: titleFor(url, category),
          location: url,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          toolName: ui.name,
          kind: "link",
        });
      }
      continue;
    }

    if (ui?.type === "tool_end" && ui.name) {
      const start = pending.get(ui.name);
      pending.delete(ui.name);
      const arts = resolveArtifactsFromTool({
        name: ui.name,
        input: start?.input,
        output: ui.output,
      });
      for (const a of arts) {
        if (a.kind === "code" && a.source === "path_only") {
          // still index generator scripts as files
        }
        const category = classifyLocation(a.path);
        pushUnique(map, {
          title: a.basename || titleFor(a.path, category),
          location: a.path,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          toolName: ui.name,
          kind: a.kind,
          path: a.path,
        });
      }
      for (const url of extractUrls(ui.output ?? "")) {
        const category = classifyLocation(url);
        pushUnique(map, {
          title: titleFor(url, category),
          location: url,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          toolName: ui.name,
          kind: "link",
        });
      }
      for (const p of extractResultPathsFromText(ui.output ?? "")) {
        const category = classifyLocation(p);
        pushUnique(map, {
          title: basenamePath(p),
          location: p,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          toolName: ui.name,
          kind: inferPreviewKind(extensionOf(p)),
          path: p,
        });
      }
      continue;
    }

    // Assistant/user messages may cite deliverables or links
    if (ev.role === "assistant" || ev.role === "user") {
      for (const url of extractUrls(ev.content)) {
        const category = classifyLocation(url);
        pushUnique(map, {
          title: titleFor(url, category),
          location: url,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          kind: "link",
        });
      }
      for (const p of extractResultPathsFromText(ev.content)) {
        const category = classifyLocation(p);
        pushUnique(map, {
          title: basenamePath(p),
          location: p,
          category,
          threadId: meta.threadId,
          sessionPreview: meta.sessionPreview,
          at: ev.ts,
          kind: inferPreviewKind(extensionOf(p)),
          path: p,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function scanWorkingFiles(
  workspaceRoot: string,
  fallbackSession: { threadId: string; sessionPreview: string },
): ArtifactRecord[] {
  const dirs = [
    path.join(workspaceRoot, "tmp"),
    path.join(workspaceRoot, "working"),
    path.join(workspaceRoot, ".agent", "task"),
  ];
  const out: ArtifactRecord[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (ent.name.startsWith(".")) continue;
      const abs = path.join(dir, ent.name);
      let mtime = Date.now();
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        continue;
      }
      const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
      const category = classifyLocation(rel);
      out.push({
        id: `fs::${rel}`,
        title: ent.name,
        location: rel,
        category,
        threadId: fallbackSession.threadId,
        sessionPreview: fallbackSession.sessionPreview || "tmp/",
        at: new Date(mtime).toISOString(),
        kind: inferPreviewKind(extensionOf(rel)),
        path: rel,
      });
    }
  }
  return out;
}

/** Build cross-session artifact catalog for the desktop Artifacts view. */
export function listAllArtifacts(options: {
  sessionStore: SessionStore;
  workspaceRoot: string;
  includeWorkingScan?: boolean;
}): {
  artifacts: ArtifactRecord[];
  counts: { all: number; images: number; files: number; links: number };
} {
  const sessions = options.sessionStore.listSessions();
  const map = new Map<string, ArtifactRecord>();

  for (const s of sessions) {
    const events = options.sessionStore.readTranscript(s.threadId, 1500);
    const rows = indexArtifactsFromTranscript(events, {
      threadId: s.threadId,
      sessionPreview: s.preview || s.threadId,
    });
    for (const row of rows) {
      const existing = map.get(row.id);
      if (!existing || existing.at < row.at) map.set(row.id, row);
    }
  }

  if (options.includeWorkingScan !== false) {
    const latest = sessions[0];
    for (const row of scanWorkingFiles(options.workspaceRoot, {
      threadId: latest?.threadId ?? "workspace",
      sessionPreview: latest?.preview ?? "tmp/",
    })) {
      // Prefer transcript-backed rows when same location exists
      const key = [...map.values()].find(
        (a) => a.location === row.location || a.path === row.path,
      );
      if (key) continue;
      map.set(row.id, row);
    }
  }

  const artifacts = [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
  const counts = {
    all: artifacts.length,
    images: artifacts.filter((a) => a.category === "images").length,
    files: artifacts.filter((a) => a.category === "files").length,
    links: artifacts.filter((a) => a.category === "links").length,
  };
  return { artifacts, counts };
}
