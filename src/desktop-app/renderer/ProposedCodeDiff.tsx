import React, { useEffect, useState } from "react";
import { ChatDiffCard } from "./ChatDiffCard.js";

/**
 * Render a coding fence as a green/red diff (vs workspace file when possible).
 * Never falls back to the "snippet.ts" CodeBlock for source files.
 */
export function ProposedCodeDiff({
  code,
  language,
  filename,
  onOpenPath,
}: {
  code: string;
  language?: string;
  filename?: string;
  onOpenPath?: (path: string) => void;
}) {
  const path =
    filename?.trim() ||
    `proposed.${extForLanguage(language || "txt")}`;
  const [before, setBefore] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const rel = filename?.trim();
    if (!rel) {
      setBefore("");
      return;
    }
    setBefore(null);
    void (async () => {
      try {
        const res = await window.electronAgent?.readWorkspacePreview?.(rel);
        if (!alive) return;
        if (res?.ok && typeof res.text === "string") {
          setBefore(res.text);
        } else {
          setBefore("");
        }
      } catch {
        if (alive) setBefore("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [filename]);

  if (before === null) {
    return (
      <div className="chat-diff chat-diff-inline mb-3 px-3 py-2 text-[11px] text-muted">
        Loading diff for {path}…
      </div>
    );
  }

  return (
    <div className="mb-3">
      <ChatDiffCard
        path={path}
        language={language || "CODE"}
        before={before}
        after={code}
        embedded
        onOpenCanvas={
          filename && onOpenPath
            ? () => onOpenPath(filename)
            : undefined
        }
      />
    </div>
  );
}

function extForLanguage(language: string): string {
  const l = language.toLowerCase();
  const map: Record<string, string> = {
    typescript: "ts",
    javascript: "js",
    tsx: "tsx",
    jsx: "jsx",
    python: "py",
    py: "py",
    json: "json",
    css: "css",
    html: "html",
    yaml: "yaml",
    yml: "yml",
    md: "md",
    markdown: "md",
    shell: "sh",
    bash: "sh",
    sh: "sh",
  };
  return map[l] || l || "txt";
}
