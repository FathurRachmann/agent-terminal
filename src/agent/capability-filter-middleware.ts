import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

/**
 * Hide disabled tools from the model and reject calls if the model still
 * attempts them (covers built-in Deep Agents tools + custom tools).
 */
export function createCapabilityFilterMiddleware(disabledToolNames: Set<string>) {
  const excluded = new Set(disabledToolNames);
  return createMiddleware({
    name: "CapabilityFilterMiddleware",
    wrapModelCall(request, handler) {
      if (excluded.size === 0) return handler(request);
      const tools = request.tools?.filter((tool) => {
        const name =
          tool && typeof tool === "object" && "name" in tool
            ? String((tool as { name?: string }).name ?? "")
            : "";
        return !name || !excluded.has(name);
      });
      return handler({ ...request, tools });
    },
    wrapToolCall(request, handler) {
      if (excluded.size === 0) return handler(request);
      const { name, id } = request.toolCall;
      if (!excluded.has(name)) return handler(request);
      return new ToolMessage({
        content: `Error: ${name} is disabled in Capabilities. Re-enable it in the Capabilities menu and start a new session (or wait for agent reload).`,
        tool_call_id: id ?? "",
        name,
        status: "error",
      });
    },
  });
}
