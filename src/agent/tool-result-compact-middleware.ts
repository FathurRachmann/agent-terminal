/**
 * Compact large tool outputs before they bloat the conversation context.
 * Keeps error/signal lines + head/tail — Claude Code-style tool-result trimming.
 *
 * read_file / read / grep get a tighter budget; repeated reads of the same
 * path are short-circuited so huge files are not re-injected.
 */
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

const DEFAULT_MAX = Number(process.env.TOOL_RESULT_MAX_CHARS ?? 4_000);
const READ_MAX = Number(process.env.READ_FILE_MAX_CHARS ?? 3_000);
const HEAD = 28;
const TAIL = 40;
const READ_HEAD = 20;
const READ_TAIL = 24;

const SIGNAL_RE =
  /(error|exception|traceback|failed|failure|fatal|panic|TypeError|ReferenceError|E\d{3}|exit_code|FAIL|PASS|warning:|typecheck|Cannot find|not found|ENOENT|ELIFECYCLE)/i;

const PATH_LINE_RE = /(?:^|[\s(])([A-Za-z0-9_./-]+\.\w+:\d+(?::\d+)?)/;

const READ_LIKE = new Set(["read_file", "read", "grep", "glob"]);
const SEARCH_LIKE = new Set(["grep", "glob", "find_symbol", "find_references"]);

function toolSearchKey(name: string, args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  if (name === "grep") {
    const q = String(a.query ?? a.pattern ?? "");
    const p = String(a.path ?? a.target_directory ?? "");
    return `grep:${q}:${p}`;
  }
  if (name === "glob") {
    const g = String(a.glob ?? a.glob_pattern ?? a.pattern ?? "");
    const p = String(a.target_directory ?? a.path ?? "");
    return `glob:${g}:${p}`;
  }
  if (name === "execute") {
    const cmd = String(a.command ?? "").trim();
    if (/(?:^|\s)(?:grep|find|rg|ls)\b/.test(cmd)) {
      return `exec:${cmd}`;
    }
  }
  return null;
}

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
  options: CompactOptions & { head?: number; tail?: number } = {},
): { text: string; compacted: boolean } {
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  if (text.length <= maxChars) {
    return { text, compacted: false };
  }

  const headN = options.head ?? HEAD;
  const tailN = options.tail ?? TAIL;
  const lines = text.split(/\r?\n/);
  const signals = extractSignalLines(text);
  const head = lines.slice(0, headN);
  const tail = lines.slice(-tailN);
  const omitted = Math.max(0, lines.length - headN - tailN);

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

function toolArgPath(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const obj = args as Record<string, unknown>;
  for (const key of ["file_path", "path", "filePath", "filename", "file"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\\/g, "/");
  }
  return "";
}

function contentFingerprint(text: string): string {
  // Cheap stable fingerprint — length + edges (enough to detect same read).
  const t = text.length > 240 ? `${text.slice(0, 120)}…${text.slice(-120)}` : text;
  return `${text.length}:${t}`;
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
 * Also dedupes repeated read_file of the same path in this agent lifetime.
 */
export function createToolResultCompactMiddleware(
  options: CompactOptions = {},
) {
  const skip = options.skipTools ?? DEFAULT_SKIP;
  const maxChars = options.maxChars ?? DEFAULT_MAX;
  /** path → fingerprint of last returned content */
  const recentReads = new Map<string, string>();
  /** searchKey → count */
  const recentSearches = new Set<string>();
  let consecutiveSearchCount = 0;

  return createMiddleware({
    name: "ToolResultCompactMiddleware",
    async wrapToolCall(request, handler) {
      const name = request.toolCall.name;
      const pathKey = toolArgPath(request.toolCall.args);
      const searchKey = toolSearchKey(name, request.toolCall.args);

      // Skip re-running identical search queries that yield no change.
      if (searchKey && recentSearches.has(searchKey)) {
        return new ToolMessage({
          content:
            `[DEDUPED SEARCH] You already executed this exact query in this turn (\`${searchKey}\`). ` +
            `It returned no new matches. Stop repeating identical queries; inspect candidate files directly or formulate an edit.`,
          tool_call_id: String(request.toolCall.id ?? ""),
          name,
        });
      }

      // Skip re-injecting the same large file body.
      if (
        (name === "read_file" || name === "read") &&
        pathKey &&
        recentReads.has(pathKey)
      ) {
        const prev = recentReads.get(pathKey)!;
        return new ToolMessage({
          content:
            `[DEDUPED READ] Already loaded earlier this session: \`${pathKey}\` ` +
            `(~${prev.split(":")[0] || "?"} chars). Do not re-read the whole file — ` +
            `use grep / find_symbol / edit_file with known context, or ask for a specific line range.`,
          tool_call_id: String(request.toolCall.id ?? ""),
          name,
        });
      }

      if (name === "edit_file" || name === "write_file" || name === "str_replace") {
        consecutiveSearchCount = 0;
      } else if (SEARCH_LIKE.has(name) || name === "read_file" || name === "read") {
        consecutiveSearchCount++;
      }

      if (searchKey) {
        recentSearches.add(searchKey);
        if (recentSearches.size > 50) {
          const first = recentSearches.values().next().value;
          if (first) recentSearches.delete(first);
        }
      }

      const result = await handler(request);
      if (skip.has(name)) return result;

      const msg = asToolMessage(result);
      if (!msg) return result;
      if (typeof msg.content !== "string") return result;
      if (/```agent-file-diff/i.test(msg.content)) return result;

      const isReadLike = READ_LIKE.has(name);
      const budget = isReadLike ? Math.min(maxChars, READ_MAX) : maxChars;

      if (
        (name === "read_file" || name === "read") &&
        pathKey &&
        msg.content.length > 400
      ) {
        recentReads.set(pathKey, contentFingerprint(msg.content));
        // Bound map size
        if (recentReads.size > 40) {
          const first = recentReads.keys().next().value;
          if (first) recentReads.delete(first);
        }
      }

      let contentToReturn = msg.content;
      let wasCompacted = false;

      if (contentToReturn.length > budget) {
        const { text, compacted } = compactToolOutput(contentToReturn, {
          maxChars: budget,
          head: isReadLike ? READ_HEAD : HEAD,
          tail: isReadLike ? READ_TAIL : TAIL,
        });
        contentToReturn = text;
        wasCompacted = compacted;
      }

      // Add anti-loop advisory if agent has performed 5+ consecutive search/read operations without edits.
      if (consecutiveSearchCount >= 5 && isReadLike) {
        contentToReturn +=
          `\n\n[SYSTEM REMINDER: ${consecutiveSearchCount} consecutive read/search operations executed. ` +
          `Avoid endless exploratory searching. Make a concrete decision or proceed to edit candidate files directly.]`;
      }

      if (!wasCompacted && consecutiveSearchCount < 5) return result;

      return new ToolMessage({
        content: contentToReturn,
        tool_call_id: msg.tool_call_id,
        name: msg.name,
        status: msg.status,
        additional_kwargs: msg.additional_kwargs,
        response_metadata: {
          ...msg.response_metadata,
          compacted: wasCompacted,
        },
        id: msg.id,
        artifact: msg.artifact,
      });
    },
  });
}
