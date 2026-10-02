/**
 * After successful edit_file / write_file, append unified diff + FILE_DIFF payload
 * for chat chips and Monaco side-by-side preview.
 */
import fs from "node:fs";
import path from "node:path";
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import {
  buildFileDiffPayload,
  formatDiffToolSuffix,
  reconstructBeforeFromEdit,
} from "./edit-diff.js";
import {
  looksLikeEditFailure,
  resolveEditPath,
  toolArgString,
} from "./edit-retry-middleware.js";
import { looksLikeEditSuccess } from "./post-edit-verify-middleware.js";

const WRITE_EDIT = new Set(["edit_file", "edit", "write_file", "write"]);

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

function withContent(result: ToolMessage, content: string): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: result.status,
    additional_kwargs: {
      ...result.additional_kwargs,
    },
    response_metadata: result.response_metadata,
    id: result.id,
    artifact: result.artifact,
  });
}

export type EditDiffMiddlewareOptions = {
  workspaceRoot: string;
  readFile?: (absPath: string) => string;
};

export function createEditDiffMiddleware(options: EditDiffMiddlewareOptions) {
  const root = path.resolve(options.workspaceRoot);
  const readFile =
    options.readFile ??
    ((abs: string) => fs.readFileSync(abs, "utf8"));

  return createMiddleware({
    name: "EditDiffMiddleware",
    async wrapToolCall(request, handler) {
      const name = String(request.toolCall.name || "");
      if (!WRITE_EDIT.has(name)) {
        return handler(request);
      }

      const filePath = toolArgString(request.toolCall.args, [
        "file_path",
        "path",
        "filePath",
      ]);
      const abs = resolveEditPath(root, filePath);
      let before = "";
      if (abs && fs.existsSync(abs)) {
        try {
          before = readFile(abs);
        } catch {
          before = "";
        }
      }

      const result = await handler(request);
      const msg = asToolMessage(result);
      if (!msg) return result;

      const content =
        typeof msg.content === "string" ? msg.content : String(msg.content);
      if (looksLikeEditFailure(content) || !looksLikeEditSuccess(content)) {
        return result;
      }
      if (!abs || !fs.existsSync(abs)) return result;

      let after = "";
      try {
        after = readFile(abs);
      } catch {
        return result;
      }

      // If snapshot missed (race) try reconstruct for edit_file.
      if (
        !before &&
        (name === "edit_file" || name === "edit") &&
        after
      ) {
        const oldString = toolArgString(request.toolCall.args, ["old_string"]);
        const newString = toolArgString(request.toolCall.args, ["new_string"]);
        before =
          reconstructBeforeFromEdit({ after, oldString, newString }) ?? "";
      }

      if (before === after) return result;

      const rel =
        filePath?.trim() ||
        path.relative(root, abs).replace(/\\/g, "/") ||
        path.basename(abs);
      const payload = buildFileDiffPayload({
        path: rel,
        before,
        after,
      });
      // Avoid double-append if another layer already added FILE_DIFF.
      if (/```agent-file-diff/i.test(content)) return result;

      return withContent(msg, `${content}${formatDiffToolSuffix(payload)}`);
    },
  });
}
