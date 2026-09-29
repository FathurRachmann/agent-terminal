/**
 * Compact large tool outputs before they bloat the conversation context.
 * Keeps error/signal lines + head/tail — Claude Code-style tool-result trimming.
 */
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

const DEFAULT_MAX = 8_000;
const HEAD = 40;
const TAIL = 60;

const SIGNAL_RE =
  /(error|exception|traceback|failed|failure|fatal|panic|TypeError|ReferenceError|E\d{3}|exit_code|FAIL|PASS|warning:|typecheck|Cannot find|not found|ENOENT|ELIFECYCLE)/i;

const PATH_LINE_RE = /(?:^|[\s(])([A-Za-z0-9_./-]+\.\w+:\d+(?::\d+)?)/;

export type CompactOptions = {
  maxChars?: number;
  /** Tools that should never be compacted (short structured JSON). */
  skipTools?: Set<string>;
};

export function extractSignalLines(text: string, limit = 40): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (SIGNAL_RE.test(t) || PATH_LINE_RE.test(t)) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(line);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function compactToolOutput(
  text: string,
  options: CompactOptions = {},
): { text: string; compacted: boolean } {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  if (text.length <= maxChars) {
    return { text, compacted: false };
  }

  const lines = text.split(/\r?\n/);
  const signals = extractSignalLines(text);
  const head = lines.slice(0, HEAD);
  const tail = lines.slice(-TAIL);
  const omitted = Math.max(0, lines.length - HEAD - TAIL);

  const parts = [
    ...head,
    "",
    `...[${omitted} lines omitted — compacted for context]...`,
    "",
  ];
  if (signals.length) {
    parts.push("[signal lines]", ...signals, "");
  }
  parts.push(...tail);

  let compacted = parts.join("\n");
  if (compacted.length > maxChars) {
    compacted =
      compacted.slice(0, maxChars - 80) +
      "\n…(hard truncate)\n" +
      compacted.slice(-40);
  }
  return { text: compacted, compacted: true };
}

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

const DEFAULT_SKIP = new Set([
  "task_plan",
  "task_todos",
  "task_todo_update",
  "task_status",
  "task_verify",
  "memory_store",
  "memory_recall",
  "remember_rule",
]);

/**
 * wrapToolCall: shrink huge tool messages while preserving failure signals.
 */
export function createToolResultCompactMiddleware(
  options: CompactOptions = {},
) {
  const skip = options.skipTools ?? DEFAULT_SKIP;
  const maxChars = options.maxChars ?? DEFAULT_MAX;

  return createMiddleware({
    name: "ToolResultCompactMiddleware",
    async wrapToolCall(request, handler) {
      const result = await handler(request);
      if (skip.has(request.toolCall.name)) return result;

      const msg = asToolMessage(result);
      if (!msg) return result;
      if (typeof msg.content !== "string") return result;
      if (msg.content.length <= maxChars) return result;

      const { text, compacted } = compactToolOutput(msg.content, { maxChars });
      if (!compacted) return result;

      return new ToolMessage({
        content: text,
        tool_call_id: msg.tool_call_id,
        name: msg.name,
        status: msg.status,
        additional_kwargs: msg.additional_kwargs,
        response_metadata: {
          ...msg.response_metadata,
          compacted: true,
        },
        id: msg.id,
        artifact: msg.artifact,
      });
    },
  });
}
