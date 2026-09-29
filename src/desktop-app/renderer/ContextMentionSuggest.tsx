/** @ mention autocomplete for Agent / Ask / Plan / Debug composer (Cursor-style). */
import React, { useEffect, useMemo, useState } from "react";
import {
  STATIC_MENTION_SUGGESTS,
  type MentionSuggestItem,
} from "./mention-suggest-static.js";

export function contextMentionQueryFromValue(value: string): string | null {
  const m = /(^|\s)@([^\s]*)$/.exec(value);
  return m ? (m[2] ?? "") : null;
}

type Props = {
  value: string;
  /** File/folder hits from main process search. */
  fileHits?: MentionSuggestItem[];
  onPick: (insert: string) => void;
  keySinkRef?: React.MutableRefObject<
    ((e: React.KeyboardEvent) => boolean) | null
  >;
};

export function ContextMentionSuggest({
  value,
  fileHits = [],
  onPick,
  keySinkRef,
}: Props) {
  const query = useMemo(() => contextMentionQueryFromValue(value), [value]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const hits = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    const staticHits = STATIC_MENTION_SUGGESTS.filter((s) => {
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.detail ?? "").toLowerCase().includes(q)
      );
    });
    const files = fileHits.filter((f) => {
      if (!q) return true;
      return (
        f.label.toLowerCase().includes(q) ||
        f.insert.toLowerCase().includes(q)
      );
    });
    return [...staticHits, ...files].slice(0, 10);
  }, [fileHits, query]);

  useEffect(() => {
    setActive(0);
    setDismissed(false);
  }, [query]);

  useEffect(() => {
    if (!keySinkRef) return;
    keySinkRef.current = (e) => {
      if (dismissed || query === null || hits.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % hits.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + hits.length) % hits.length);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const pick = hits[active];
        if (!pick) return false;
        e.preventDefault();
        onPick(pick.insert.endsWith(":") ? pick.insert : `${pick.insert} `);
        return true;
      }
      return false;
    };
    return () => {
      keySinkRef.current = null;
    };
  }, [active, dismissed, hits, keySinkRef, onPick, query]);

  if (dismissed || query === null || hits.length === 0) return null;

  return (
    <div
      id="context-mention-listbox"
      className="mention-suggest absolute bottom-full left-0 z-[70] mb-1.5 w-full max-w-md overflow-hidden rounded-[10px] border border-border-strong bg-[#12141a] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      role="listbox"
      aria-label="Attach context"
    >
      <div className="composer-popover-section-label">Attach context</div>
      {hits.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item.insert.endsWith(":") ? item.insert : `${item.insert} `);
          }}
          className={`composer-menu-item composer-menu-item-row cursor-pointer ${
            i === active ? "is-selected" : ""
          }`}
        >
          <span className="mention-chip">{item.label}</span>
          <span className="min-w-0 flex-1 truncate text-left text-[11px] text-muted">
            {item.detail || item.kind}
          </span>
        </div>
      ))}
    </div>
  );
}
