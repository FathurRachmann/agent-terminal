/**
 * After write_file: confirm the path exists on disk under the sandbox.
 * Deep Agents / virtual backends sometimes report success while nothing
 * landed under tmp/ — desktop Open then fails with "File not found".
 *
 * Also refuse empty laporan/report skeletons (JSON templates with blank
 * fields) and title-only stubs — models often dump those instead of a PDF.
 */
import fs from "node:fs";
import path from "node:path";
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { resolveWorkingAwarePath } from "./working-paths.js";

const WRITE_TOOLS = new Set(["write_file", "write"]);
const SHELL_TOOLS = new Set(["execute", "shell", "bash"]);

export function toolArgPath(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const p = obj.file_path ?? obj.path ?? obj.filePath;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

export function toolArgContent(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const c = obj.content ?? obj.text ?? obj.file_content;
  return typeof c === "string" ? c : null;
}

export function toolArgCommand(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const c = obj.command ?? obj.cmd ?? obj.code ?? obj.script;
  return typeof c === "string" && c.trim() ? c : null;
}

export function resolveWriteCandidatePaths(
  artifactHome: string,
  workspaceRoot: string,
  filePath: string,
): string[] {
  const trimmed = filePath.trim();
  const out: string[] = [];
  const push = (p: string) => {
    const abs = path.resolve(p);
    if (!out.includes(abs)) out.push(abs);
  };
  if (path.isAbsolute(trimmed)) {
    push(trimmed);
  } else {
    push(resolveWorkingAwarePath(artifactHome, workspaceRoot, trimmed));
    push(path.resolve(workspaceRoot, trimmed));
    push(path.resolve(artifactHome, trimmed));
  }
  return out;
}

/** True when at least one candidate exists as a non-empty file. */
export function findPersistedWrite(
  candidates: string[],
): { abs: string; size: number } | null {
  for (const abs of candidates) {
    try {
      if (!fs.existsSync(abs)) continue;
      const st = fs.statSync(abs);
      if (st.isFile() && st.size > 0) return { abs, size: st.size };
    } catch {
      /* try next */
    }
  }
  return null;
}

export function isReportLikePath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return /laporan|report|bod|quotation|invoice|proposal|bill_of_delivery/.test(
    base,
  );
}

/** Detect title-only stub used as fake "laporan" deliverable. */
export function isTinyStubDeliverable(
  filePath: string,
  content: string | null,
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (![".md", ".txt", ".markdown", ".json"].includes(ext)) return false;
  if (
    !isReportLikePath(filePath) &&
    !/laporan|report/.test((content || "").toLowerCase())
  ) {
    return false;
  }
  const text = (content || "").trim();
  return text.length > 0 && text.length < 80 && text.split(/\n/).length <= 2;
}

/**
 * Empty JSON laporan template (the classic bad bot output):
 * {"executive_summary":"","project_progress":[],"financial_performance":{...}}
 */
export function isEmptyReportSkeleton(content: string | null): boolean {
  if (!content?.trim()) return false;
  const text = content.trim();
  const hasSkeletonKeys =
    /executive_summary/i.test(text) &&
    /project_progress|financial_performance|operational_highlights|human_resources/i.test(
      text,
    );
  if (!hasSkeletonKeys) return false;

  const emptyStringFields = (text.match(/:\s*""\s*[,}]/g) || []).length;
  const emptyArrays = (text.match(/:\s*\[\s*\]/g) || []).length;
  const zeroNumbers = (text.match(/:\s*0\s*[,}]/g) || []).length;
  const empties = emptyStringFields + emptyArrays + zeroNumbers;
  if (empties >= 3) return true;

  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return empties >= 2;
    const obj = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    return isMostlyEmptyValues(obj as Record<string, unknown>);
  } catch {
    return empties >= 2;
  }
}

function isMostlyEmptyValues(obj: Record<string, unknown>, depth = 0): boolean {
  if (depth > 4) return true;
  const values = Object.values(obj);
  if (!values.length) return true;
  let empty = 0;
  for (const v of values) {
    if (v == null || v === "" || v === 0) empty++;
    else if (Array.isArray(v) && v.length === 0) empty++;
    else if (
      typeof v === "object" &&
      isMostlyEmptyValues(v as Record<string, unknown>, depth + 1)
    )
      empty++;
  }
  return empty / values.length >= 0.7;
}

/** Shell/Python that writes an empty laporan skeleton to .md/.json instead of PDF. */
export function isEmptySkeletonShellWrite(command: string | null): boolean {
  if (!command?.trim()) return false;
  const cmd = command;
  const targetsReportFile =
    /laporan|report/i.test(cmd) &&
    /\.(md|txt|json|markdown)/i.test(cmd) &&
    !/\.pdf\b/i.test(cmd);
  if (!targetsReportFile) return false;
  return isEmptyReportSkeleton(cmd);
}

export function refuseEmptyDeliverableMessage(target: string): string {
  return [
    `Error: refused empty laporan/report skeleton write (${target}).`,
    "That JSON/Python template with blank fields is NOT a deliverable.",
    "User asked for a complete PDF: `ls tmp/templates/` + read matching TEMPLATE.md, then `/skills/productivity/pdf/SKILL.md`,",
    "then `execute` reportlab code that fills real content and saves `tmp/…/….pdf`.",
    "Do not print Python in the chat reply — call the execute tool. Do not write empty JSON to .md.",
  ].join(" ");
}

export type WritePersistOptions = {
  artifactHome: string;
  workspaceRoot: string;
};

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

export function createWritePersistMiddleware(options: WritePersistOptions) {
  const artifactHome = path.resolve(options.artifactHome);
  const workspaceRoot = path.resolve(options.workspaceRoot);

  return createMiddleware({
    name: "WritePersistMiddleware",
    async wrapToolCall(request, handler) {
      const name = request.toolCall.name;
      const args = request.toolCall.args;

      if (SHELL_TOOLS.has(name)) {
        const command = toolArgCommand(args);
        if (isEmptySkeletonShellWrite(command)) {
          return new ToolMessage({
            content: refuseEmptyDeliverableMessage("execute"),
            tool_call_id: request.toolCall.id ?? "",
            name,
            status: "error",
          });
        }
        return handler(request);
      }

      if (!WRITE_TOOLS.has(name)) return handler(request);

      const filePath = toolArgPath(args);
      const content = toolArgContent(args);

      if (filePath && isTinyStubDeliverable(filePath, content)) {
        return new ToolMessage({
          content: [
            `Error: refused trivial stub write to ${filePath}.`,
            "Content is only a title line — not a deliverable.",
            "If the user asked for PDF/laporan lengkap: `ls tmp/templates/` + TEMPLATE.md, then `/skills/productivity/pdf/SKILL.md`,",
            "then `execute` a reportlab (or skill) script that writes a real `.pdf` under tmp/…",
            "Optional: write a full Markdown draft (≥ several sections) OR a `.py` generator — never a one-line placeholder.",
          ].join(" "),
          tool_call_id: request.toolCall.id ?? "",
          name,
          status: "error",
        });
      }

      if (filePath && isEmptyReportSkeleton(content)) {
        return new ToolMessage({
          content: refuseEmptyDeliverableMessage(filePath),
          tool_call_id: request.toolCall.id ?? "",
          name,
          status: "error",
        });
      }

      // laporan*.md containing JSON report keys — wrong format for PDF asks
      if (
        filePath &&
        isReportLikePath(filePath) &&
        /\.(md|txt|markdown)$/i.test(filePath) &&
        content &&
        /^\s*\{/.test(content) &&
        /executive_summary|project_progress|financial_performance/i.test(content)
      ) {
        return new ToolMessage({
          content: refuseEmptyDeliverableMessage(filePath),
          tool_call_id: request.toolCall.id ?? "",
          name,
          status: "error",
        });
      }

      const result = await handler(request);
      if (!filePath) return result;

      const msg = asToolMessage(result);
      if (!msg) return result;
      if (msg.status === "error") return result;

      const candidates = resolveWriteCandidatePaths(
        artifactHome,
        workspaceRoot,
        filePath,
      );
      const hit = findPersistedWrite(candidates);
      if (hit) {
        const note =
          hit.abs !== path.resolve(filePath)
            ? `\n[WRITE PERSIST OK] on disk: ${hit.abs} (${hit.size} bytes)`
            : `\n[WRITE PERSIST OK] ${hit.size} bytes`;
        const base =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        return new ToolMessage({
          content: `${base}${note}`,
          tool_call_id: msg.tool_call_id,
          name: msg.name,
          status: msg.status,
          additional_kwargs: msg.additional_kwargs,
          response_metadata: msg.response_metadata,
          id: msg.id,
          artifact: msg.artifact,
        });
      }

      return new ToolMessage({
        content: [
          `Error: write_file reported success but file is missing on disk: ${filePath}`,
          `Checked: ${candidates.join(" | ")}`,
          "Desktop Open will fail with \"File not found in project folders\".",
          "Fix: mkdir -p the working scope, then rewrite via `execute` (e.g. Python) to an absolute path under tmp/bots|global|project/…, verify with ls, then put that path in backticks.",
        ].join("\n"),
        tool_call_id: request.toolCall.id ?? "",
        name,
        status: "error",
      });
    },
  });
}
