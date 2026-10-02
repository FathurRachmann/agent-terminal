import { useMemo } from "react";

type Props = {
  detail: string;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Persist tool/command to session allowlist then approve. */
  onAllowAlways?: () => void;
  /** Optional override when interrupt carries a shell command. */
  command?: string | null;
  pid?: string | number | null;
  params?: string | null;
};

function parseApprovalDetail(detail: string): {
  kind: "folder" | "shell" | "tool";
  command: string;
  params: string | null;
} {
  const raw = String(detail || "").trim();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  if (/Allow folder access/i.test(raw)) {
    const pathLine =
      lines.find((l) => !/^Allow folder access/i.test(l)) ||
      raw.replace(/^Allow folder access:?\s*/i, "").trim();
    return {
      kind: "folder",
      command: pathLine || "(folder path)",
      params: "scope: session-local | permission: read+write",
    };
  }

  let command = "";
  let params: string | null = null;
  for (const line of lines) {
    const paramMatch = line.match(/^Parameters?:\s*(.+)$/i);
    if (paramMatch) {
      params = paramMatch[1]!.trim();
      continue;
    }
    if (/^Approve tool:/i.test(line)) continue;
    if (/^```/.test(line)) continue;
    if (!command) {
      command = line.replace(/^\$\s*/, "").replace(/^`|`$/g, "");
    }
  }
  if (!command) {
    command = raw.replace(/^Approve tool:\s*/i, "").trim() || "tool action";
  }
  const kind =
    /^(rm |sudo |chmod |chown |mkfs |dd |curl .*\|)/i.test(command) ||
    /execute|shell|bash/i.test(raw)
      ? "shell"
      : "tool";
  return { command, params, kind };
}

/** In-chat Approve/Deny for tool / folder / shell HITL. */
export function ToolApprovalCard({
  detail,
  busy,
  onApprove,
  onReject,
  onAllowAlways,
  command: commandProp,
  pid,
  params: paramsProp,
}: Props) {
  const parsed = useMemo(() => parseApprovalDetail(detail), [detail]);
  const command = (commandProp || parsed.command).trim();
  const params = paramsProp ?? parsed.params;
  const kind = parsed.kind;
  const pidLabel =
    pid != null && String(pid).trim() ? `PID: ${pid}` : null;

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      /* ignore */
    }
  };

  const tag =
    kind === "folder"
      ? "FOLDER ACCESS REQUEST"
      : kind === "shell"
        ? "DESTRUCTIVE SHELL ACTION"
        : "TOOL APPROVAL REQUIRED";
  const label =
    kind === "folder"
      ? "Requires Explicit Consent"
      : "Requires Explicit Consent";

  return (
    <div className={`chat-tool-approve is-${kind}`}>
      <div className="chat-tool-approve-top">
        <div className="chat-tool-approve-warn">
          <span
            className={
              kind === "folder" ? "chat-access-tag" : "chat-danger-tag"
            }
          >
            {tag}
          </span>
          <span
            className={
              kind === "folder" ? "chat-access-label" : "chat-danger-label"
            }
          >
            {label}
          </span>
        </div>
        {pidLabel ? (
          <span className="chat-tool-approve-pid">{pidLabel}</span>
        ) : null}
      </div>
      <div className="chat-tool-approve-cmd">
        <code
          className={`chat-tool-approve-cmd-text${
            kind === "folder" ? " is-path" : ""
          }`}
        >
          {command}
        </code>
        <button
          type="button"
          className="chat-tool-approve-copy"
          onClick={() => void copyCommand()}
          title="Copy"
          aria-label="Copy"
        >
          <span className="material-symbols-outlined text-[14px]">
            content_copy
          </span>
        </button>
      </div>
      {params ? (
        <div className="chat-tool-approve-params">Parameters: {params}</div>
      ) : null}
      <div className="chat-tool-approve-actions">
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="chat-btn-reject"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="chat-btn-allow"
        >
          {busy ? "Working…" : "Allow Once"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAllowAlways ?? onApprove}
          className="chat-btn-allow-always"
        >
          {busy ? "Working…" : "Allow Always for Session"}
        </button>
      </div>
    </div>
  );
}
