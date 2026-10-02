/** Detect previewable file artifacts from Live activity / tool events. */

import { restoreAbsolutePathPrefix } from "../path-normalize.js";

export type PreviewKind =
  | "markdown"
  | "code"
  | "diff"
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

export type ActivityArtifact = {
  path: string;
  basename: string;
  ext: string;
  kind: PreviewKind;
  language: string;
  /** Inline content when available from tool input/output (may be truncated). */
  inlineContent?: string;
  source: "tool_input" | "tool_output" | "path_only";
};

const CODE_EXT: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  vue: "javascript",
  svelte: "javascript",
  md: "markdown",
  mdx: "markdown",
  txt: "text",
  log: "text",
  env: "bash",
  dockerfile: "docker",
  html: "html",
  htm: "html",
};

const FILE_TOOLS = new Set([
  "read_file",
  "read",
  "write_file",
  "write",
  "edit_file",
  "edit",
  "str_replace",
]);

const SHELL_TOOLS = new Set(["execute", "shell", "bash"]);

/** Higher = prefer as the Canvas result to show the user. */
export function canvasResultRank(kind: PreviewKind): number {
  switch (kind) {
    case "document":
      return 100;
    case "pdf":
      return 98;
    case "spreadsheet":
      return 90;
    case "html":
      return 80;
    case "csv":
      return 70;
    case "image":
      return 65;
    case "media":
      return 62;
    case "markdown":
      return 60;
    case "diff":
      return 95;
    case "binary":
      return 40;
    case "text":
      return 25;
    case "code":
      return 10;
    default:
      return 0;
  }
}

/** Auto-focus Canvas only for deliverable results — not generator scripts. */
export function shouldAutoFocusCanvas(kind: PreviewKind): boolean {
  return canvasResultRank(kind) >= 60;
}

export function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function basenamePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Stable Canvas tab key so the same deliverable opened via relative path,
 * absolute path, or rediscovery collapses to one tab.
 */
export function normalizeCanvasKey(path: string): string {
  const cleaned = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!cleaned) return cleaned;
  const artifact = cleaned.match(/(?:^|\/)((?:tmp|working)\/[^?#]+)$/i);
  if (artifact?.[1]) return artifact[1].toLowerCase();
  const base = basenamePath(cleaned).toLowerCase();
  const kind = inferPreviewKind(extensionOf(cleaned));
  if (canvasResultRank(kind) >= 60) return `deliverable:${base}`;
  return cleaned.toLowerCase();
}

/** Prefer the path most likely to resolve on disk for workspace preview. */
export function preferCanvasPath(current: string, next: string): string {
  const a = current.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  const score = (p: string) => {
    let s = 0;
    if (p.startsWith("/") || /^[a-z]:\//i.test(p)) s += 4;
    if (
      /\/(?:tmp|working)\//i.test(p) ||
      /^(?:tmp|working)\//i.test(p)
    )
      s += 2;
    s += Math.min(p.length, 200) / 200;
    return s;
  };
  return score(b) >= score(a) ? b : a;
}

export function extensionOf(p: string): string {
  const base = basenamePath(p).toLowerCase();
  if (base === "dockerfile" || base === "makefile") return base;
  const i = base.lastIndexOf(".");
  if (i < 0) return "";
  return base.slice(i + 1);
}

/** True when inline text looks like a workspace-relative file path users can open. */
export function looksLikeWorkspacePath(raw: string): boolean {
  const t = String(raw || "")
    .trim()
    .replace(/\\/g, "/");
  if (!t || t.length > 300 || /\s/.test(t)) return false;
  if (/^[`'"([{]/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  // path/to/file.ext or ./file.ext or file.ext
  if (
    !/^(?:\.?\.?\/)?[\w.@+-]+(?:\/[\w.@+-]+)*\.[A-Za-z0-9]{1,12}$/.test(t)
  ) {
    return false;
  }
  const ext = extensionOf(t);
  if (!ext) return false;
  const kind = inferPreviewKind(ext);
  const hasSlash = t.includes("/");
  // Bare `console.log`-style tokens: only allow common deliverable extensions.
  if (!hasSlash) {
    return (
      kind === "markdown" ||
      kind === "document" ||
      kind === "pdf" ||
      kind === "spreadsheet" ||
      kind === "html" ||
      kind === "csv" ||
      kind === "image" ||
      kind === "media" ||
      kind === "binary"
    );
  }
  if (ext in CODE_EXT) return true;
  return kind !== "unsupported";
}

export function inferPreviewKind(ext: string): PreviewKind {
  const e = ext.toLowerCase();
  if (e === "md" || e === "mdx" || e === "markdown" || e === "mmd") return "markdown";
  if (e === "html" || e === "htm") return "html";
  if (e === "csv" || e === "tsv") return "csv";
  if (e === "xlsx" || e === "xls" || e === "xlsm" || e === "sheet" || e === "ods") {
    return "spreadsheet";
  }
  if (e === "docx" || e === "doc" || e === "docs" || e === "rtf" || e === "odt") {
    return "document";
  }
  if (e === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(e)) {
    return "image";
  }
  if (
    ["mp4", "webm", "mov", "mkv", "m4v", "avi", "mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(
      e,
    )
  ) {
    return "media";
  }
  if (
    ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "dmg", "iso", "exe", "bin", "onnx", "wasm"].includes(
      e,
    )
  ) {
    return "binary";
  }
  if (e in CODE_EXT) return e === "html" || e === "htm" ? "html" : "code";
  if (e === "txt" || e === "log") return "text";
  return "unsupported";
}

export function languageForExt(ext: string): string {
  return CODE_EXT[ext.toLowerCase()] ?? "text";
}

function pickPath(args: Record<string, unknown>): string {
  const raw =
    args.file_path ??
    args.path ??
    args.filename ??
    args.file ??
    args.target_file ??
    args.filepath ??
    "";
  return String(raw || "").trim();
}

function pickInlineContent(
  toolName: string,
  args: Record<string, unknown>,
  output?: string,
): { content?: string; source: ActivityArtifact["source"] } {
  const fromArgs = String(
    args.content ??
      args.new_string ??
      args.newString ??
      args.contents ??
      args.text ??
      "",
  );
  if (fromArgs.trim()) {
    return { content: fromArgs, source: "tool_input" };
  }
  if (
    output &&
    (toolName === "read_file" || toolName === "read") &&
    !looksLikeJsonEnvelope(output)
  ) {
    return { content: output, source: "tool_output" };
  }
  return { source: "path_only" };
}

function looksLikeJsonEnvelope(s: string): boolean {
  const t = s.trim();
  return t.startsWith("{") || t.startsWith("[");
}

function artifactFromPath(
  path: string,
  options?: { inlineContent?: string; source?: ActivityArtifact["source"] },
): ActivityArtifact | null {
  const cleaned = path.trim().replace(/^['"`]+|['"`]+$/g, "");
  if (!cleaned) return null;
  const ext = extensionOf(cleaned);
  const kind = inferPreviewKind(ext);
  if (kind === "unsupported") return null;
  return {
    path: cleaned,
    basename: basenamePath(cleaned),
    ext,
    kind,
    language: languageForExt(ext),
    inlineContent: options?.inlineContent,
    source: options?.inlineContent
      ? (options.source ?? "tool_input")
      : "path_only",
  };
}

/**
 * Pull deliverable file paths (.docx, .xlsx, .md, …) out of free text
 * (shell commands, script bodies, tool output).
 * Supports spaces inside backticks/quotes (e.g. `working/LAPORAN … DIANDRA.doc`).
 */
export function extractResultPathsFromText(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();

  const refineQuoted = (raw: string): string => {
    let t = String(raw || "")
      .trim()
      .replace(/\\/g, "/");
    if (!t) return "";
    if (t.includes("/")) {
      // Drop leading prose before the first path-looking segment.
      // Include a leading `/` so absolute Unix paths are not truncated to Users/...
      const idx = t.search(/(?:\/|\.\.?\/|[A-Za-z0-9_.-]+\/)/);
      if (idx > 0) t = t.slice(idx);
      return t;
    }
    if (!/\s/.test(t)) return t;
    // Spaced filename without slash — strip leading noise words ("wrote foo.docx")
    const noise =
      /^(wrote|saved|created|file|path|at|to|the|a|an|output|result|here|see)$/i;
    const tokens = t.split(/\s+/);
    while (tokens.length > 1 && noise.test(tokens[0] || "")) tokens.shift();
    return tokens.join(" ");
  };

  const push = (raw: string, quoted = false) => {
    let p = quoted
      ? refineQuoted(raw)
      : String(raw || "").trim().replace(/\\/g, "/");
    p = restoreAbsolutePathPrefix(p.replace(/[.,;:!?)\]}]+$/g, ""));
    if (!p || seen.has(p)) return;
    const kind = inferPreviewKind(extensionOf(p));
    if (canvasResultRank(kind) < 60) return;
    seen.add(p);
    found.push(p);
  };

  // 1) Backtick-quoted paths (may contain spaces)
  const tickRe =
    /`([^`\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))`/gi;
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(text)) !== null) {
    const raw = m[1] || "";
    const base = raw.split("/").pop() || raw;
    if (!/^(document|window|element|node|process|global|console|navigator|location)\.[a-z0-9]+$/i.test(base)) {
      push(raw, true);
    }
  }

  // 2) Double / single quoted paths (may contain spaces)
  const dqRe =
    /"([^"\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))"/gi;
  while ((m = dqRe.exec(text)) !== null) {
    const raw = m[1] || "";
    const base = raw.split("/").pop() || raw;
    if (!/^(document|window|element|node|process|global|console|navigator|location)\.[a-z0-9]+$/i.test(base)) {
      push(raw, true);
    }
  }
  const sqRe =
    /'([^'\n]+?\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))'/gi;
  while ((m = sqRe.exec(text)) !== null) {
    const raw = m[1] || "";
    const base = raw.split("/").pop() || raw;
    if (!/^(document|window|element|node|process|global|console|navigator|location)\.[a-z0-9]+$/i.test(base)) {
      push(raw, true);
    }
  }

  // 3) Unquoted paths (no spaces) — classic working/foo.docx
  const unquoted =
    /(?:^|[\s"'=`(,\[{])((?:\.?\.?\/)?[\w./\\-]+\.(?:docx?|docs|pdf|xlsx?|xlsm|csv|tsv|ods|odt|rtf|html?|mdx?|markdown))/gi;
  while ((m = unquoted.exec(text)) !== null) {
    const raw = m[1] || "";
    const base = raw.split("/").pop() || raw;
    if (!/^(document|window|element|node|process|global|console|navigator|location)\.[a-z0-9]+$/i.test(base)) {
      push(raw, false);
    }
  }

  // Drop bare basenames that are clearly truncated from a longer path match
  return found.filter((p) => {
    if (p.includes("/")) return true;
    return !found.some(
      (other) =>
        other !== p &&
        other.includes("/") &&
        (other.endsWith(`/${p}`) ||
          other.endsWith(` ${p}`) ||
          other.endsWith(`-${p}`) ||
          other.endsWith(` - ${p}`)),
    );
  });
}

export function resolveArtifactFromTool(options: {
  name: string;
  input?: unknown;
  output?: string;
}): ActivityArtifact | null {
  const many = resolveArtifactsFromTool(options);
  return many[0] ?? null;
}

/**
 * Resolve canvas candidates from a tool call.
 * Prefer deliverables (docx/xlsx/md/…) over generator scripts (.py/.js).
 */
export function resolveArtifactsFromTool(options: {
  name: string;
  input?: unknown;
  output?: string;
}): ActivityArtifact[] {
  const args = asRecord(options.input);
  const out: ActivityArtifact[] = [];
  const push = (a: ActivityArtifact | null) => {
    if (!a) return;
    if (out.some((x) => x.path === a.path)) return;
    out.push(a);
  };

  if (FILE_TOOLS.has(options.name)) {
    const path = pickPath(args);
    const { content, source } = pickInlineContent(
      options.name,
      args,
      options.output,
    );
    if (path) {
      push(
        artifactFromPath(path, {
          inlineContent: content,
          source: content ? source : "path_only",
        }),
      );
    }
    // Script/content may reference the real deliverable (e.g. make_doc.py → laporan.docx)
    for (const p of extractResultPathsFromText(
      `${content ?? ""}\n${options.output ?? ""}`,
    )) {
      if (p !== path) push(artifactFromPath(p));
    }
  } else if (SHELL_TOOLS.has(options.name)) {
    const cmd = String(args.command ?? args.cmd ?? "");
    for (const p of extractResultPathsFromText(
      `${cmd}\n${options.output ?? ""}`,
    )) {
      push(artifactFromPath(p));
    }
  }

  return out.sort(
    (a, b) => canvasResultRank(b.kind) - canvasResultRank(a.kind),
  );
}

/** Pick the best artifact to auto-focus in Canvas (null = don't steal focus). */
export function pickAutoFocusArtifact(
  artifacts: ActivityArtifact[],
): ActivityArtifact | null {
  for (const a of artifacts) {
    if (shouldAutoFocusCanvas(a.kind)) return a;
  }
  return null;
}

/** Parse CSV/TSV into a bounded grid for table preview. */
export function parseDelimitedPreview(
  text: string,
  options?: { delimiter?: string; maxRows?: number; maxCols?: number },
): { headers: string[]; rows: string[][] } {
  const delimiter =
    options?.delimiter ??
    (text.includes("\t") && !text.slice(0, 200).includes(",") ? "\t" : ",");
  const maxRows = options?.maxRows ?? 80;
  const maxCols = options?.maxCols ?? 40;
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const grid: string[][] = [];
  for (const line of lines) {
    if (grid.length >= maxRows) break;
    if (!line.trim() && grid.length === 0) continue;
    grid.push(splitDelimitedLine(line, delimiter).slice(0, maxCols));
  }
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0] ?? [];
  const rows = grid.slice(1);
  return { headers, rows };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
