import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

/**
 * Mutable allowlist for specialized bot sessions.
 * `null` = general mode (all tools). Non-null = only listed tool names.
 */
export type BotScopeController = {
  getAllowedTools: () => string[] | null;
  setAllowedTools: (tools: string[] | null) => void;
};

export function createBotScopeController(): BotScopeController {
  let allowed: string[] | null = null;
  return {
    getAllowedTools: () => allowed,
    setAllowedTools: (tools) => {
      allowed = tools ? tools.map(String).filter(Boolean) : null;
    },
  };
}

export function toolNameOf(tool: unknown): string {
  if (tool && typeof tool === "object" && "name" in tool) {
    return String((tool as { name?: unknown }).name ?? "");
  }
  return "";
}

/** Pure allowlist filter — used by middleware and unit tests. */
export function filterToolsByBotAllowlist<T>(
  tools: readonly T[] | undefined,
  allowed: string[] | null,
): T[] | undefined {
  if (!allowed) return tools ? [...tools] : tools;
  if (!tools) return tools;
  const allow = new Set(allowed);
  return tools.filter((tool) => {
    const name = toolNameOf(tool);
    // Nameless tools must not slip through specialized allowlists.
    return Boolean(name) && allow.has(name);
  });
}

/** Returns an error ToolMessage when the call is out of scope; otherwise null. */
export function rejectBotScopedToolCall(
  toolCall: { name: string; id?: string | null },
  allowed: string[] | null,
): ToolMessage | null {
  if (!allowed) return null;
  const allow = new Set(allowed);
  if (allow.has(toolCall.name)) return null;
  return new ToolMessage({
    content: `Error: ${toolCall.name} is not available in this bot session. This bot is scoped to: ${allowed.join(", ")}. Stay within specialty or switch to a Sessions (general) chat.`,
    tool_call_id: toolCall.id ?? "",
    name: toolCall.name,
    status: "error",
  });
}

/**
 * Hide tools outside the active bot allowlist and reject calls if the model
 * still attempts them (covers Deep Agents builtins + custom tools).
 */
export function createBotScopeMiddleware(controller: BotScopeController) {
  return createMiddleware({
    name: "BotScopeMiddleware",
    wrapModelCall(request, handler) {
      const allowed = controller.getAllowedTools();
      if (!allowed) return handler(request);
      const tools = filterToolsByBotAllowlist(request.tools, allowed) ?? [];
      return handler({
        ...request,
        tools,
      });
    },
    wrapToolCall(request, handler) {
      const allowed = controller.getAllowedTools();
      const rejected = rejectBotScopedToolCall(request.toolCall, allowed);
      if (rejected) return rejected;
      return handler(request);
    },
  });
}

/** Build the per-turn instruction injected for a specialized bot. */
export function buildBotScopeInstruction(options: {
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
}): string {
  const tools = options.tools?.length
    ? options.tools.join(", ")
    : "(all tools)";
  const specialty = options.systemPrompt?.trim() || options.description;
  return [
    `You are operating STRICTLY as bot "${options.name}".`,
    `Specialty: ${specialty}`,
    `Allowed tools ONLY: ${tools}. Do not call any other tool.`,
    `Refuse requests outside this specialty (coding, sysadmin, unrelated tasks, etc.).`,
    `Tell the user briefly to switch to Sessions (general) or another bot if they need something else.`,
    `Do not pretend you can do out-of-scope work.`,
  ].join("\n");
}
