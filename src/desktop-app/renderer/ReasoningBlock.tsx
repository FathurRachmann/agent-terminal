import React, { useState } from "react";
import { TypingDots, StreamingCaret } from "./WaitingIndicator.js";

/** Collapsed-by-default reasoning / provider-notice panel (not a chat bubble). */
export function ReasoningBlock({
  text,
  at,
  live = false,
  label = "Reasoning",
}: {
  text: string;
  at?: string;
  live?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(live || text.length < 280);

  return (
    <div
      className="my-1 max-w-[96%] self-stretch border-l-2 border-reason/70 pl-2.5"
      role="status"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono text-xs text-reason"
      >
        <span className="w-2.5">{open ? "▾" : "▸"}</span>
        <span>{label}</span>
        {live && <TypingDots color="#b7a6e8" />}
        {at && !live && <span className="font-normal text-muted">{at}</span>}
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] italic leading-relaxed text-reason/80">
          {text}
          {live && <StreamingCaret color="#b7a6e8" />}
        </div>
      )}
    </div>
  );
}
