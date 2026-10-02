import React, { Suspense, lazy, useMemo } from "react";
import { summarizePatchStats } from "./tool-diff.js";

const DiffEditor = lazy(async () => {
  const [{ DiffEditor: Editor }, monaco, { loader }] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
    import("@monaco-editor/react"),
  ]);
  // Bundle monaco locally — avoids Vite/Rolldown `?worker` resolve failures.
  loader.config({ monaco });
  return { default: Editor };
});

export type DiffMonacoViewerProps = {
  path: string;
  language?: string;
  original: string;
  modified: string;
  /** dark | light — match app chrome */
  theme?: "dark" | "light";
};

/** Read-only side-by-side Monaco diff for Canvas. */
export function DiffMonacoViewer({
  path,
  language = "plaintext",
  original,
  modified,
  theme = "dark",
}: DiffMonacoViewerProps) {
  const stats = useMemo(() => {
    const lines: string[] = [];
    const a = original.split(/\r?\n/);
    const b = modified.split(/\r?\n/);
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const left = a[i];
      const right = b[i];
      if (left === right) continue;
      if (left != null && right == null) lines.push(`-${left}`);
      else if (left == null && right != null) lines.push(`+${right}`);
      else {
        lines.push(`-${left}`);
        lines.push(`+${right}`);
      }
    }
    return summarizePatchStats(lines.join("\n"));
  }, [original, modified]);

  const monacoTheme = theme === "light" ? "light" : "vs-dark";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5 font-mono text-[10px]">
        <span className="min-w-0 truncate text-fg" title={path}>
          {path}
        </span>
        <span className="shrink-0 text-muted">
          {stats ?? "diff"} · side-by-side · read-only
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted">
              Loading diff editor…
            </div>
          }
        >
          <DiffEditor
            height="100%"
            language={language}
            theme={monacoTheme}
            original={original}
            modified={modified}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              wordWrap: "off",
              scrollBeyondLastLine: false,
              fontSize: 12,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              automaticLayout: true,
              renderIndicators: true,
              originalEditable: false,
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
