/**
 * Cursor-style: workspace edits auto-apply; config / secret paths need HITL.
 */
import path from "node:path";
import { createMiddleware } from "langchain";
import { interrupt } from "@langchain/langgraph";
import { ToolMessage } from "@langchain/core/messages";
import { toolArgPath } from "./office-binary-write-guard.js";
import type { RunMode } from "./run-modes.js";

const WRITE_TOOLS = new Set(["write_file", "write", "edit_file", "edit"]);

const CONFIG_BASENAME_RE =
  /^(?:\.env(?:\..+)?|credentials(?:\..+)?|\.npmrc|\.pypirc|\.netrc|auth\.json|secrets?(?:\..+)?|id_rsa|id_ed25519|\.pgpass)$/i;

const CONFIG_PATH_RE =
  /(?:^|\/)(?:\.env(?:\..+)?|credentials[^/]*|[^/]*secret[^/]*|mcp\.json|settings\.json|\.agent\/mcp\.json|appsettings\.[^/]+\.json)$/i;

export function isConfigSensitivePath(
  filePath: string | null | undefined,
): boolean {
  if (!filePath?.trim()) return false;
  const normalized = filePath.trim().replace(/\\/g, "/");
  const base = path.basename(normalized);
  if (CONFIG_BASENAME_RE.test(base)) return true;
  if (CONFIG_PATH_RE.test(normalized)) return true;
  if (normalized.includes("/.ssh/") || normalized.endsWith("/.ssh")) return true;
  if (normalized.includes("/.aws/") && /\.(json|ini|csv)$/i.test(base)) {
    return true;
  }
  return false;
}

export function configEditInterruptPayload(toolCall: {
  name: string;
  args?: unknown;
  id?: string | null;
}): Record<string, unknown> {
  return {
    actionRequests: [
      {
        name: toolCall.name,
        args: toolCall.args ?? {},
        id: toolCall.id ?? undefined,
        reason: "config_sensitive_path",
      },
    ],
  };
}

function resumeApproved(resume: unknown): boolean {
  if (!resume || typeof resume !== "object") return false;
  const decisions = (resume as { decisions?: Array<{ type?: string }> })
    .decisions;
  if (!Array.isArray(decisions)) return false;
  return decisions.some((d) => d?.type === "approve");
}

/**
 * For config/secret paths: HITL via langgraph interrupt (except run-everything).
 */
export function createConfigEditGuardMiddleware(options: {
  getRunMode: () => RunMode;
}) {
  return createMiddleware({
    name: "ConfigEditGuard",
    wrapToolCall(request, handler) {
      const toolCall = request.toolCall;
      if (!WRITE_TOOLS.has(toolCall.name)) return handler(request);
      const filePath = toolArgPath(toolCall.args);
      if (!isConfigSensitivePath(filePath)) return handler(request);
      if (options.getRunMode() === "run-everything") return handler(request);

      const resume = interrupt(configEditInterruptPayload(toolCall));
      if (!resumeApproved(resume)) {
        return new ToolMessage({
          content: `Error: write/edit of config/sensitive path blocked (${filePath}). User rejected approval.`,
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          status: "error",
        });
      }
      return handler(request);
    },
  });
}
