/** Lightweight @mention autocomplete for workspace group chat composer. */
import React, { useEffect, useMemo, useState } from "react";

type Bot = { id: string; name: string; role?: string };

type Props = {
  value: string;
  bots: Bot[];
  onPick: (token: string) => void;
  /** Wire from textarea onKeyDown — return true if the event was handled. */
  keySinkRef?: React.MutableRefObject<
    ((e: React.KeyboardEvent) => boolean) | null
  >;
};

export function mentionQueryFromValue(value: string): string | null {
  const m = /(^|\s)@([a-zA-Z0-9._-]*)$/.exec(value);
  return m ? m[2]!.toLowerCase() : null;
}

export function MentionSuggest({ value, bots, onPick, keySinkRef }: Props) {
  const query = useMemo(() => mentionQueryFromValue(value), [value]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const hits = useMemo(() => {
    if (query === null || bots.length === 0) return [];
    return bots
      .filter((b) => {
        if (!query) return true;
        const hay = `${b.id} ${b.name} ${b.role ?? ""}`.toLowerCase();
        return hay.includes(query);
      })
      .slice(0, 6);
  }, [bots, query]);

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
        onPick(`@${pick.id}`);
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
      id="mention-listbox"
      className="mention-suggest absolute bottom-full left-0 z-[70] mb-1.5 w-full max-w-sm overflow-hidden rounded-[10px] border border-border-strong bg-[#12141a] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
      role="listbox"
      aria-label="Mention members"
    >
      <div className="composer-popover-section-label">Members</div>
      {hits.map((b, i) => (
        <div
          key={b.id}
          id={`mention-opt-${b.id}`}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(`@${b.id}`);
          }}
          className={`composer-menu-item composer-menu-item-row cursor-pointer ${
            i === active ? "is-selected" : ""
          }`}
        >
          <span className="mention-chip">@{b.id}</span>
          <span className="min-w-0 flex-1 truncate text-left text-[11px] text-muted">
            {b.name}
            {b.role ? ` · ${b.role}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
