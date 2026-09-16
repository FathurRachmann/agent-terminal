import fs from "node:fs";
import path from "node:path";
import { mimeForPath } from "./file-delivery-shared.js";
import {
  encodeAgentPreviewUrl,
  formatBytes,
} from "./preview-protocol.js";

const MAX_TEXT_BYTES = 400_000;
const MAX_BINARY_BYTES = 8_000_000;
/** Images above this use streaming preview URL instead of base64 data URL. */
const MAX_IMAGE_DATA_URL_BYTES = 4_000_000;

export type WorkspacePreviewKind =
  | "markdown"
  | "code"
  | "html"
  | "csv"
  | "spreadsheet"
  | "document"
  | "pdf"
  | "media"
  | "binary"
  | "image"
  | "text"
  | "unsupported";

export type WorkspacePreviewResult =
  | {
      ok: true;
      path: string;
      basename: string;
      ext: string;
      kind: WorkspacePreviewKind;
      language: string;
      text?: string;
      html?: string;
      dataUrl?: string;
      /** Streaming URL for PDF / media / large files (agent-preview://). */
      previewUrl?: string;
      mime?: string;
      size?: number;
      sizeLabel?: string;
      sheets?: Array<{ name: string; rows: string[][] }>;
      truncated?: boolean;
      note?: string;
    }
  | { ok: false; error: string };

function resolveSafePath(workspaceRoot: string, requested: string): string {
  const root = path.resolve(workspaceRoot);
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(root, requested);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes workspace root");
  }
  return candidate;
}

const HIDDEN_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

export type WorkspaceDirEntry = {
  name: string;
  /** Workspace-relative path using `/` separators. */
  path: string;
  kind: "file" | "dir";
};

export type ListWorkspaceDirResult =
  | { ok: true; path: string; entries: WorkspaceDirEntry[] }
  | { ok: false; error: string };

/** List one directory under the workspace (not recursive). */
export function listWorkspaceDir(
  workspaceRoot: string,
  requestedPath = "",
): ListWorkspaceDirResult {
  try {
    const trimmed = String(requestedPath || "").trim();
    const abs =
      !trimmed || trimmed === "." || trimmed === "/"
        ? path.resolve(workspaceRoot)
        : resolveSafePath(workspaceRoot, trimmed);

    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return { ok: false, error: "Directory not found in workspace" };
    }

    const relBase = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
    const entries: WorkspaceDirEntry[] = [];

    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const name = ent.name;
      if (name === ".DS_Store" || name === "Thumbs.db") continue;
      if (ent.isDirectory() && HIDDEN_DIR_NAMES.has(name)) continue;

      const kind: "file" | "dir" | null = ent.isDirectory()
        ? "dir"
        : ent.isFile() || ent.isSymbolicLink()
          ? "file"
          : null;
      if (!kind) continue;

      // For symlinks: only include if they stay inside the workspace.
      const childAbs = path.join(abs, name);
      try {
        resolveSafePath(workspaceRoot, childAbs);
      } catch {
        continue;
      }

      const childRel = (relBase ? `${relBase}/${name}` : name).replace(
        /\\/g,
        "/",
      );
      entries.push({ name, path: childRel, kind });
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return { ok: true, path: relBase || ".", entries };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  if (r === c) return true;
  const rel = path.relative(r, c);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** List under one or more roots. Empty path + multi-root → virtual root entries. */
export function listWorkspaceDirMulti(
  roots: string[],
  requestedPath = "",
): ListWorkspaceDirResult {
  const resolvedRoots = [...new Set(roots.map((r) => path.resolve(r)).filter(Boolean))];
  if (resolvedRoots.length === 0) {
    return { ok: false, error: "No workspace folders" };
  }
  if (resolvedRoots.length === 1) {
    return listWorkspaceDir(resolvedRoots[0]!, requestedPath);
  }

  const trimmed = String(requestedPath || "").trim();
  if (!trimmed || trimmed === "." || trimmed === "/") {
    const used = new Map<string, number>();
    const entries: WorkspaceDirEntry[] = resolvedRoots.map((root) => {
      const base = path.basename(root) || root;
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      return {
        name: n === 0 ? base : `${base} (${n + 1})`,
        path: root,
        kind: "dir" as const,
      };
    });
    return { ok: true, path: ".", entries };
  }

  if (path.isAbsolute(trimmed)) {
    const abs = path.resolve(trimmed);
    const root = resolvedRoots.find((r) => isInsideRoot(r, abs));
    if (!root) return { ok: false, error: "Path escapes project folders" };
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    const listed = listWorkspaceDir(root, rel === "" ? "." : rel);
    if (!listed.ok) return listed;
    return {
      ok: true,
      path: abs,
      entries: listed.entries.map((e) => ({
        ...e,
        path: path.join(abs, path.basename(e.path) === e.name ? e.name : e.name),
      })).map((e) => ({
        name: e.name,
        kind: e.kind,
        path: path.join(abs, e.name),
      })),
    };
  }

  return listWorkspaceDir(resolvedRoots[0]!, trimmed);
}

export function readWorkspacePreviewMulti(
  roots: string[],
  requestedPath: string,
) {
  const resolvedRoots = [...new Set(roots.map((r) => path.resolve(r)).filter(Boolean))];
  if (resolvedRoots.length === 0) {
    return Promise.resolve({ ok: false as const, error: "No workspace folders" });
  }
  const trimmed = String(requestedPath || "").trim();
  if (!trimmed) {
    return Promise.resolve({ ok: false as const, error: "path required" });
  }

  if (path.isAbsolute(trimmed)) {
    const abs = path.resolve(trimmed);
    const root = resolvedRoots.find((r) => isInsideRoot(r, abs));
    if (!root) {
      return Promise.resolve({
        ok: false as const,
        error: "Path escapes project folders",
      });
    }
    return readWorkspacePreview(root, abs);
  }

  for (const root of resolvedRoots) {
    try {
      resolveSafePath(root, trimmed);
      return readWorkspacePreview(root, trimmed);
    } catch {
      /* try next */
    }
  }
  return Promise.resolve({
    ok: false as const,
    error: "Path escapes project folders",
  });
}

function extOf(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base === "makefile") return base;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1) : "";
}

function languageForExt(ext: string): string {
  const map: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    html: "html",
    htm: "html",
    css: "css",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    csv: "csv",
    tsv: "tsv",
  };
  return map[ext] ?? "text";
}

function kindForExt(ext: string): WorkspacePreviewKind {
  if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (["xlsx", "xls", "xlsm", "sheet", "ods"].includes(ext)) return "spreadsheet";
  if (ext === "pdf") return "pdf";
  if (["docx", "doc", "docs", "rtf", "odt"].includes(ext)) return "document";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) {
    return "image";
  }
  if (
    ["mp4", "webm", "mov", "mkv", "m4v", "avi", "mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(
      ext,
    )
  ) {
    return "media";
  }
  if (
    [
      "js",
      "mjs",
      "cjs",
      "jsx",
      "ts",
      "tsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "swift",
      "c",
      "h",
      "cpp",
      "cc",
      "hpp",
      "cs",
      "php",
      "sh",
      "bash",
      "zsh",
      "sql",
      "css",
      "scss",
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "vue",
      "svelte",
      "txt",
      "log",
    ].includes(ext)
  ) {
    return ext === "txt" || ext === "log" ? "text" : "code";
  }
  if (
    ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso", "exe", "app", "bin", "onnx", "wasm", "parquet", "sqlite", "db"].includes(
      ext,
    )
  ) {
    return "binary";
  }
  return "unsupported";
}

function fileMeta(
  filePath: string,
  requestedPath: string,
  basename: string,
  ext: string,
  kind: WorkspacePreviewKind,
): Pick<
  Extract<WorkspacePreviewResult, { ok: true }>,
  "path" | "basename" | "ext" | "kind" | "mime" | "size" | "sizeLabel" | "previewUrl"
> {
  const size = fs.statSync(filePath).size;
  return {
    path: requestedPath,
    basename,
    ext,
    kind,
    mime: mimeForPath(filePath),
    size,
    sizeLabel: formatBytes(size),
    previewUrl: encodeAgentPreviewUrl(filePath),
  };
}

function looksLikeText(sample: Buffer): boolean {
  if (!sample.length) return false;
  let weird = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 7 && b !== 9 && b !== 10 && b !== 13) weird += 1;
  }
  return weird / sample.length < 0.02;
}

function readTextCapped(filePath: string): { text: string; truncated: boolean } {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_TEXT_BYTES) {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(MAX_TEXT_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_TEXT_BYTES, 0);
      return { text: buf.slice(0, n).toString("utf8"), truncated: true };
    } finally {
      fs.closeSync(fd);
    }
  }
  return { text: fs.readFileSync(filePath, "utf8"), truncated: false };
}

async function previewDocx(filePath: string): Promise<{ html: string }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ path: filePath });
  return { html: result.value || "<p>(empty document)</p>" };
}

async function previewSpreadsheet(
  filePath: string,
): Promise<Array<{ name: string; rows: string[][] }>> {
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(filePath, { cellDates: true });
  return wb.SheetNames.slice(0, 8).map((name) => {
    const sheet = wb.Sheets[name];
    const rows = sheet
      ? (XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
        }) as unknown[][])
      : [];
    const clipped = rows.slice(0, 80).map((r) =>
      (Array.isArray(r) ? r : []).slice(0, 40).map((c) => String(c ?? "")),
    );
    return { name, rows: clipped };
  });
}

export async function readWorkspacePreview(
  workspaceRoot: string,
  requestedPath: string,
): Promise<WorkspacePreviewResult> {
  try {
    const filePath = resolveSafePath(workspaceRoot, requestedPath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ok: false, error: "File not found in workspace" };
    }
    const ext = extOf(filePath);
    const kind = kindForExt(ext);
    const basename = path.basename(filePath);
    const language = languageForExt(ext);

    if (kind === "pdf") {
      const meta = fileMeta(filePath, requestedPath, basename, ext, "pdf");
      return {
        ok: true,
        ...meta,
        language: "pdf",
        note: `${meta.sizeLabel} · PDF preview`,
      };
    }

    if (kind === "media") {
      const meta = fileMeta(filePath, requestedPath, basename, ext, "media");
      return {
        ok: true,
        ...meta,
        language: meta.mime?.startsWith("audio/") ? "audio" : "video",
        note: `${meta.sizeLabel} · media preview`,
      };
    }

    if (kind === "document") {
      if (ext === "docx") {
        const size = fs.statSync(filePath).size;
        if (size > MAX_BINARY_BYTES) {
          const meta = fileMeta(filePath, requestedPath, basename, ext, "binary");
          return {
            ok: true,
            ...meta,
            language: "binary",
            note: `Document too large to convert in Canvas (${meta.sizeLabel}). Open with an external app.`,
          };
        }
        const { html } = await previewDocx(filePath);
        return {
          ok: true,
          path: requestedPath,
          basename,
          ext,
          kind,
          language: "html",
          html,
          mime: mimeForPath(filePath),
          size,
          sizeLabel: formatBytes(size),
          previewUrl: encodeAgentPreviewUrl(filePath),
        };
      }
      // .doc / .rtf / .odt — show file card + streaming open, no false "docx only" error
      const meta = fileMeta(filePath, requestedPath, basename, ext, "binary");
      return {
        ok: true,
        ...meta,
        language: "binary",
        note: `.${ext} is available here — open externally for full layout, or use the Open button.`,
      };
    }

    if (kind === "image") {
      const size = fs.statSync(filePath).size;
      const mime =
        ext === "svg"
          ? "image/svg+xml"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : ext === "bmp"
                  ? "image/bmp"
                  : ext === "avif"
                    ? "image/avif"
                    : "image/png";
      if (size > MAX_IMAGE_DATA_URL_BYTES) {
        return {
          ok: true,
          path: requestedPath,
          basename,
          ext,
          kind,
          language: "image",
          mime,
          size,
          sizeLabel: formatBytes(size),
          previewUrl: encodeAgentPreviewUrl(filePath),
          note: `${formatBytes(size)} · streamed image preview`,
        };
      }
      const buf = fs.readFileSync(filePath);
      return {
        ok: true,
        path: requestedPath,
        basename,
        ext,
        kind,
        language: "image",
        mime,
        size,
        sizeLabel: formatBytes(size),
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        previewUrl: encodeAgentPreviewUrl(filePath),
      };
    }

    if (kind === "spreadsheet") {
      if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        const size = fs.statSync(filePath).size;
        if (size > MAX_BINARY_BYTES) {
          const meta = fileMeta(filePath, requestedPath, basename, ext, "binary");
          return {
            ok: true,
            ...meta,
            language: "binary",
            note: `Spreadsheet too large to preview in Canvas (${meta.sizeLabel}).`,
          };
        }
        const sheets = await previewSpreadsheet(filePath);
        return {
          ok: true,
          path: requestedPath,
          basename,
          ext,
          kind,
          language: "csv",
          sheets,
          size,
          sizeLabel: formatBytes(size),
          mime: mimeForPath(filePath),
          previewUrl: encodeAgentPreviewUrl(filePath),
        };
      }
      // .sheet / .ods — try text read; otherwise file card
      try {
        const { text, truncated } = readTextCapped(filePath);
        if (text.trim()) {
          return {
            ok: true,
            path: requestedPath,
            basename,
            ext,
            kind: "csv",
            language: "csv",
            text,
            truncated,
            note: `Opened .${ext} as text (native spreadsheet preview supports .xlsx/.xls).`,
            previewUrl: encodeAgentPreviewUrl(filePath),
          };
        }
      } catch {
        /* fall through */
      }
      const meta = fileMeta(filePath, requestedPath, basename, ext, "binary");
      return {
        ok: true,
        ...meta,
        language: "binary",
        note: `.${ext} binary preview not available. Use .xlsx/.csv for sheet preview, or Open externally.`,
      };
    }

    if (kind === "binary" || kind === "unsupported") {
      // Sniff UTF-8 text for unknown extensions so Canvas still shows content when possible.
      try {
        const size = fs.statSync(filePath).size;
        if (size > 0 && size <= MAX_TEXT_BYTES) {
          const fd = fs.openSync(filePath, "r");
          try {
            const sampleSize = Math.min(size, 8000);
            const sample = Buffer.alloc(sampleSize);
            fs.readSync(fd, sample, 0, sampleSize, 0);
            if (looksLikeText(sample)) {
              const { text, truncated } = readTextCapped(filePath);
              return {
                ok: true,
                path: requestedPath,
                basename,
                ext,
                kind: "text",
                language: "text",
                text,
                truncated,
                mime: mimeForPath(filePath),
                size,
                sizeLabel: formatBytes(size),
                previewUrl: encodeAgentPreviewUrl(filePath),
                note: ext
                  ? `Showing .${ext} as text`
                  : "Showing file as text",
              };
            }
          } finally {
            fs.closeSync(fd);
          }
        }
      } catch {
        /* fall through to binary card */
      }
      const meta = fileMeta(filePath, requestedPath, basename, ext, "binary");
      return {
        ok: true,
        ...meta,
        language: "binary",
        note: ext
          ? `.${ext} · ${meta.sizeLabel} — preview as file card (Open / Reveal).`
          : `${meta.sizeLabel} — preview as file card (Open / Reveal).`,
      };
    }

    const { text, truncated } = readTextCapped(filePath);
    return {
      ok: true,
      path: requestedPath,
      basename,
      ext,
      kind,
      language,
      text,
      truncated,
      mime: mimeForPath(filePath),
      previewUrl: encodeAgentPreviewUrl(filePath),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const DELIVERABLE_EXT = new Set([
  "docx",
  "doc",
  "docs",
  "pdf",
  "xlsx",
  "xls",
  "xlsm",
  "csv",
  "tsv",
  "ods",
  "odt",
  "rtf",
  "html",
  "htm",
  "md",
  "mdx",
  "markdown",
]);

function extractPathsFromText(text: string): string[] {
  // Keep in sync with activity-artifact.extractResultPathsFromText (spaces in quotes).
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const p = String(raw || "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/[.,;:!?)\]}]+$/g, "");
    if (!p || seen.has(p)) return;
    const ext = p.split(".").pop()?.toLowerCase() || "";
    if (!DELIVERABLE_EXT.has(ext)) return;
    seen.add(p);
    found.push(p);
  };
  const tickRe =
    /`([^`\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))`/gi;
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(text)) !== null) push(m[1] || "");
  const dqRe =
    /"([^"\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))"/gi;
  while ((m = dqRe.exec(text)) !== null) push(m[1] || "");
  const sqRe =
    /'([^'\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))'/gi;
  while ((m = sqRe.exec(text)) !== null) push(m[1] || "");
  const unquoted =
    /(?:^|[\s"'=`(,\[{])((?:\.?\.?\/)?[\w./\\-]+\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))/gi;
  while ((m = unquoted.exec(text)) !== null) push(m[1] || "");
  return found.filter((p) => {
    const base = p.split("/").pop() || p;
    return !found.some(
      (other) =>
        other !== p &&
        other.length > p.length &&
        (other.endsWith(`/${base}`) ||
          other.endsWith(` ${base}`) ||
          other.endsWith(`-${base}`) ||
          other.endsWith(` - ${base}`)),
    );
  });
}

function extractScriptPathsFromCommand(command: string): string[] {
  if (!command) return [];
  const out: string[] = [];
  const re =
    /(?:python3?|node|tsx|bun|deno)\s+["']?([^\s"'`]+\.(?:py|js|mjs|cjs|ts|tsx))["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    if (m[1]) out.push(m[1].replace(/\\/g, "/"));
  }
  // bare script invocation: ./make_doc.py
  const bare = command.match(/(?:^|\s)((?:\.\/)?[\w./-]+\.(?:py|js|mjs))\b/);
  if (bare?.[1]) out.push(bare[1].replace(/\\/g, "/"));
  return [...new Set(out)];
}

function tryResolveExisting(
  workspaceRoot: string,
  candidate: string,
): string | null {
  const variants = [
    candidate,
    path.join("working", path.basename(candidate)),
    path.basename(candidate),
    path.join("working", candidate),
  ];
  for (const v of variants) {
    try {
      const abs = resolveSafePath(workspaceRoot, v);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return path.relative(workspaceRoot, abs).replace(/\\/g, "/") || v;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function listRecentDeliverables(
  workspaceRoot: string,
  maxAgeMs: number,
): Array<{ path: string; mtime: number }> {
  const roots = [workspaceRoot, path.join(workspaceRoot, "working")];
  const found: Array<{ path: string; mtime: number }> = [];
  const now = Date.now();
  for (const dir of roots) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = extOf(ent.name);
      if (!DELIVERABLE_EXT.has(ext)) continue;
      const abs = path.join(dir, ent.name);
      try {
        const st = fs.statSync(abs);
        if (now - st.mtimeMs > maxAgeMs) continue;
        found.push({
          path: path.relative(workspaceRoot, abs).replace(/\\/g, "/"),
          mtime: st.mtimeMs,
        });
      } catch {
        /* ignore */
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Find deliverable files (.docx/.xlsx/.md/…) related to a shell command or
 * free-text mentions. Used to auto-open Canvas after generate scripts run.
 */
export function discoverDeliverables(
  workspaceRoot: string,
  options: {
    texts?: string[];
    command?: string;
    maxAgeMs?: number;
  },
): { ok: true; paths: string[] } {
  const texts = [...(options.texts ?? [])];
  if (options.command) texts.push(options.command);

  const candidates = new Set<string>();
  for (const t of texts) {
    for (const p of extractPathsFromText(t)) candidates.add(p);
  }

  // Read generator scripts referenced by the command (e.g. python3 working/make_doc.py)
  const scripts = extractScriptPathsFromCommand(options.command ?? "");
  for (const script of scripts) {
    try {
      const abs = resolveSafePath(workspaceRoot, script);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const body = fs.readFileSync(abs, "utf8").slice(0, 200_000);
        for (const p of extractPathsFromText(body)) candidates.add(p);
      }
    } catch {
      /* ignore */
    }
  }

  const existing: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const resolved = tryResolveExisting(workspaceRoot, c);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    existing.push(resolved);
  }

  // Fallback: recently modified deliverables under workspace / working/
  if (existing.length === 0) {
    for (const r of listRecentDeliverables(
      workspaceRoot,
      options.maxAgeMs ?? 15 * 60 * 1000,
    ).slice(0, 5)) {
      if (!seen.has(r.path)) {
        seen.add(r.path);
        existing.push(r.path);
      }
    }
  }

  // Prefer documents/spreadsheets over markdown when ranking for auto-open
  existing.sort((a, b) => {
    const score = (p: string) => {
      const e = extOf(p);
      if (e === "docx" || e === "doc" || e === "docs") return 100;
      if (e === "xlsx" || e === "xls" || e === "csv") return 90;
      if (e === "html" || e === "htm") return 80;
      if (e === "md" || e === "mdx") return 50;
      return 10;
    };
    return score(b) - score(a);
  });

  return { ok: true, paths: existing };
}
