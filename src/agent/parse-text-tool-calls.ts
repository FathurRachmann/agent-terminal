import { randomUUID } from "node:crypto";
import type { ToolCall } from "@langchain/core/messages/tool";

type RawToolShape = {
  name?: unknown;
  arguments?: unknown;
  args?: unknown;
  id?: unknown;
};

/**
 * Some OpenAI-compatible proxies (e.g. 9router + certain upstream models)
 * emit tool invocations as plain JSON text instead of native tool_calls.
 *
 * Supported shapes:
 * - [{"name":"tool","arguments":{...}}]
 * - {"name":"tool","arguments":{...}}
 * - {"tool_calls":[...]} / {"function":{"name","arguments"}}
 */
export function parseTextToolCalls(content: unknown): ToolCall[] {
  const text = contentToString(content).trim();
  if (!text) return [];

  const candidates = extractJsonCandidates(text);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) continue;
    const calls = normalizeParsedToolPayload(parsed);
    if (calls.length > 0) return calls;
  }
  return [];
}

export function contentLooksLikeTextToolCall(content: unknown): boolean {
  return parseTextToolCalls(content).length > 0;
}

/**
 * True for complete OR truncated JSON tool dumps (9router quirk).
 * Incomplete streams often end mid-object (`{"name":`) and fail JSON.parse —
 * those must still be hidden from the chat bubble.
 *
 * Also catches Antigravity / OpenClaw-style bracket dumps:
 * `[READ DOCUMENT]File Path: … [EDIT FILE]…`
 */
export function looksLikeTextToolCallDump(content: unknown): boolean {
  if (contentLooksLikeTextToolCall(content)) return true;
  const text = contentToString(content)
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!text || text.length < 12) return false;

  if (looksLikeBracketToolDump(text)) return true;

  if (!/^[\[{]/.test(text)) return false;
  if (!/"name"\s*:/.test(text)) return false;

  const knownTool =
    /"(task_plan|task_todos|task_todo_update|task_verify|execute|read_file|write_file|edit_file|str_replace|glob|grep|ls|shell|bash|memory_recall|remember_rule|list_dir|desktop_[a-z_]+)"/.test(
      text,
    );
  const nameHits = (text.match(/"name"\s*:/g) ?? []).length;
  const argHits = (text.match(/"(?:arguments|args)"\s*:/g) ?? []).length;
  // Truncated mid-call: …{"name":  or …"name":"
  const truncatedTail = /"name"\s*:\s*"?[a-zA-Z_][\w.-]*"?\s*,?\s*$/.test(text);

  if (knownTool) return true;
  if (nameHits >= 1 && argHits >= 1) return true;
  if (nameHits >= 1 && truncatedTail) return true;
  return false;
}

/** Bracket-tagged pseudo tool logs (not user-facing answers). */
export function looksLikeBracketToolDump(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length < 20) return false;
  const tags = t.match(
    /\[(READ DOCUMENT|EDIT FILE|WRITE FILE|WEB SEARCH|WEB EXTRACT|EXECUTE|RUN COMMAND|LIST DIR|GREP|GLOB|BROWSER|CLICK|TYPE|SCROLL|SCREENSHOT)\]/gi,
  );
  if (!tags || tags.length < 1) return false;
  // One tag + File Path / File Contents / Query = dump
  if (
    tags.length >= 2 ||
    (/File Path\s*:/i.test(t) && /File Contents\s*:/i.test(t)) ||
    (/File Path\s*:/i.test(t) && tags.length >= 1)
  ) {
    // Allow a short prose answer that merely cites one tag in backticks.
    if (
      tags.length === 1 &&
      t.length < 120 &&
      !/File (Path|Contents)\s*:/i.test(t)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

function extractJsonCandidates(text: string): string[] {
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const out: string[] = [cleaned];
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) out.push(arrayMatch[0]);
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) out.push(objectMatch[0]);
  return out;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeParsedToolPayload(parsed: unknown): ToolCall[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => toolCallFromUnknown(item) ?? []);
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.tool_calls)) {
    return obj.tool_calls.flatMap((item) => toolCallFromUnknown(item) ?? []);
  }
  const single = toolCallFromUnknown(obj);
  return single ? [single] : [];
}

function toolCallFromUnknown(raw: unknown): ToolCall | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as RawToolShape & {
    function?: { name?: unknown; arguments?: unknown };
    type?: unknown;
  };

  // OpenAI chat-completions style nested under function
  if (obj.function && typeof obj.function === "object") {
    const name = String(obj.function.name ?? "").trim();
    if (!name) return null;
    return {
      name,
      args: coerceArgs(parseArgs(obj.function.arguments)),
      id: String(obj.id ?? `call_${randomUUID()}`),
      type: "tool_call",
    };
  }

  const name = String(obj.name ?? "").trim();
  if (!name) return null;
  // Avoid treating arbitrary JSON objects with a name field as tools
  // unless they look like tool invocations.
  if (obj.arguments === undefined && obj.args === undefined) return null;

  return {
    name,
    args: coerceArgs(parseArgs(obj.arguments ?? obj.args)),
    id: String(obj.id ?? `call_${randomUUID()}`),
    type: "tool_call",
  };
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { value: args };
    }
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return { value: args };
}

/** Coerce numeric/boolean strings so Zod number/boolean schemas accept proxy quirks. */
function coerceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      const t = value.trim();
      if (/^-?\d+$/.test(t)) {
        out[key] = Number(t);
        continue;
      }
      if (/^-?\d+\.\d+$/.test(t)) {
        out[key] = Number(t);
        continue;
      }
      if (t === "true" || t === "false") {
        out[key] = t === "true";
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}
