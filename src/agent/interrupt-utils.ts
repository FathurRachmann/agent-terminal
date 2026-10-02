export function countInterruptActionRequests(payload: unknown): number {
  let count = 0;
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.actionRequests)) {
      count += rec.actionRequests.length;
    }
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return count > 0 ? count : 1;
}

export function buildApprovalDecisions(
  type: "approve" | "reject",
  payload?: unknown,
): Array<{ type: "approve" | "reject" }> {
  const count = payload ? countInterruptActionRequests(payload) : 1;
  return Array.from({ length: Math.max(1, count) }, () => ({ type }));
}

/**
 * Expand a single approve/reject intent to one decision per hanging actionRequest.
 * LangGraph HITL rejects resume when counts don't match.
 */
export function normalizeApprovalDecision(
  decision: { decisions: Array<{ type: "approve" | "reject" }> },
  payload: unknown,
): { decisions: Array<{ type: "approve" | "reject" }> } {
  const needed = countInterruptActionRequests(payload);
  const current = Array.isArray(decision?.decisions) ? decision.decisions : [];
  if (current.length === needed && needed > 0) {
    return { decisions: current };
  }
  const type = current.some((d) => d?.type === "approve") ? "approve" : "reject";
  return { decisions: buildApprovalDecisions(type, payload) };
}

/** Shared helpers for Deep Agents / LangGraph interrupt payloads. */

export function extractInterruptActionNames(payload: unknown): string[] {
  const names: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.name === "string") names.push(rec.name);
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return [...new Set(names)];
}

export function isPlanApprovalInterrupt(payload: unknown): boolean {
  return extractInterruptActionNames(payload).includes("task_todos");
}

export function isFolderAccessInterrupt(payload: unknown): boolean {
  return extractInterruptActionNames(payload).includes("request_folder_access");
}

/** True when HITL must never be silently auto-approved (plan / folder-when-privacy-on / config). */
export function requiresExplicitApproval(
  payload: unknown,
  options?: { privacyOn?: boolean },
): boolean {
  if (isPlanApprovalInterrupt(payload)) {
    return true;
  }
  if (isFolderAccessInterrupt(payload)) {
    // Privacy OFF = whole-machine access already granted — no folder HITL.
    // Omitted privacyOn → require approval (safe default).
    return options?.privacyOn !== false;
  }
  return isConfigEditInterrupt(payload);
}

/** Config/sensitive path write interrupt from ConfigEditGuard middleware. */
export function isConfigEditInterrupt(payload: unknown): boolean {
  let found = false;
  const visit = (node: unknown) => {
    if (!node || found) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.reason === "config_sensitive_path") {
      found = true;
      return;
    }
    if (Array.isArray(rec.actionRequests)) {
      for (const ar of rec.actionRequests) {
        if (
          ar &&
          typeof ar === "object" &&
          (ar as { reason?: string }).reason === "config_sensitive_path"
        ) {
          found = true;
          return;
        }
      }
    }
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return found;
}

/**
 * Pull folderPath from a request_folder_access interrupt payload.
 */
export function extractFolderAccessPath(payload: unknown): string | null {
  let found: string | null = null;
  const visit = (node: unknown) => {
    if (!node || found) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.name === "request_folder_access") {
      const args = rec.args;
      if (args && typeof args === "object") {
        const folderPath = (args as Record<string, unknown>).folderPath;
        if (typeof folderPath === "string" && folderPath.trim()) {
          found = folderPath.trim();
          return;
        }
      }
    }
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return found;
}

/** Pull shell command + args from a tool HITL interrupt when present. */
export function extractToolApprovalMeta(payload: unknown): {
  toolName: string | null;
  command: string | null;
  params: string | null;
} {
  let toolName: string | null = null;
  let command: string | null = null;
  let params: string | null = null;
  const visit = (node: unknown) => {
    if (!node || command) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const args =
      rec.args && typeof rec.args === "object"
        ? (rec.args as Record<string, unknown>)
        : rec.arguments && typeof rec.arguments === "object"
          ? (rec.arguments as Record<string, unknown>)
          : null;
    if (name && args) {
      toolName = toolName || name;
      const cmd = String(args.command ?? args.cmd ?? "").trim();
      if (cmd) {
        command = cmd;
        const target = String(args.path ?? args.target ?? args.cwd ?? "").trim();
        const scope = String(args.scope ?? "").trim();
        const bits = [
          target ? `target: ${target}` : "",
          scope ? `scope: ${scope}` : "",
        ].filter(Boolean);
        params = bits.length ? bits.join(" | ") : null;
        return;
      }
    }
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return { toolName, command, params };
}

/** Short label for tool-approval UI (folder grant or generic tool HITL). */
export function formatToolApprovalDetail(payload: unknown): string {
  if (isFolderAccessInterrupt(payload)) {
    const folder = extractFolderAccessPath(payload);
    return folder
      ? `Allow folder access:\n${folder}`
      : "Allow folder access outside the current workspace";
  }
  const meta = extractToolApprovalMeta(payload);
  if (meta.command) {
    const lines = [meta.command];
    if (meta.params) lines.push(`Parameters: ${meta.params}`);
    return lines.join("\n");
  }
  const names = extractInterruptActionNames(payload);
  if (names.length) {
    return `Approve tool: ${names.join(", ")}`;
  }
  return "Tool approval required";
}
