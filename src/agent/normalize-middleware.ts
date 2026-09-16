import { createMiddleware } from "langchain";
import {
  AIMessage,
  AIMessageChunk,
  ChatMessage,
  ChatMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { isCommand } from "@langchain/langgraph";
import { parseTextToolCalls } from "./parse-text-tool-calls.js";

/**
 * Convert proxy/router quirks (ChatMessage / ChatMessageChunk / plain objects)
 * into AIMessage / AIMessageChunk so LangChain agent middleware validation passes.
 * Also promotes JSON-in-content tool calls (9router quirk) into native tool_calls.
 */
export function normalizeToAiMessage(
  message: unknown,
): AIMessage | AIMessageChunk {
  // Some handlers return { messages: [...] } or { message }
  const unwrapped = unwrapModelResponse(message);
  return coerceAiMessage(unwrapped);
}

function unwrapModelResponse(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;
  if (isCommand(message)) return message;

  const obj = message as Record<string, unknown>;

  // LangGraph / agent sometimes returns a dict shaped like a message
  if ("messages" in obj && Array.isArray(obj.messages) && obj.messages.length) {
    const last = obj.messages[obj.messages.length - 1];
    if (last != null) return last;
  }
  if ("message" in obj && obj.message != null) {
    return obj.message;
  }
  return message;
}

function coerceAiMessage(message: unknown): AIMessage | AIMessageChunk {
  try {
    if (AIMessageChunk.isInstance(message)) {
      return promoteTextToolCalls(message);
    }
    if (AIMessage.isInstance(message)) {
      return promoteTextToolCalls(message);
    }

    if (ChatMessageChunk.isInstance(message)) {
      const chunk = message as unknown as AIMessageChunk;
      return promoteTextToolCalls(
        new AIMessageChunk({
          content: message.content,
          additional_kwargs: { ...message.additional_kwargs },
          response_metadata: { ...message.response_metadata },
          id: message.id,
          tool_call_chunks: chunk.tool_call_chunks,
        }),
      );
    }

    if (ChatMessage.isInstance(message)) {
      const asAi = message as unknown as AIMessage;
      return promoteTextToolCalls(
        new AIMessage({
          content: message.content,
          additional_kwargs: { ...message.additional_kwargs },
          response_metadata: { ...message.response_metadata },
          id: message.id,
          tool_calls: asAi.tool_calls,
          invalid_tool_calls: asAi.invalid_tool_calls,
        }),
      );
    }

    if (message && typeof message === "object") {
      const anyMsg = message as {
        type?: string;
        role?: string;
        content?: AIMessage["content"];
        additional_kwargs?: Record<string, unknown>;
        response_metadata?: Record<string, unknown>;
        id?: string;
        tool_calls?: AIMessage["tool_calls"];
        invalid_tool_calls?: AIMessage["invalid_tool_calls"];
        tool_call_chunks?: AIMessageChunk["tool_call_chunks"];
        text?: unknown;
        kwargs?: { content?: unknown };
        lc_kwargs?: { content?: unknown };
      };

      const content = extractContent(anyMsg);

      if (anyMsg.tool_call_chunks?.length) {
        return promoteTextToolCalls(
          new AIMessageChunk({
            content,
            additional_kwargs: anyMsg.additional_kwargs,
            response_metadata: anyMsg.response_metadata,
            id: anyMsg.id,
            tool_call_chunks: anyMsg.tool_call_chunks,
          }),
        );
      }

      return promoteTextToolCalls(
        new AIMessage({
          content,
          additional_kwargs: anyMsg.additional_kwargs,
          response_metadata: anyMsg.response_metadata,
          id: anyMsg.id,
          tool_calls: anyMsg.tool_calls,
          invalid_tool_calls: anyMsg.invalid_tool_calls,
        }),
      );
    }

    return new AIMessage({ content: String(message ?? "") });
  } catch {
    // Last resort — never return a plain object to wrapModelCall.
    return new AIMessage({
      content:
        typeof message === "string"
          ? message
          : safeJson(message) || "(empty model response)",
    });
  }
}

function extractContent(anyMsg: {
  content?: unknown;
  text?: unknown;
  kwargs?: { content?: unknown };
  lc_kwargs?: { content?: unknown };
}): AIMessage["content"] {
  const raw =
    anyMsg.content ??
    anyMsg.text ??
    anyMsg.kwargs?.content ??
    anyMsg.lc_kwargs?.content ??
    "";
  if (typeof raw === "string" || Array.isArray(raw)) {
    return raw as AIMessage["content"];
  }
  if (raw == null) return "";
  return String(raw);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * If the model dumped tool JSON into content (and tool_calls is empty),
 * lift it into native tool_calls so the ReAct loop continues.
 */
export function promoteTextToolCalls(
  message: AIMessage | AIMessageChunk,
): AIMessage | AIMessageChunk {
  const existing =
    "tool_calls" in message && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];
  if (existing.length > 0) {
    // Already a proper instance from this package — keep identity for callers/tests.
    if (AIMessageChunk.isInstance(message) || AIMessage.isInstance(message)) {
      return message;
    }
    return new AIMessage({
      content: (message as AIMessage).content ?? "",
      tool_calls: existing,
    });
  }

  const parsed = parseTextToolCalls(message.content);
  if (parsed.length === 0) {
    return message;
  }

  if (AIMessageChunk.isInstance(message)) {
    return new AIMessageChunk({
      content: "",
      additional_kwargs: { ...message.additional_kwargs },
      response_metadata: {
        ...message.response_metadata,
        text_tool_calls_promoted: true,
      },
      id: message.id,
      tool_calls: parsed,
      tool_call_chunks: parsed.map((tc, index) => ({
        name: tc.name,
        args: JSON.stringify(tc.args),
        id: tc.id,
        index,
        type: "tool_call_chunk" as const,
      })),
    });
  }

  return new AIMessage({
    content: "",
    additional_kwargs: { ...message.additional_kwargs },
    response_metadata: {
      ...message.response_metadata,
      text_tool_calls_promoted: true,
    },
    id: message.id,
    tool_calls: parsed,
  });
}

/**
 * Must sit *inside* MemoryMiddleware in the wrapModelCall chain
 * (later in the middleware array = closer to the model).
 */
export function createNormalizeAiMessageMiddleware() {
  return createMiddleware({
    name: "NormalizeAiMessageMiddleware",
    wrapModelCall: async (request, handler) => {
      let response: unknown;
      try {
        response = await handler(request);
      } catch (err) {
        throw rewriteProviderSdkCrash(err);
      }
      if (isCommand(response)) return response;
      try {
        const normalized = normalizeToAiMessage(response as BaseMessage);
        // Guarantee instanceof AIMessage for middleware validators (avoid cross-copy duck types).
        if (
          AIMessageChunk.isInstance(normalized) ||
          AIMessage.isInstance(normalized)
        ) {
          return normalized;
        }
        return new AIMessage({ content: String(normalized ?? "") });
      } catch (err) {
        throw rewriteProviderSdkCrash(err);
      }
    },
  });
}

/** 9router / OpenAI SDK sometimes throws TypeError on malformed error payloads. */
export function rewriteProviderSdkCrash(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /cannot read propert(?:y|ies) of undefined \(reading ['"]message['"]\)/i.test(
      msg,
    )
  ) {
    return new Error(
      "Model/provider returned a malformed error payload (missing error.message). " +
        "Retry the turn, or check ROUTER_BASE_URL / AGENT_MODEL health. " +
        `Original: ${msg}`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
