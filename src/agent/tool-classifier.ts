/**
 * Auto-review classifier — small/cheap model via 9router.
 * allow → auto-run; ask → HITL; deny → tool error (model retries).
 */
import { ChatOpenAI } from "@langchain/openai";
import {
  extractExecuteCommand,
  matchesToolAllowlist,
  type RunMode,
} from "./run-modes.js";
import { mcpToolAllowed } from "./permissions-store.js";

export type ClassifierVerdict = "allow" | "ask" | "deny";

const CLASSIFIER_TIMEOUT_MS = 2_000;

export function resolveClassifierModel(): string {
  return (
    process.env.AGENT_CLASSIFIER_MODEL?.trim() ||
    process.env.AGENT_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

export function parseClassifierResponse(text: string): ClassifierVerdict {
  const raw = String(text || "").trim();
  if (!raw) return "ask";
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const json = JSON.parse(raw.slice(start, end + 1)) as {
        decision?: string;
        verdict?: string;
      };
      const d = String(json.decision ?? json.verdict ?? "")
        .trim()
        .toLowerCase();
      if (d === "allow" || d === "ask" || d === "deny") return d;
    }
  } catch {
    /* fall through */
  }
  const lower = raw.toLowerCase();
  if (/\bdeny\b/.test(lower)) return "deny";
  if (/\ballow\b/.test(lower)) return "allow";
  if (/\bask\b/.test(lower)) return "ask";
  return "ask";
}

function summarizeArgs(args: unknown, max = 400): string {
  try {
    const text =
      typeof args === "string" ? args : JSON.stringify(args ?? {});
    const one = text.replace(/\s+/g, " ").trim();
    return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
  } catch {
    return String(args ?? "");
  }
}

export type ClassifyToolCallInput = {
  toolName: string;
  args?: unknown;
  runMode: RunMode;
  allowlist: readonly string[];
  chatMode?: string;
  /** From permissions.json autoRun — steers Auto-review only. */
  allowInstructions?: readonly string[];
  blockInstructions?: readonly string[];
  /** MCP allowlist entries from permissions.json (server:tool). */
  mcpAllowlist?: readonly string[];
};

/**
 * Decide allow/ask/deny for a Run-Mode-gated tool.
 * Safe tools and allowlist hits short-circuit without LLM.
 */
export async function classifyToolCall(
  input: ClassifyToolCallInput,
): Promise<ClassifierVerdict> {
  const { toolName, args, runMode, allowlist } = input;

  if (runMode === "run-everything") return "allow";

  if (matchesToolAllowlist(toolName, args, allowlist)) return "allow";

  if (
    toolName.startsWith("mcp_") &&
    input.mcpAllowlist?.length &&
    mcpToolAllowed(toolName, input.mcpAllowlist)
  ) {
    return "allow";
  }

  if (runMode === "allowlist") return "ask";

  // auto-review → cheap classifier
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) return "ask";

  const cmd = extractExecuteCommand(args);
  const allowHints = (input.allowInstructions ?? []).slice(0, 12);
  const blockHints = (input.blockInstructions ?? []).slice(0, 12);
  const prompt = [
    "You are a security classifier for an AI coding agent (Cursor Auto-review style).",
    "Decide whether this tool call is safe to auto-run without asking the user.",
    'Respond with ONLY JSON: {"decision":"allow"|"ask"|"deny"}',
    "- allow: clearly safe (read-only, routine build/test, listed project scripts)",
    "- ask: uncertain, destructive, network exfil, secrets, or irreversible",
    "- deny: clearly malicious or catastrophic (rm -rf /, curl|sh secrets, force push main)",
    allowHints.length
      ? `Team/user ALLOW hints:\n- ${allowHints.join("\n- ")}`
      : "",
    blockHints.length
      ? `Team/user BLOCK hints:\n- ${blockHints.join("\n- ")}`
      : "",
    `chatMode: ${input.chatMode ?? "agent"}`,
    `tool: ${toolName}`,
    cmd ? `command: ${cmd}` : `args: ${summarizeArgs(args)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const model = new ChatOpenAI({
    model: resolveClassifierModel(),
    apiKey,
    configuration: {
      baseURL: process.env.ROUTER_BASE_URL ?? "http://127.0.0.1:27128/v1",
    },
    temperature: 0,
    streaming: false,
  });

  try {
    const result = await Promise.race([
      model.invoke(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("classifier timeout")),
          CLASSIFIER_TIMEOUT_MS,
        ),
      ),
    ]);
    const text =
      typeof result.content === "string"
        ? result.content
        : Array.isArray(result.content)
          ? result.content
              .map((p) =>
                typeof p === "string"
                  ? p
                  : p && typeof p === "object" && "text" in p
                    ? String((p as { text?: string }).text ?? "")
                    : "",
              )
              .join("")
          : String(result.content ?? "");
    return parseClassifierResponse(text);
  } catch {
    return "ask";
  }
}
