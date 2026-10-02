/**
 * Resolve approve/reject for a tool interrupt under Run Modes + classifier.
 */
import {
  buildApprovalDecisions,
  extractInterruptActionNames,
  isFolderAccessInterrupt,
  isPlanApprovalInterrupt,
} from "./interrupt-utils.js";
import {
  isRunModeGatedTool,
  matchesToolAllowlist,
  type RunMode,
} from "./run-modes.js";
import { classifyToolCall, type ClassifierVerdict } from "./tool-classifier.js";

export type RunModeApprovalDecision = {
  decisions: Array<{ type: "approve" | "reject" }>;
  /** How the decision was made (for UI/status). */
  source:
    | "explicit"
    | "run-everything"
    | "allowlist"
    | "classifier"
    | "hitl"
    | "privacy-off";
  verdict?: ClassifierVerdict;
};

function firstGatedAction(payload: unknown): {
  name: string;
  args: unknown;
} | null {
  const names = extractInterruptActionNames(payload);
  const gated = names.find((n) => isRunModeGatedTool(n) || n.startsWith("mcp_"));
  if (!gated) {
    // config edit interrupt
    const configWrite = names.find(
      (n) => n === "edit_file" || n === "write_file" || n === "edit" || n === "write",
    );
    if (!configWrite) return null;
    return { name: configWrite, args: extractArgsForName(payload, configWrite) };
  }
  return { name: gated, args: extractArgsForName(payload, gated) };
}

function extractArgsForName(payload: unknown, toolName: string): unknown {
  let found: unknown;
  const visit = (node: unknown) => {
    if (!node || found !== undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.name === toolName) {
      found = rec.args ?? rec.arguments ?? {};
      return;
    }
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return found ?? {};
}

/**
 * Auto-resolve interrupt when Run Mode + classifier allow it.
 * Returns null when the UI must ask the user (or plan/folder).
 */
export async function tryAutoResolveRunModeInterrupt(options: {
  payload: unknown;
  runMode: RunMode;
  allowlist: readonly string[];
  chatMode?: string;
  /** Legacy CLI --yes / settings alias for run-everything */
  autoApprove?: boolean;
  allowInstructions?: readonly string[];
  blockInstructions?: readonly string[];
  mcpAllowlist?: readonly string[];
  /**
   * Live Privacy toggle. When false, folder grants auto-approve
   * (sandbox already has whole-machine roots). When true/omitted, folder HITL.
   */
  privacyOn?: boolean;
}): Promise<RunModeApprovalDecision | null> {
  const {
    payload,
    runMode,
    allowlist,
    chatMode,
    autoApprove,
    allowInstructions,
    blockInstructions,
    mcpAllowlist,
    privacyOn,
  } = options;

  if (isPlanApprovalInterrupt(payload)) {
    return null;
  }

  if (isFolderAccessInterrupt(payload)) {
    if (privacyOn === false) {
      return {
        decisions: buildApprovalDecisions("approve", payload),
        source: "privacy-off",
      };
    }
    return null;
  }

  const effectiveMode: RunMode =
    autoApprove && runMode !== "allowlist" ? "run-everything" : runMode;

  if (effectiveMode === "run-everything") {
    return {
      decisions: buildApprovalDecisions("approve", payload),
      source: "run-everything",
    };
  }

  const action = firstGatedAction(payload);
  if (!action) {
    // Unknown interrupt — ask user
    return null;
  }

  if (matchesToolAllowlist(action.name, action.args, allowlist)) {
    return {
      decisions: buildApprovalDecisions("approve", payload),
      source: "allowlist",
    };
  }

  if (effectiveMode === "allowlist") {
    return null; // HITL
  }

  // auto-review
  const verdict = await classifyToolCall({
    toolName: action.name,
    args: action.args,
    runMode: effectiveMode,
    allowlist,
    chatMode,
    allowInstructions,
    blockInstructions,
    mcpAllowlist,
  });
  if (verdict === "allow") {
    return {
      decisions: buildApprovalDecisions("approve", payload),
      source: "classifier",
      verdict,
    };
  }
  if (verdict === "deny") {
    return {
      decisions: buildApprovalDecisions("reject", payload),
      source: "classifier",
      verdict,
    };
  }
  return null; // ask → HITL
}
