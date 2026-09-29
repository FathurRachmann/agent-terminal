import React, { useEffect, useState } from "react";
import {
  resolveArtifactsFromTool,
  pickAutoFocusArtifact,
  shouldAutoFocusCanvas,
  type ActivityArtifact,
} from "./activity-artifact.js";
import {
  detectTestPassSummary,
  extractDiffFromToolOutput,
  summarizePatchStats,
} from "./tool-diff.js";

export type AgentPhase =
  | "boot"
  | "thinking"
  | "reasoning"
  | "tool"
  | "pty"
  | "waiting_approval"
  | "reflecting"
  | "done"
  | "error";

export type AgentUiEvent =
  | { type: "status"; phase: AgentPhase; detail: string }
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; output: string }
  | { type: "interrupt"; payload: unknown }
  | { type: "context_compacted"; detail: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  | { type: "reflection"; memoryIds: string[] }
  | { type: "warning"; message: string }
  | { type: "pty"; text: string }
  | {
      type: "continue_available";
      reason: "model_unavailable" | "self_heal";
      prompt: string;
      suggestedModel?: string | null;
      notice?: string;
    };

function shortJson(value: unknown, max = 280): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value, null, 0);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(value);
  }
}

export function phaseColor(phase: AgentPhase): string {
  switch (phase) {
    case "thinking":
      return "#7d98ff";
    case "reasoning":
      return "#7d98ff";
    case "tool":
    case "pty":
      return "#7d98ff";
    case "waiting_approval":
      return "#ee7d77";
    case "reflecting":
      return "#7d98ff";
    case "error":
      return "#ee7d77";
    case "done":
      return "#7d98ff";
    default:
      return "#747676";
  }
}

function eventTitle(ev: AgentUiEvent): string {
  switch (ev.type) {
    case "status":
      return `status · ${ev.phase}`;
    case "reasoning":
      return "reasoning";
    case "tool_start":
      return `tool start · ${ev.name}`;
    case "tool_end":
      return `tool end · ${ev.name}`;
    case "interrupt":
      return "interrupt / HITL";
    case "context_compacted":
      return "context compacted";
    case "reflection":
      return "reflection";
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "done":
      return "done";
    case "pty":
      return "pty";
    case "continue_available":
      return "continue available";
    default:
      return "event";
  }
}

export function eventBody(ev: AgentUiEvent): string {
  switch (ev.type) {
    case "status":
      return safeStr(ev.detail);
    case "reasoning":
    case "token":
      return safeStr(ev.text);
    case "tool_start":
      return shortJson(ev.input, 600);
    case "tool_end":
      return truncate(safeStr(ev.output), 800);
    case "interrupt":
      return shortJson(ev.payload, 600);
    case "context_compacted":
      return safeStr(ev.detail);
    case "reflection":
      return `${Array.isArray(ev.memoryIds) ? ev.memoryIds.length : 0} memories stored`;
    case "warning":
    case "error":
      return safeStr(ev.message, "(no details)");
    case "done":
      return truncate(safeStr(ev.text), 400);
    case "pty":
      return truncate(safeStr(ev.text), 400);
    case "continue_available":
      return truncate(
        safeStr(ev.notice) ||
          (ev.reason === "self_heal"
            ? "Self-heal finished — continue available"
            : "Model unavailable — continue available"),
        400,
      );
    default:
      return "";
  }
}

function safeStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asRecord(input: unknown): Record<string, unknown> {
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

function basenamePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function compactActivityLabel(ev: AgentUiEvent): {
  icon: string;
  text: string;
  color: string;
} {
  if (ev.type === "tool_start" || ev.type === "tool_end") {
    const args = asRecord(ev.type === "tool_start" ? ev.input : {});
    // tool_end has no input — try parse path from output header if present
    const name = ev.name;
    const path =
      String(args.file_path ?? args.path ?? args.filename ?? args.file ?? "") ||
      "";
    const file = path ? basenamePath(path) : "";
    const offset = Number(args.offset ?? args.start_line ?? NaN);
    const limit = Number(args.limit ?? args.line_limit ?? NaN);
    const range =
      Number.isFinite(offset) && Number.isFinite(limit)
        ? ` L${offset}-${offset + Math.max(limit, 1) - 1}`
        : Number.isFinite(offset)
          ? ` L${offset}+`
          : "";

    if (name === "read_file" || name === "read") {
      const label = file || path || "file";
      return {
        icon: "📄",
        text: `Read ${label}${range}`,
        color: "#8b949e",
      };
    }
    if (name === "write_file" || name === "write") {
      return {
        icon: "✏️",
        text: `Wrote ${file || path || "file"}`,
        color: "#8b949e",
      };
    }
    if (name === "edit_file" || name === "edit" || name === "str_replace") {
      return {
        icon: "✏️",
        text: `Edited ${file || path || "file"}`,
        color: "#8b949e",
      };
    }
    if (name === "ls" || name === "list_dir") {
      return { icon: "📂", text: `Listed ${path || "/"}`, color: "#8b949e" };
    }
    if (name === "grep" || name === "search") {
      const q = String(args.pattern ?? args.query ?? "");
      return {
        icon: "🔍",
        text: q
          ? `Searched “${q.slice(0, 40)}${q.length > 40 ? "…" : ""}”`
          : "Searched files",
        color: "#8b949e",
      };
    }
    if (name === "glob") {
      const q = String(args.pattern ?? args.glob ?? "");
      return {
        icon: "🔍",
        text: q ? `Glob ${q}` : "Glob files",
        color: "#8b949e",
      };
    }
    if (name === "execute" || name === "shell" || name === "bash") {
      const cmd = String(args.command ?? args.cmd ?? "").trim();
      return {
        icon: "⌘",
        text: cmd
          ? `Ran ${cmd.slice(0, 48)}${cmd.length > 48 ? "…" : ""}`
          : "Ran shell",
        color: "#8b949e",
      };
    }
    if (name.startsWith("task_")) {
      return {
        icon: "☑",
        text: `Task · ${name.replace(/^task_/, "")}`,
        color: "#8b949e",
      };
    }
    if (name.includes("desktop")) {
      return { icon: "🖥", text: `Desktop · ${name}`, color: "#8b949e" };
    }
    return {
      icon: "⚙",
      text: ev.type === "tool_end" ? `Finished ${name}` : `Used ${name}`,
      color: "#8b949e",
    };
  }

  if (ev.type === "status") {
    if (ev.phase === "waiting_approval") {
      return { icon: "⏸", text: "Waiting for approval", color: "#e3b341" };
    }
    if (ev.phase === "reflecting") {
      return { icon: "🧠", text: "Updating memories…", color: "#79b8ff" };
    }
    if (ev.phase === "reasoning") {
      return { icon: "💭", text: "Reasoning…", color: "#c3a6ff" };
    }
    return { icon: "…", text: ev.detail || ev.phase, color: "#8b949e" };
  }

  if (ev.type === "reasoning") {
    return { icon: "💭", text: "Reasoning…", color: "#c3a6ff" };
  }
  if (ev.type === "warning") {
    return {
      icon: "⚠",
      text: truncate(safeStr(ev.message, "Warning"), 80),
      color: "#e3b341",
    };
  }
  if (ev.type === "reflection") {
    const n = Array.isArray(ev.memoryIds) ? ev.memoryIds.length : 0;
    return {
      icon: "🧠",
      text:
        n > 0
          ? `Success updated memories (${n})`
          : "Success updated memories",
      color: "#79b8ff",
    };
  }
  if (ev.type === "context_compacted") {
    return { icon: "📦", text: "Context compacted", color: "#8b949e" };
  }
  if (ev.type === "error") {
    return {
      icon: "!",
      text: truncate(safeStr(ev.message, "Error"), 80),
      color: "#ff7b72",
    };
  }
  return { icon: "•", text: eventTitle(ev), color: "#8b949e" };
}

/** Whether this event should appear as a compact chip in the main chat. */
export function shouldMirrorInChat(ev: AgentUiEvent): boolean {
  // tool chips are added on tool_end (with start input) in App.tsx
  if (ev.type === "warning" || ev.type === "reflection") return true;
  if (ev.type === "context_compacted") return true;
  if (ev.type === "status") {
    // Never mirror reflecting — memory update is background; show success chip only.
    return ev.phase === "waiting_approval" || ev.phase === "error";
  }
  return false;
}

/** One-liner in chat — click to expand input/output detail. */
export function CompactActivityChip({
  event,
  input,
  output,
}: {
  event: AgentUiEvent;
  /** Tool args captured at start (for tool_end rows). */
  input?: unknown;
  output?: string;
}) {
  const [open, setOpen] = useState(false);
  const args = asRecord(
    input ?? (event.type === "tool_start" ? event.input : {}),
  );
  const out =
    output ?? (event.type === "tool_end" ? safeStr(event.output) : "");
  const name =
    event.type === "tool_start" || event.type === "tool_end" ? event.name : "";

  const running = event.type === "tool_start";
  const done =
    event.type === "tool_end" ||
    event.type === "reflection" ||
    event.type === "context_compacted" ||
    event.type === "done";
  const err = event.type === "error" || event.type === "warning";
  const isMemory =
    event.type === "reflection" || event.type === "context_compacted";

  let action = "";
  let result = "";
  if (isMemory) {
    action = compactActivityLabel(event).text;
    result = event.type === "reflection" ? "stored" : "ok";
  } else if (name === "execute" || name === "shell" || name === "bash") {
    const cmd = String(args.command ?? args.cmd ?? "").trim();
    action = cmd ? `execute: \`${truncate(cmd, 56)}\`` : "execute";
    result = detectTestPassSummary(out) || (done ? "done" : "");
  } else if (
    name === "edit_file" ||
    name === "edit" ||
    name === "str_replace" ||
    name === "write_file" ||
    name === "write"
  ) {
    const path = String(
      args.file_path ?? args.path ?? args.filename ?? args.file ?? "",
    );
    const file = path ? basenamePath(path) : path || "file";
    const toolLabel =
      name === "write_file" || name === "write" ? "write_file" : "edit_file";
    action = `${toolLabel}: \`${truncate(file || path, 48)}\``;
    result = summarizePatchStats(out) || (done ? "patched" : "");
  } else if (name) {
    const label = compactActivityLabel({
      type: "tool_start",
      name,
      input: args,
    });
    action = `${name}: ${label.text.replace(/^(Read|Wrote|Edited|Ran|Used|Finished)\s+/i, "")}`;
    result = done ? "done" : "";
  } else {
    action = compactActivityLabel(event).text;
  }

  const richDetail = formatEventDetail(
    event.type === "tool_start"
      ? event
      : name
        ? ({ type: "tool_start", name, input: args } as AgentUiEvent)
        : event,
    done
      ? ({ type: "tool_end", name, output: out } as Extract<
          AgentUiEvent,
          { type: "tool_end" }
        >)
      : undefined,
  );
  const expandable = richDetail.trim().length > 0;
  const diff = done ? extractDiffFromToolOutput(out) : null;
  const badge = err ? "ERR" : done ? "OK" : running ? "RUNNING" : "•";
  const badgeClass = err
    ? "is-err"
    : done
      ? "is-ok"
      : running
        ? "is-run"
        : "is-ok";
  const resultMuted =
    running || (!!result && !/^Passed|^Failed/i.test(result));

  return (
    <div className="chat-tool-block">
      <div className="chat-tool-row">
        <button
          type="button"
          onClick={() => expandable && setOpen((v) => !v)}
          aria-expanded={expandable ? open : undefined}
          className={`chat-tool-left border-0 bg-transparent p-0 text-left ${expandable ? "cursor-pointer" : "cursor-default"}`}
          title={expandable ? (open ? "Collapse" : "Expand details") : undefined}
        >
          <span className={`chat-tool-badge ${badgeClass}`}>{badge}</span>
          <span className="chat-tool-action">{action}</span>
        </button>
        {result ? (
          <span className={`chat-tool-right${resultMuted ? " is-muted" : ""}`}>
            {result}
          </span>
        ) : null}
      </div>
      {diff ? (
        <div className="chat-diff">
          <div className="chat-diff-head">
            <span className="chat-diff-meta">DIFF CHUNK: {diff.header}</span>
            <span className="chat-diff-lang">SYNTAX: {diff.language}</span>
          </div>
          <pre className="chat-diff-body">
            {diff.lines.map((line, i) => (
              <div key={i} className={`chat-diff-line is-${line.kind}`}>
                {line.text}
              </div>
            ))}
          </pre>
        </div>
      ) : null}
      {open && expandable ? <DetailBlock text={richDetail} /> : null}
    </div>
  );
}

/** Summary label for a finished batch of process chips. */
export function summarizeTraceGroup(events: AgentUiEvent[]): {
  icon: string;
  text: string;
  color: string;
} {
  if (events.length === 0) {
    return { icon: "•", text: "No steps", color: "#8b949e" };
  }
  if (events.length === 1) {
    return compactActivityLabel(events[0]!);
  }
  const labels = events.map((e) => compactActivityLabel(e));
  const first = labels[0]!;
  const sameText = labels.every((l) => l.text === first.text);
  if (sameText) {
    return {
      icon: first.icon,
      text: `${first.text} ×${events.length}`,
      color: "#8b949e",
    };
  }
  return {
    icon: "⌘",
    text: `${events.length} steps`,
    color: "#8b949e",
  };
}

/**
 * Live turn: show each process chip expanded.
 * After the turn finishes: collapse into one summary row (click to expand).
 */
export function CollapsibleTraceGroup({
  entries,
  live = false,
}: {
  entries: Array<{
    id: string;
    event: AgentUiEvent;
    input?: unknown;
    output?: string;
  }>;
  live?: boolean;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  if (entries.length === 0) return null;

  const isMemoryOnly = entries.every(
    (e) =>
      e.event.type === "reflection" || e.event.type === "context_compacted",
  );
  const doneCount = entries.filter(
    (e) =>
      e.event.type === "tool_end" ||
      e.event.type === "reflection" ||
      e.event.type === "context_compacted" ||
      e.event.type === "done" ||
      e.event.type === "warning",
  ).length;
  const title = isMemoryOnly
    ? `MEMORY UPDATE (${entries.length})`
    : `TOOL INVOCATIONS (${entries.length} EXECUTED)`;
  const status = live
    ? "RUNNING…"
    : doneCount >= entries.length
      ? isMemoryOnly
        ? "STORED"
        : "ALL INTEGRITY CHECKS GREEN"
      : `${doneCount}/${entries.length} COMPLETE`;

  return (
    <div className={`chat-tools${isMemoryOnly ? " is-memory" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="chat-tools-head"
        title={open ? "Collapse" : "Expand"}
      >
        <span className="chat-tools-title">{title}</span>
        <span className="chat-tools-status">{status}</span>
      </button>
      {(open || live) && (
        <div className="chat-tools-list">
          {entries.map((row) => (
            <CompactActivityChip
              key={row.id}
              event={row.event}
              input={row.input}
              output={
                row.output ??
                (row.event.type === "tool_end" ? row.event.output : undefined)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export type TraceChatItem = {
  id: string;
  kind: "trace";
  event: AgentUiEvent;
  at: string;
};

export type ChatSegmentItem = { id: string; kind: string };

export type ChatTraceSegment<T extends TraceChatItem> = {
  type: "traces";
  items: T[];
  live: boolean;
};

export type ChatSingleSegment<T extends ChatSegmentItem> = {
  type: "single";
  item: T;
};

/** Group consecutive process chips; mark the active turn's trailing group as live. */
export function buildChatSegments<T extends ChatSegmentItem>(
  items: T[],
  loading: boolean,
): Array<ChatSingleSegment<T> | ChatTraceSegment<Extract<T, TraceChatItem>>> {
  let lastUserIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]!.kind === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const out: Array<
    ChatSingleSegment<T> | ChatTraceSegment<Extract<T, TraceChatItem>>
  > = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    if (item.kind === "trace") {
      const group: Array<Extract<T, TraceChatItem>> = [];
      const start = i;
      while (i < items.length && items[i]!.kind === "trace") {
        group.push(items[i] as Extract<T, TraceChatItem>);
        i += 1;
      }
      const hasAssistantAfter = items
        .slice(i)
        .some((x) => x.kind === "assistant");
      const live = loading && start > lastUserIndex && !hasAssistantAfter;
      out.push({ type: "traces", items: group, live });
      continue;
    }
    out.push({ type: "single", item });
    i += 1;
  }
  return out;
}

function prettyJson(value: unknown, max = 4000): string {
  try {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        const s = JSON.stringify(parsed, null, 2);
        return s.length > max ? `${s.slice(0, max)}…` : s;
      } catch {
        return value.length > max ? `${value.slice(0, max)}…` : value;
      }
    }
    const s = JSON.stringify(value, null, 2);
    if (s == null) return String(value);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(value);
  }
}

/** Rich detail text for expand panels (Input / Output / payload). */
export function formatEventDetail(
  event: AgentUiEvent,
  endEvent?: Extract<AgentUiEvent, { type: "tool_end" }>,
): string {
  if (event.type === "tool_start") {
    const parts = [`Input:\n${prettyJson(event.input)}`];
    if (endEvent) {
      parts.push(`\nOutput:\n${prettyJson(endEvent.output)}`);
    }
    return parts.join("\n");
  }
  if (event.type === "tool_end") {
    return `Output:\n${prettyJson(event.output)}`;
  }
  if (event.type === "interrupt") {
    return `Payload:\n${prettyJson(event.payload)}`;
  }
  if (event.type === "status") {
    return `Phase: ${event.phase}\n${event.detail}`;
  }
  if (event.type === "reasoning" || event.type === "token" || event.type === "done") {
    const text = event.type === "done" ? event.text : event.text;
    return truncate(safeStr(text), 4000);
  }
  if (event.type === "warning" || event.type === "error") {
    return safeStr(event.message, "(no details)");
  }
  if (event.type === "reflection") {
    const ids = Array.isArray(event.memoryIds) ? event.memoryIds : [];
    return `Memory IDs:\n${ids.join("\n") || "(none)"}`;
  }
  if (event.type === "context_compacted") {
    return safeStr(event.detail);
  }
  return eventBody(event);
}

function DetailBlock({ text }: { text: string }) {
  return (
    <pre className="mt-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-1 px-2.5 py-2 font-mono text-[9.5px] leading-snug text-fg">
      {text}
    </pre>
  );
}

export type ActivityEntry = {
  id: string;
  event: AgentUiEvent;
  at: string;
  endEvent?: Extract<AgentUiEvent, { type: "tool_end" }>;
};

/** Merge tool_start + matching tool_end into one expandable row. */
export function groupActivityEntries(
  rows: Array<{ id: string; event: AgentUiEvent; at: string }>,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const pending = new Map<string, number>();

  for (const row of rows) {
    const ev = row.event;
    if (ev.type === "tool_start") {
      pending.set(ev.name, out.length);
      out.push({ id: row.id, event: ev, at: row.at });
      continue;
    }
    if (ev.type === "tool_end") {
      const idx = pending.get(ev.name);
      if (idx != null && out[idx] && !out[idx]!.endEvent) {
        out[idx] = { ...out[idx]!, endEvent: ev, at: row.at };
        pending.delete(ev.name);
        continue;
      }
      out.push({ id: row.id, event: ev, at: row.at });
      continue;
    }
    out.push({ id: row.id, event: ev, at: row.at });
  }
  return out;
}

/** Activity panel row: summary always, detail on expand. */
export function TraceCard({
  event,
  at,
  endEvent,
  onOpenCanvas,
}: {
  event: AgentUiEvent;
  at: string;
  endEvent?: Extract<AgentUiEvent, { type: "tool_end" }>;
  onOpenCanvas?: (artifact: ActivityArtifact) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = compactActivityLabel(event);
  const accent =
    event.type === "status"
      ? phaseColor(event.phase)
      : event.type === "reasoning"
        ? "#c3a6ff"
        : event.type === "tool_start" || event.type === "tool_end"
          ? "#5dcaa5"
          : event.type === "error"
            ? "#ff7b72"
            : event.type === "warning"
              ? "#e3b341"
              : "#8b98a8";
  const detail = formatEventDetail(event, endEvent);
  const expandable = detail.trim().length > 0;

  const artifact =
    event.type === "tool_start"
      ? (() => {
          const arts = resolveArtifactsFromTool({
            name: event.name,
            input: event.input,
            output: endEvent?.output,
          });
          return pickAutoFocusArtifact(arts) ?? arts.find((a) => a.kind !== "code") ?? arts[0] ?? null;
        })()
      : event.type === "tool_end"
        ? (() => {
            const arts = resolveArtifactsFromTool({
              name: event.name,
              input: {},
              output: event.output,
            });
            return pickAutoFocusArtifact(arts) ?? arts[0] ?? null;
          })()
        : null;

  return (
    <div
      className="rounded-lg border bg-surface-2 px-2 py-1.5"
      style={{
        borderColor: `${accent}33`,
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        className={`flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0 text-left ${expandable ? "cursor-pointer" : "cursor-default"}`}
      >
        <span
          className="inline-flex min-w-0 items-center gap-1.5 text-[10px]"
          style={{ color: summary.color }}
        >
          <span className="w-2.5 shrink-0 text-muted">
            {expandable ? (open ? "▾" : "▸") : "·"}
          </span>
          <span>{summary.icon}</span>
          <span className="truncate font-mono">{summary.text}</span>
        </span>
        <span className="shrink-0 text-[9px] text-muted">{at}</span>
      </button>
      {artifact && onOpenCanvas && (
        <button
          type="button"
          className="mt-1 rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[9px] text-accent hover:bg-surface-2"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCanvas(artifact);
          }}
        >
          Open {shouldAutoFocusCanvas(artifact.kind) ? "result" : "canvas"} ·{" "}
          {artifact.basename}
        </button>
      )}
      {open && expandable && <DetailBlock text={detail} />}
    </div>
  );
}
