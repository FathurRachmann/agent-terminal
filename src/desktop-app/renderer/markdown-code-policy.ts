/**
 * Policy for markdown fences in chat:
 * - diagrams → snippet / diagram viewers
 * - coding files → always render as green/red diff (never "snippet.ts")
 */

const DIAGRAM_LANGS = new Set([
  "mermaid",
  "mmd",
  "dbml",
  "plantuml",
  "puml",
  "dot",
  "graphviz",
]);

const CODING_LANGS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "javascript",
  "typescript",
  "python",
  "py",
  "go",
  "rust",
  "rs",
  "java",
  "kt",
  "kotlin",
  "swift",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "svelte",
  "sql",
  "pgsql",
  "postgres",
  "postgresql",
  "mysql",
  "sqlite",
  "yaml",
  "yml",
  "toml",
  "xml",
  "md",
  "markdown",
  "sh",
  "bash",
  "shell",
  "zsh",
  "dockerfile",
  "docker",
  "env",
  "ini",
  "conf",
  "txt",
  "text",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "ruby",
  "diff",
  "patch",
]);

const PATH_RE =
  /(?:^|[\s`"'(])([A-Za-z0-9_./@-]+\.[A-Za-z0-9]{1,12})(?:$|[\s`"')])/;

export function isDiagramLanguage(language: string): boolean {
  return DIAGRAM_LANGS.has(String(language || "").toLowerCase());
}

export function isCodingLanguage(language: string): boolean {
  const l = String(language || "").toLowerCase();
  if (!l || l === "text" || l === "plaintext") return true;
  if (isDiagramLanguage(l)) return false;
  return CODING_LANGS.has(l) || /\.[a-z0-9]+$/i.test(l);
}

/** True when this fence should use ChatDiffCard instead of CodeBlock snippet. */
export function shouldRenderFenceAsDiff(
  language: string,
  code: string,
): boolean {
  if (isDiagramLanguage(language)) return false;
  if (/^(diff|patch)$/i.test(language)) return true;
  if (isCodingLanguage(language)) return true;
  // Unknown lang but looks like source (has braces / imports) → still diff
  if (
    /\b(import|export|function|const|class|def |package )\b/.test(code) ||
    /[{};]\s*$/m.test(code)
  ) {
    return true;
  }
  return false;
}

/**
 * Attach a nearby file path onto the following fence so parseFenceMeta sees it.
 * e.g. `frontend/nuxt.config.ts`\n\n```ts  →  ```ts frontend/nuxt.config.ts
 */
export function attachFencePaths(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const out: string[] = [];
  let pendingPath: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceOpen = /^```([\w+-]*)(.*)$/.exec(line);
    if (fenceOpen) {
      const lang = fenceOpen[1] || "";
      const rest = (fenceOpen[2] || "").trim();
      if (!rest && pendingPath && shouldRenderFenceAsDiff(lang || "text", "")) {
        out.push(`\`\`\`${lang || "text"} ${pendingPath}`);
        pendingPath = null;
        continue;
      }
      pendingPath = null;
      out.push(line);
      continue;
    }

    const tick = /^\s*`([^`\n]+)`\s*$/.exec(line);
    if (tick && /\.[\w]+$/.test(tick[1]!.trim())) {
      pendingPath = tick[1]!.trim().replace(/\\/g, "/");
      out.push(line);
      continue;
    }

    const bare = /^\s*([A-Za-z0-9_./@-]+\.[\w]{1,12})\s*$/.exec(line);
    if (bare && looksLikeRelPath(bare[1]!)) {
      pendingPath = bare[1]!.replace(/\\/g, "/");
      out.push(line);
      continue;
    }

    // Path in a short "Proposed Patch" line: **file** or File: path
    const labeled =
      /(?:^|\*\*|File:|Path:|Update:?)\s*`?([A-Za-z0-9_./@-]+\.[\w]{1,12})`?/i.exec(
        line,
      );
    if (labeled && looksLikeRelPath(labeled[1]!)) {
      pendingPath = labeled[1]!.replace(/\\/g, "/");
    } else if (line.trim() === "" || /^#{1,6}\s/.test(line)) {
      // keep pending across blank / heading
    } else if (!PATH_RE.test(line)) {
      // prose — don't clear immediately; blank lines already handled
    }

    out.push(line);
  }

  return out.join("\n");
}

function looksLikeRelPath(p: string): boolean {
  if (!p || p.length > 240) return false;
  if (/\s/.test(p)) return false;
  if (!/\.[\w]+$/.test(p)) return false;
  // Avoid catching version numbers like 1.2.3
  if (/^\d+(\.\d+)+$/.test(p)) return false;
  return true;
}
