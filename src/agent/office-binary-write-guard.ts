/**
 * Block write_file / edit_file targeting Office/PDF binary packages.
 * Those formats are ZIP/binary — plain-text write_file produces corrupt stubs
 * that the desktop File card cannot open.
 */
import path from "node:path";
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

/** Extensions that must be produced via skill scripts / python-docx / reportlab / etc. */
export const OFFICE_BINARY_EXTENSIONS = new Set([
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".pdf",
  ".odt",
  ".ods",
  ".odp",
]);

const WRITE_TOOLS = new Set(["write_file", "write", "edit_file", "edit"]);

export function toolArgPath(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const p = obj.file_path ?? obj.path ?? obj.filePath;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

export function isOfficeBinaryPath(filePath: string | null | undefined): boolean {
  if (!filePath?.trim()) return false;
  const ext = path.extname(filePath.trim().replace(/\\/g, "/")).toLowerCase();
  return OFFICE_BINARY_EXTENSIONS.has(ext);
}

export function officeBinaryWriteRejectMessage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase() || ".docx";
  const skillHint =
    ext === ".pdf"
      ? "`read_file /skills/productivity/pdf/SKILL.md` then generate via that skill’s scripts / Python libs"
      : ext === ".xlsx" || ext === ".xls"
        ? "`read_file /skills/productivity/xlsx/SKILL.md` then generate via openpyxl / that skill’s scripts"
        : ext === ".pptx" || ext === ".ppt"
          ? "`read_file /skills/productivity/powerpoint/SKILL.md` then generate via that skill’s scripts"
          : "`read_file /skills/productivity/docx/SKILL.md` then generate via python-docx / that skill’s scripts (npm `docx` if available)";
  return [
    `Error: refuse write_file/edit_file for binary Office/PDF path (${ext}).`,
    `Plain text into ${path.basename(filePath)} creates a corrupt stub — Open will fail.`,
    `Instead: ${skillHint}.`,
    `Save the real binary under tmp/… (e.g. tmp/bots/Bill_of_Delivery_JIRA.docx) via execute + Python, then put that path in backticks.`,
  ].join(" ");
}

/** Returns an error ToolMessage when the call targets a binary office path. */
export function rejectOfficeBinaryWrite(toolCall: {
  name: string;
  args?: unknown;
  id?: string | null;
}): ToolMessage | null {
  if (!WRITE_TOOLS.has(toolCall.name)) return null;
  const filePath = toolArgPath(toolCall.args);
  if (!isOfficeBinaryPath(filePath)) return null;
  return new ToolMessage({
    content: officeBinaryWriteRejectMessage(filePath!),
    tool_call_id: toolCall.id ?? "",
    name: toolCall.name,
    status: "error",
  });
}

export function createOfficeBinaryWriteGuardMiddleware() {
  return createMiddleware({
    name: "OfficeBinaryWriteGuard",
    wrapToolCall(request, handler) {
      const rejected = rejectOfficeBinaryWrite(request.toolCall);
      if (rejected) return rejected;
      return handler(request);
    },
  });
}
