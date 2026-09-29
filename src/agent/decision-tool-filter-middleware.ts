import { createMiddleware } from "langchain";
import {
  decideExtraDisabledTools,
  isDecisionEngineEnabled,
} from "../decision/index.js";

function lastHumanText(messages: unknown[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as {
      type?: string;
      role?: string;
      content?: unknown;
      getType?: () => string;
    };
    const typ =
      typeof m?.getType === "function"
        ? m.getType()
        : (m?.type ?? m?.role ?? "");
    if (typ !== "human" && typ !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((part) =>
          typeof part === "string"
            ? part
            : part && typeof part === "object" && "text" in part
              ? String((part as { text?: string }).text ?? "")
              : "",
        )
        .join(" ")
        .trim();
    }
  }
  return "";
}

/**
 * Per-turn hide of heavy tool categories (web/desktop/browser/…) via
 * the decision engine. Static capability prefs still win permanently.
 */
export function createDecisionToolFilterMiddleware(
  alreadyDisabled: Set<string>,
) {
  return createMiddleware({
    name: "DecisionToolFilterMiddleware",
    async wrapModelCall(request, handler) {
      if (!isDecisionEngineEnabled()) return handler(request);
      const prompt = lastHumanText(
        request.messages as unknown[] | undefined,
      );
      if (!prompt.trim()) return handler(request);

      let extra: Set<string>;
      try {
        const decided = await decideExtraDisabledTools({
          prompt,
          alreadyDisabled,
        });
        extra = decided.disabledExtra;
      } catch {
        return handler(request);
      }
      if (!extra.size) return handler(request);

      const excluded = new Set([...alreadyDisabled, ...extra]);
      const tools = request.tools?.filter((tool) => {
        const name =
          tool && typeof tool === "object" && "name" in tool
            ? String((tool as { name?: string }).name ?? "")
            : "";
        return !name || !excluded.has(name);
      });
      return handler({ ...request, tools });
    },
  });
}
