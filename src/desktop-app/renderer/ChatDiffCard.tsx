import React from "react";
import type { DiffLine } from "./tool-diff.js";
import { diffLinesFromSides } from "./tool-diff.js";

/** Inline Cursor-style green/red diff block for the main chat feed. */
export function ChatDiffCard({
  path,
  language,
  before,
  after,
  onOpenCanvas,
  embedded = false,
}: {
  path: string;
  language?: string;
  before: string;
  after: string;
  onOpenCanvas?: () => void;
  /** When true, skip outer chat-msg chrome (used inside MarkdownBody). */
  embedded?: boolean;
}) {
  const lines = diffLinesFromSides(before, after);
  const adds = lines.filter((l) => l.kind === "add").length;
  const dels = lines.filter((l) => l.kind === "del").length;
  const base = path.replace(/\\/g, "/").split("/").pop() || path;

  const body = (
    <div className={`chat-diff chat-diff-inline${embedded ? "" : ""}`}>
      <div className="chat-diff-head">
        <span className="chat-diff-meta" title={path}>
          {path}
        </span>
        <span className="chat-diff-lang">
          {dels > 0 ? `−${dels} ` : ""}
          {adds > 0 ? `+${adds} ` : ""}
          DIFF
          {language ? ` · ${language.toUpperCase()}` : ""}
          {onOpenCanvas ? (
            <>
              {" · "}
              <button
                type="button"
                className="chat-diff-open"
                onClick={onOpenCanvas}
              >
                Open side-by-side
              </button>
            </>
          ) : null}
        </span>
      </div>
      <pre className="chat-diff-body">
        {lines.length === 0 ? (
          <div className="chat-diff-line is-ctx"> (no changes)</div>
        ) : (
          lines.map((line: DiffLine, i: number) => (
            <div key={i} className={`chat-diff-line is-${line.kind}`}>
              {line.text}
            </div>
          ))
        )}
      </pre>
    </div>
  );

  if (embedded) return body;

  return (
    <div className="chat-msg">
      <div className="chat-msg-meta">
        <span className="chat-msg-who is-agent">
          <span className="chat-dot chat-dot-agent" />
          DIFF · {base}
        </span>
        <span className="chat-msg-time">
          {dels > 0 ? <span className="text-danger">−{dels}</span> : null}
          {dels > 0 && adds > 0 ? " " : null}
          {adds > 0 ? <span className="text-success">+{adds}</span> : null}
        </span>
      </div>
      {body}
    </div>
  );
}
