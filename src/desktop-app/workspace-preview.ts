import fs from "node:fs";
import path from "node:path";

const MAX_TEXT_BYTES = 400_000;
const MAX_BINARY_BYTES = 8_000_000;

export type WorkspacePreviewResult =
  | {
      ok: true;
      path: string;
      basename: string;
      ext: string;
      kind:
        | "markdown"
        | "code"
        | "html"
        | "csv"
        | "spreadsheet"
        | "document"
        | "image"
        | "text"
        | "unsupported";
      language: string;
      text?: string;
      html?: string;
      dataUrl?: string;
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

function kindForExt(
  ext: string,
): Exclude<Extract<WorkspacePreviewResult, { ok: true }>["kind"], never> {
  if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (["xlsx", "xls", "xlsm", "sheet", "ods"].includes(ext)) return "spreadsheet";
  if (["docx", "doc", "docs", "rtf", "odt", "pdf"].includes(ext)) return "document";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) {
    return "image";
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
  return "unsupported";
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

    if (kind === "document") {
      if (ext === "docx") {
        const size = fs.statSync(filePath).size;
        if (size > MAX_BINARY_BYTES) {
          return { ok: false, error: "Document too large to preview" };
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
        };
      }
      return {
        ok: true,
        path: requestedPath,
        basename,
        ext,
        kind,
        language: "text",
        note: `.${ext} preview needs conversion (supported: .docx). Open the file in an external editor.`,
      };
    }

    if (kind === "image") {
      const size = fs.statSync(filePath).size;
      if (size > 4_000_000) {
        return { ok: false, error: "Image too large to preview" };
      }
      const buf = fs.readFileSync(filePath);
      const mime =
        ext === "svg"
          ? "image/svg+xml"
          : ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "gif"
              ? "image/gif"
              : ext === "webp"
                ? "image/webp"
                : "image/png";
      return {
        ok: true,
        path: requestedPath,
        basename,
        ext,
        kind,
        language: "image",
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      };
    }

    if (kind === "spreadsheet") {
      if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        const size = fs.statSync(filePath).size;
        if (size > MAX_BINARY_BYTES) {
          return { ok: false, error: "Spreadsheet too large to preview" };
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
        };
      }
      // .sheet / .ods — try text read; otherwise note
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
          };
        }
      } catch {
        /* fall through */
      }
      return {
        ok: true,
        path: requestedPath,
        basename,
        ext,
        kind,
        language: "text",
        note: `.${ext} binary preview not available. Use .xlsx/.csv for sheet preview.`,
      };
    }

    if (kind === "unsupported") {
      return {
        ok: true,
        path: requestedPath,
        basename,
        ext,
        kind,
        language: "text",
        note: `No rich preview for .${ext || "(no extension)"}.`,
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
  if (!text) return [];
  const re =
    /(?:^|[\s"'=`(,\[{])((?:\.?\.?\/)?[\w./\\-]+\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))/gi;
  const found: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || "").replace(/\\/g, "/");
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    found.push(raw);
  }
  return found;
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
