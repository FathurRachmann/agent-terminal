import React, { useEffect, useMemo, useState } from "react";

type CodeBlockProps = {
  code: string;
  language?: string;
  filename?: string;
};

type HighlighterComponent = React.ComponentType<{
  language: string;
  style: Record<string, React.CSSProperties>;
  customStyle?: React.CSSProperties;
  codeTagProps?: { style?: React.CSSProperties };
  showLineNumbers?: boolean;
  lineNumberStyle?: React.CSSProperties;
  wrapLongLines?: boolean;
  lineProps?: (lineNumber: number) => { style?: React.CSSProperties };
  children: string;
}>;

/** Cursor-like dark code panel with header + syntax highlight. */
export function CodeBlock({ code, language = "text", filename }: CodeBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [Highlighter, setHighlighter] = useState<HighlighterComponent | null>(
    null,
  );
  const trimmed = code.replace(/\n$/, "");
  const title = filename || guessFilename(language);
  const { added, removed } = useMemo(() => countDiff(trimmed), [trimmed]);

  useEffect(() => {
    let alive = true;
    void import("react-syntax-highlighter").then((mod) => {
      if (!alive) return;
      setHighlighter(() => mod.Prism as unknown as HighlighterComponent);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-[#2a313c] bg-[#0d1117] shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-2.5 border-b border-[#2a313c] bg-gradient-to-b from-[#161b22] to-[#12171e] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[9.5px] font-bold text-[#8b949e]">
            {"</>"}
          </span>
          <span
            className="truncate font-mono text-[11px] font-semibold text-[#e6edf3]"
            title={title}
          >
            {title}
          </span>
          {removed > 0 && (
            <span className="text-[9.5px] font-semibold text-danger">−{removed}</span>
          )}
          {added > 0 && (
            <span className="text-[9.5px] font-semibold text-success">+{added}</span>
          )}
          <span className="text-[9px] tracking-wider text-[#6e7681] uppercase">
            {language}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand code" : "Collapse code"}
          className="cursor-pointer border-0 bg-transparent p-0.5 text-xs leading-none text-[#8b949e]"
        >
          {collapsed ? "▢" : "×"}
        </button>
      </div>

      {!collapsed && (
        <div className="relative">
          {Highlighter ? (
            <Highlighter
              language={normalizeLang(language)}
              style={cursorDark}
              customStyle={{
                margin: 0,
                padding: "12px 0",
                background: "#0d1117",
                fontSize: 11,
                lineHeight: 1.55,
                fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
              }}
              codeTagProps={{
                style: {
                  fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
                },
              }}
              showLineNumbers={trimmed.split("\n").length > 3}
              lineNumberStyle={{
                minWidth: "2.5em",
                paddingRight: 12,
                color: "#484f58",
                userSelect: "none",
              }}
              wrapLongLines={false}
              lineProps={(lineNumber) => {
                const line = trimmed.split("\n")[lineNumber - 1] ?? "";
                const kind = diffKind(line);
                if (kind === "del") {
                  return {
                    style: {
                      background: "rgba(248, 81, 73, 0.15)",
                      borderLeft: "2px solid #f85149",
                      display: "block",
                      width: "100%",
                    },
                  };
                }
                if (kind === "add") {
                  return {
                    style: {
                      background: "rgba(63, 185, 80, 0.12)",
                      borderLeft: "2px solid #3fb950",
                      display: "block",
                      width: "100%",
                    },
                  };
                }
                return { style: { display: "block", width: "100%" } };
              }}
            >
              {trimmed}
            </Highlighter>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: "12px 16px",
                fontSize: 11,
                lineHeight: 1.55,
                color: "#e6edf3",
                fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
                overflow: "auto",
              }}
            >
              {trimmed}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function guessFilename(language: string): string {
  const map: Record<string, string> = {
    tsx: "snippet.tsx",
    jsx: "snippet.jsx",
    ts: "snippet.ts",
    js: "snippet.js",
    javascript: "snippet.js",
    typescript: "snippet.ts",
    python: "snippet.py",
    py: "snippet.py",
    bash: "snippet.sh",
    shell: "snippet.sh",
    sh: "snippet.sh",
    json: "snippet.json",
    css: "snippet.css",
    html: "snippet.html",
    md: "snippet.md",
    markdown: "snippet.md",
    go: "snippet.go",
    rust: "snippet.rs",
    sql: "snippet.sql",
    yaml: "snippet.yaml",
    yml: "snippet.yml",
  };
  return map[language.toLowerCase()] ?? "snippet.txt";
}

function normalizeLang(language: string): string {
  const l = language.toLowerCase();
  if (l === "ts") return "typescript";
  if (l === "js") return "javascript";
  if (l === "sh" || l === "shell") return "bash";
  if (l === "py") return "python";
  if (l === "yml") return "yaml";
  return l || "text";
}

function diffKind(line: string): "add" | "del" | null {
  if (/^-\s|^-$|^-[^-]/.test(line) && !line.startsWith("---")) return "del";
  if (/^\+\s|^\+$|^\+[^+]/.test(line) && !line.startsWith("+++")) return "add";
  return null;
}

function countDiff(code: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of code.split("\n")) {
    const k = diffKind(line);
    if (k === "add") added += 1;
    if (k === "del") removed += 1;
  }
  return { added, removed };
}

/** Minimal Cursor-ish Prism theme (dark). */
const cursorDark: { [key: string]: React.CSSProperties } = {
  'code[class*="language-"]': {
    color: "#e6edf3",
    background: "none",
    fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
    textAlign: "left",
    whiteSpace: "pre",
    wordSpacing: "normal",
    wordBreak: "normal",
    lineHeight: "1.55",
    tabSize: 2,
  },
  'pre[class*="language-"]': {
    color: "#e6edf3",
    background: "#0d1117",
    fontFamily: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
    textAlign: "left",
    whiteSpace: "pre",
    lineHeight: "1.55",
    margin: 0,
    padding: "12px 0",
    overflow: "auto",
  },
  comment: { color: "#8b949e", fontStyle: "italic" },
  prolog: { color: "#8b949e" },
  doctype: { color: "#8b949e" },
  cdata: { color: "#8b949e" },
  punctuation: { color: "#c9d1d9" },
  property: { color: "#79c0ff" },
  tag: { color: "#ff7b72" },
  boolean: { color: "#ffa657" },
  number: { color: "#ffa657" },
  constant: { color: "#79c0ff" },
  symbol: { color: "#d2a8ff" },
  deleted: { color: "#ffa198" },
  selector: { color: "#7ee787" },
  "attr-name": { color: "#79c0ff" },
  string: { color: "#a5d6ff" },
  char: { color: "#a5d6ff" },
  builtin: { color: "#ffa657" },
  inserted: { color: "#7ee787" },
  operator: { color: "#ff7b72" },
  entity: { color: "#79c0ff" },
  url: { color: "#a5d6ff" },
  ".language-css .token.string": { color: "#a5d6ff" },
  ".style .token.string": { color: "#a5d6ff" },
  atrule: { color: "#ffa657" },
  "attr-value": { color: "#a5d6ff" },
  keyword: { color: "#ff7b72" },
  function: { color: "#d2a8ff" },
  "class-name": { color: "#ffa657" },
  regex: { color: "#7ee787" },
  important: { color: "#ffa657", fontWeight: "bold" },
  variable: { color: "#ffa657" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
};

export function parseFenceMeta(
  className?: string,
  meta?: string,
): { language: string; filename?: string } {
  const langMatch = /language-([\w+-]+)/.exec(className || "");
  const language = langMatch?.[1] || "text";
  // Supports: ```tsx App.tsx  or  ```tsx:App.tsx  or  ```App.tsx
  const raw = (meta || "").trim();
  if (raw) {
    const file =
      raw.replace(/^:/, "").split(/\s+/)[0] ||
      undefined;
    if (file && /\.[\w]+$/.test(file)) {
      return { language, filename: file };
    }
    if (file && !file.includes("=")) {
      return { language, filename: file };
    }
  }
  // className sometimes is language-App.tsx
  if (language.includes(".")) {
    return { language: language.split(".").pop() || "text", filename: language };
  }
  return { language };
}
