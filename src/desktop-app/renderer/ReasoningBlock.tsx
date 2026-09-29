import React, { useMemo, useState } from "react";
import { TypingDots, StreamingCaret } from "./WaitingIndicator.js";

export type RecallSlot = {
  tag: string;
  body: string;
  kind: "memory" | "policy" | "note";
};

/** Split reasoning text into `[Tag]: body` recall slots when possible. */
export function parseRecallSlots(text: string): RecallSlot[] {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const slots: RecallSlot[] = [];
  const re = /\[([^\]]{1,64})\]\s*:\s*/g;
  const matches = [...raw.matchAll(re)];
  if (matches.length === 0) {
    return [{ tag: "Reasoning", body: raw, kind: "note" }];
  }

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i]!;
    const start = (m.index ?? 0) + m[0]!.length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : raw.length;
    const tag = String(m[1] || "").trim();
    const body = raw.slice(start, end).trim();
    if (!tag || !body) continue;
    const kind: RecallSlot["kind"] = /policy|agents\.md/i.test(tag)
      ? "policy"
      : /store|memory|ltm|sqlite|redis|recall/i.test(tag)
        ? "memory"
        : "note";
    slots.push({ tag, body, kind });
  }
  return slots.length ? slots : [{ tag: "Reasoning", body: raw, kind: "note" }];
}

function slotIcon(kind: RecallSlot["kind"]): string {
  if (kind === "policy") return "policy";
  if (kind === "memory") return "database";
  return "psychology";
}

/** Collapsible thinking / dual-memory tray — matches Figma Chat Feed. */
export function ReasoningBlock({
  text,
  at,
  live = false,
  label,
  durationSec,
  rulesApplied,
}: {
  text: string;
  at?: string;
  live?: boolean;
  label?: string;
  durationSec?: number;
  rulesApplied?: number;
}) {
  const slots = useMemo(() => parseRecallSlots(text), [text]);
  const [open, setOpen] = useState(live || text.length < 480);
  const ruleCount =
    typeof rulesApplied === "number" && rulesApplied > 0
      ? rulesApplied
      : Math.max(0, slots.filter((s) => s.kind !== "note").length);
  const title =
    label && label !== "Reasoning"
      ? label
      : `Thinking / Reasoning${
          typeof durationSec === "number" && durationSec > 0
            ? ` (${durationSec.toFixed(1)}s)`
            : ""
        } & Dual-Memory Recall`;

  return (
    <div className="chat-reason" role="status">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="chat-reason-head"
        aria-expanded={open}
      >
        <span className="chat-reason-title">
          <span className="material-symbols-outlined chat-reason-chevron">
            {open ? "expand_more" : "chevron_right"}
          </span>
          {title}
          {live ? <TypingDots color="#7d98ff" /> : null}
        </span>
        <span className="chat-reason-badge">
          {ruleCount > 0 ? `${ruleCount} RULES APPLIED` : "RECALL"}
        </span>
      </button>
      {open ? (
        <div className="chat-reason-body">
          {slots.map((slot, i) => (
            <div
              key={`${slot.tag}-${i}`}
              className={`chat-reason-slot is-${slot.kind}`}
            >
              <span className="material-symbols-outlined chat-reason-slot-icon">
                {slotIcon(slot.kind)}
              </span>
              <div className="chat-reason-slot-text">
                <span className="chat-reason-slot-tag">[{slot.tag}]:</span>{" "}
                <span className="chat-reason-slot-body">{slot.body}</span>
              </div>
            </div>
          ))}
          {live ? (
            <div className="chat-reason-slot is-note">
              <StreamingCaret color="#7d98ff" />
            </div>
          ) : null}
        </div>
      ) : null}
      {at && !live ? (
        <div className="chat-reason-foot">
          <span className="chat-msg-time">{at}</span>
        </div>
      ) : null}
    </div>
  );
}
