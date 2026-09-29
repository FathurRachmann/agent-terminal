/**
 * After edit_file / write_file on code, append a lightweight verify nudge
 * (and optional typecheck) so the model self-corrects in the same turn —
 * Claude Code / Cursor-style post-edit loop.
 */
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import path from "node:path";
import {
  detectVerifyCommands,
  runShellCommand,
} from "./coding-tools.js";

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
]);

export type PostEditVerifyOptions = {
  workspaceRoot: string;
  /** Run typecheck after code edits (default true). */
  runTypecheck?: boolean;
  /** Injected for tests. */
  runCommand?: typeof runShellCommand;
  detect?: typeof detectVerifyCommands;
};

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

function toolArgPath(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const p = obj.file_path ?? obj.path ?? obj.filePath;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

export function isCodeEditPath(filePath: string | null): boolean {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXT.has(ext);
}

export function looksLikeEditSuccess(content: string): boolean {
  const t = content.toLowerCase();
  if (!t.trim()) return false;
  if (/\berror\b/.test(t) && !/successfully|updated|wrote|edited/.test(t)) {
    return false;
  }
  if (/^(error|failed|cannot|unable)/i.test(content.trim())) return false;
  return true;
}

function withAppendedContent(result: ToolMessage, extra: string): ToolMessage {
  const base =
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content);
  return new ToolMessage({
    content: `${base}\n\n[POST-EDIT VERIFY]\n${extra}`,
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: result.status,
    additional_kwargs: result.additional_kwargs,
    response_metadata: result.response_metadata,
    id: result.id,
    artifact: result.artifact,
  });
}

/**
 * wrapToolCall: after successful edit_file/write_file on code files,
 * optionally run typecheck and always remind the model to fix or run_tests.
 */
export function createPostEditVerifyMiddleware(options: PostEditVerifyOptions) {
  const runTypecheck = options.runTypecheck !== false;
  const runCommand = options.runCommand ?? runShellCommand;
  const detect = options.detect ?? detectVerifyCommands;
  const root = path.resolve(options.workspaceRoot);

  // Debounce: at most one typecheck per short window across parallel edits.
  let lastTypecheckAt = 0;
  const DEBOUNCE_MS = 8_000;

  return createMiddleware({
    name: "PostEditVerifyMiddleware",
    async wrapToolCall(request, handler) {
      const result = await handler(request);
      const name = request.toolCall.name;
      if (name !== "edit_file" && name !== "write_file") return result;

      const msg = asToolMessage(result);
      if (!msg) return result;
      const content =
        typeof msg.content === "string" ? msg.content : String(msg.content);
      if (!looksLikeEditSuccess(content)) return result;

      const filePath = toolArgPath(request.toolCall.args);
      if (!isCodeEditPath(filePath)) return result;

      const lines = [
        `Edited: ${filePath}`,
        "Next: if errors appear below, fix with edit_file in this turn. Then call run_tests (or git_status) before claiming done.",
      ];

      const now = Date.now();
      if (runTypecheck && now - lastTypecheckAt >= DEBOUNCE_MS) {
        const { typecheck } = detect(root);
        if (typecheck) {
          lastTypecheckAt = now;
          const check = await runCommand(root, typecheck, 90_000);
          lines.push(`$ ${typecheck}`);
          if (check.stdout) lines.push(check.stdout.slice(0, 4_000));
          if (check.stderr) lines.push(`stderr:\n${check.stderr.slice(0, 2_000)}`);
          lines.push(
            check.ok
              ? "typecheck: PASS"
              : "typecheck: FAIL — fix before finishing.",
          );
        }
      }

      return withAppendedContent(msg, lines.join("\n"));
    },
  });
}
