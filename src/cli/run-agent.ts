import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DeepAgent } from "deepagents";
import type { PersistentMemoryStore } from "../memory/persistent-store.js";
import type { SessionStore } from "../memory/session-store.js";
import type { EmbeddingClient } from "../memory/embeddings.js";
import {
  agentsMdPathFor,
  reflectAndStore,
} from "../memory/reflection.js";
import {
  looksLikeIncompleteReasoning,
  looksLikeProviderNotice,
  resolveFinalAssistantText,
  sanitizeAssistantText,
} from "../agent/sanitize-output.js";
import { contentLooksLikeTextToolCall } from "../agent/parse-text-tool-calls.js";
import {
  parseDesktopIntent,
  enrichDesktopIntent,
  extractDesktopFollowUp,
  buildDesktopFollowUpPrompt,
  isPlayMusicFollowUp,
} from "../desktop/intent.js";
import { runDesktopAction } from "../desktop/actions.js";
import {
  isDesktopAutomationEnabled,
  isDesktopAutomationSupported,
} from "../desktop/macos.js";

type DesktopFastPathResult =
  | { type: "complete"; answer: string }
  | {
      type: "continue";
      openedSummary: string;
      followUpPrompt: string;
    };

export type MemoryRuntime = {
  sessionStore: SessionStore;
  memoryStore: PersistentMemoryStore;
  embedder: EmbeddingClient;
  model: BaseChatModel;
  workspaceRoot: string;
  enableReflection?: boolean;
};

import {
  extractInterruptActionNames,
  isPlanApprovalInterrupt,
} from "../agent/interrupt-utils.js";

export type ApprovalDecision = {
  decisions: Array<{ type: "approve" | "reject" }>;
};

export {
  extractInterruptActionNames,
  isPlanApprovalInterrupt,
} from "../agent/interrupt-utils.js";

export type MultimodalUserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type RunAgentOptions = {
  agent: DeepAgent;
  prompt: string;
  /**
   * Optional multimodal user content (text + images). When set, this is sent
   * to the model instead of a plain string (after botInstruction wrapping).
   * Transcript still stores the text `prompt`.
   */
  userContent?: string | MultimodalUserPart[];
  threadId?: string;
  /** Stamp session meta; null = global, undefined = leave existing. */
  projectId?: string | null;
  autoApprove?: boolean;
  onEvent?: (event: AgentUiEvent) => void;
  /**
   * Custom HITL approval (e.g. Ink TUI). When omitted, falls back to stdin y/N.
   * Must resolve with approve/reject — do not leave hanging forever without UI.
   */
  requestApproval?: (payload: unknown) => Promise<ApprovalDecision>;
  /** When set, persists raw transcript + optional LTM reflection. */
  memory?: MemoryRuntime;
  /**
   * When true (macOS + DESKTOP_AUTOMATION), Chrome open intents bypass the LLM
   * and call desktop_automate directly (models often refuse computer control).
   */
  desktopEnabled?: boolean;
  /**
   * Specialized bot scope instruction. Injected into the LLM turn only —
   * the transcript stores the raw user `prompt`.
   */
  botInstruction?: string;
};

export type AgentPhase =
  | "boot"
  | "thinking"
  | "reasoning"
  | "tool"
  | "pty"
  | "waiting_approval"
  | "reflecting"
  | "done"
  | "error";

export type AgentUiEvent =
  | { type: "status"; phase: AgentPhase; detail: string }
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_start"; name: string; input: unknown }
  | { type: "tool_end"; name: string; output: string }
  | { type: "interrupt"; payload: unknown }
  | { type: "context_compacted"; detail: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string }
  | { type: "reflection"; memoryIds: string[] }
  | { type: "warning"; message: string }
  | { type: "pty"; text: string };

function extractText(content: unknown): string {
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

/** Prefer the last substantive assistant message; strip leaked CoT / think tags. */
function pickFinalAssistantText(messages: unknown[]): string {
  let finalText = "";
  let fallback = "";
  for (const message of messages) {
    if (
      !(AIMessage.isInstance(message) || AIMessageChunk.isInstance(message))
    ) {
      continue;
    }
    if (message.tool_calls?.length) continue;
    const text = sanitizeAssistantText(extractText(message.content));
    if (!text) continue;
    if (contentLooksLikeTextToolCall(text)) continue;
    fallback = text;
    if (!looksLikeIncompleteReasoning(text)) {
      finalText = text;
    }
  }
  return finalText || fallback;
}

async function promptApproval(payload: unknown): Promise<ApprovalDecision> {
  const rl = readline.createInterface({ input, output });
  try {
    output.write("\n⚠️  Human approval required:\n");
    output.write(`${JSON.stringify(payload, null, 2)}\n`);
    const answer = (await rl.question("Approve? [y/N] ")).trim().toLowerCase();
    const approved = answer === "y" || answer === "yes";
    return {
      decisions: [{ type: approved ? "approve" : "reject" }],
    };
  } finally {
    rl.close();
  }
}

function getInterruptPayload(result: unknown): unknown | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if ("__interrupt__" in record) return record.__interrupt__;
  if (Array.isArray(record.tasks)) {
    for (const task of record.tasks as Array<Record<string, unknown>>) {
      if (task && "__interrupt__" in task) return task.__interrupt__;
      if (task?.interrupts) return task.interrupts;
    }
  }
  return null;
}

function emit(
  onEvent: RunAgentOptions["onEvent"],
  event: AgentUiEvent,
): void {
  onEvent?.(event);
}

/** Activity events worth keeping in session.jsonl (skip token/reasoning spam). */
function shouldPersistActivity(event: AgentUiEvent): boolean {
  switch (event.type) {
    case "tool_start":
    case "tool_end":
    case "warning":
    case "error":
    case "interrupt":
    case "context_compacted":
    case "reflection":
      return true;
    case "status":
      return event.phase !== "thinking" && event.phase !== "reasoning";
    default:
      return false;
  }
}

function sanitizeEventForPersist(event: AgentUiEvent): AgentUiEvent {
  if (event.type === "tool_start") {
    return {
      type: "tool_start",
      name: event.name,
      input: truncate(event.input, 1200),
    };
  }
  if (event.type === "tool_end") {
    return {
      type: "tool_end",
      name: event.name,
      output: truncate(event.output, 1200),
    };
  }
  if (event.type === "interrupt") {
    return {
      type: "interrupt",
      payload: truncate(event.payload, 1200),
    };
  }
  if (event.type === "error") {
    return { type: "error", message: truncate(event.message, 800) };
  }
  if (event.type === "warning") {
    return { type: "warning", message: truncate(event.message, 800) };
  }
  return event;
}

function activitySummary(event: AgentUiEvent): string {
  switch (event.type) {
    case "tool_start":
      return `tool_start:${event.name}`;
    case "tool_end":
      return `tool_end:${event.name}`;
    case "status":
      return `status:${event.phase}:${event.detail}`;
    case "warning":
      return `warning:${event.message}`;
    case "error":
      return `error:${event.message}`;
    case "interrupt":
      return "interrupt";
    case "context_compacted":
      return `context_compacted:${event.detail}`;
    case "reflection":
      return `reflection:${event.memoryIds.join(",")}`;
    default:
      return event.type;
  }
}

/** Append durable activity row so Live activity can restore after reload. */
export function persistActivityEvent(
  store: SessionStore | undefined,
  threadId: string,
  event: AgentUiEvent,
): void {
  if (!store || !shouldPersistActivity(event)) return;
  const uiEvent = sanitizeEventForPersist(event);
  store.appendTranscript({
    threadId,
    role: "tool",
    content: activitySummary(uiEvent),
    meta: { uiEvent },
  });
}

function truncate(value: unknown, max = 240): string {
  let text: string;
  try {
    text =
      typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/**
 * Prefer Deep Agents streamEvents(v3) for live progress; fall back to invoke.
 */
async function runOnce(
  agent: DeepAgent,
  inputPayload: Record<string, unknown> | Command,
  config: { configurable: { thread_id: string }; recursionLimit: number },
  onEvent?: RunAgentOptions["onEvent"],
): Promise<{ result: unknown; streamedText: string }> {
  emit(onEvent, {
    type: "status",
    phase: "thinking",
    detail: "waiting for model…",
  });

  const streamFn = (
    agent as DeepAgent & {
      streamEvents?: (
        input: unknown,
        cfg: Record<string, unknown>,
      ) => Promise<{
        messages: AsyncIterable<{
          text?: AsyncIterable<string>;
          reasoning?: AsyncIterable<string>;
        }>;
        toolCalls: AsyncIterable<{
          name: string;
          input: unknown;
          output: Promise<unknown> | unknown;
        }>;
        output: Promise<unknown>;
      }>;
    }
  ).streamEvents;

  if (typeof streamFn === "function") {
    try {
      const run = await streamFn.call(agent, inputPayload, {
        ...config,
        version: "v3",
      });

      let streamedText = "";
      const pumps: Promise<void>[] = [];

      pumps.push(
        (async () => {
          for await (const msg of run.messages) {
            emit(onEvent, {
              type: "status",
              phase: "thinking",
              detail: "model generating…",
            });
            if (msg.reasoning) {
              for await (const chunk of msg.reasoning) {
                if (!chunk) continue;
                emit(onEvent, {
                  type: "status",
                  phase: "reasoning",
                  detail: "reasoning…",
                });
                emit(onEvent, { type: "reasoning", text: chunk });
              }
            }
            if (msg.text) {
              for await (const chunk of msg.text) {
                if (!chunk) continue;
                const cleaned = sanitizeAssistantText(chunk);
                if (!cleaned && chunk.includes("<think")) continue;
                streamedText += chunk;
                emit(onEvent, { type: "token", text: chunk });
              }
            }
          }
        })(),
      );

      pumps.push(
        (async () => {
          for await (const call of run.toolCalls) {
            emit(onEvent, {
              type: "status",
              phase: "tool",
              detail: `tool ${call.name}`,
            });
            emit(onEvent, {
              type: "tool_start",
              name: call.name,
              input: call.input,
            });
            if (call.name === "execute") {
              emit(onEvent, {
                type: "status",
                phase: "pty",
                detail: "PTY pool · running command",
              });
            }
            try {
              const out = await Promise.resolve(call.output);
              const text = truncate(out, 400);
              emit(onEvent, {
                type: "tool_end",
                name: call.name,
                output: text,
              });
              if (call.name === "execute") {
                // Slot released back to the pool — resume thinking, not "shell busy".
                emit(onEvent, {
                  type: "status",
                  phase: "thinking",
                  detail: "PTY pool · slot free",
                });
              }
            } catch (err) {
              emit(onEvent, {
                type: "tool_end",
                name: call.name,
                output: `error: ${err instanceof Error ? err.message : String(err)}`,
              });
              if (call.name === "execute") {
                emit(onEvent, {
                  type: "status",
                  phase: "thinking",
                  detail: "PTY pool · slot free",
                });
              }
            }
          }
        })(),
      );

      await Promise.all(pumps);
      const result = await run.output;
      return { result, streamedText: sanitizeAssistantText(streamedText) };
    } catch (err) {
      // Fall through to invoke if v3 stream is unavailable / quirky.
      emit(onEvent, {
        type: "status",
        phase: "thinking",
        detail: `stream unavailable, using invoke (${err instanceof Error ? err.message.slice(0, 80) : "error"})`,
      });
    }
  }

  const result = await agent.invoke(inputPayload, config);
  return { result, streamedText: "" };
}

const RETRY_MAX = 3;
const RETRY_DELAY_MS = 3_000;

function isModelAvailabilityError(text: string): boolean {
  return looksLikeProviderNotice(text);
}

export async function runAgentTurn(
  options: RunAgentOptions,
): Promise<string> {
  const threadId = options.threadId ?? `thread-${Date.now()}`;
  const mem = options.memory;
  const userOnEvent = options.onEvent;
  const onEvent: RunAgentOptions["onEvent"] = (event) => {
    try {
      persistActivityEvent(mem?.sessionStore, threadId, event);
    } catch {
      // Persist must never break the live UI stream.
    }
    userOnEvent?.(event);
  };
  options = { ...options, threadId, onEvent };

  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: 80,
  };

  if (mem) {
    const modelName = process.env.AGENT_MODEL ?? "gpt-4o";
    mem.sessionStore.startOrResume({
      threadId,
      model: modelName,
      projectId: options.projectId,
    });
    mem.sessionStore.markTurnStart(options.prompt);
    mem.sessionStore.appendTranscript({
      threadId,
      role: "user",
      content: options.prompt,
    });
  }

  // Deterministic Chrome/desktop path — open URL first; continue LLM for leftovers.
  const desktopPrep = await tryDesktopFastPath(options, threadId);
  if (desktopPrep?.type === "complete") {
    return desktopPrep.answer;
  }

  const scopedUserPrompt = options.botInstruction
    ? `${options.botInstruction}\n\n[USER]\n${options.prompt}`
    : options.prompt;

  const scopedUserContent: string | MultimodalUserPart[] = (() => {
    const raw = options.userContent;
    if (raw == null) return scopedUserPrompt;
    if (typeof raw === "string") {
      return options.botInstruction
        ? `${options.botInstruction}\n\n[USER]\n${raw}`
        : raw;
    }
    if (!Array.isArray(raw) || raw.length === 0) return scopedUserPrompt;
    if (!options.botInstruction) return raw;
    const parts = [...raw];
    const firstText = parts.findIndex((p) => p.type === "text");
    if (firstText >= 0) {
      const t = parts[firstText] as { type: "text"; text: string };
      parts[firstText] = {
        type: "text",
        text: `${options.botInstruction}\n\n[USER]\n${t.text}`,
      };
      return parts;
    }
    return [
      { type: "text" as const, text: `${options.botInstruction}\n\n[USER]` },
      ...parts,
    ];
  })();

  let finalText = "";
  let retryCount = 0;
  let inputPayload: Record<string, unknown> | Command = desktopPrep
    ? {
        messages: [
          { role: "user", content: scopedUserContent },
          {
            role: "assistant",
            content: desktopPrep.openedSummary,
          },
          { role: "user", content: desktopPrep.followUpPrompt },
        ],
      }
    : {
        messages: [{ role: "user", content: scopedUserContent }],
      };

  let lastStreamedText = "";
  try {
    for (;;) {
      const { result, streamedText } = await runOnce(
        options.agent,
        inputPayload,
        config,
        options.onEvent,
      );
      lastStreamedText = streamedText;
      const interrupt = getInterruptPayload(result);
      if (interrupt) {
        const planGate = isPlanApprovalInterrupt(interrupt);
        emit(options.onEvent, {
          type: "status",
          phase: "waiting_approval",
          detail: planGate
            ? "plan approval required"
            : "human approval required",
        });
        emit(options.onEvent, { type: "interrupt", payload: interrupt });
        mem?.sessionStore.appendTranscript({
          threadId,
          role: "interrupt",
          content: JSON.stringify(interrupt).slice(0, 4000),
          meta: planGate ? { kind: "plan_approval" } : undefined,
        });
        // Plan gate always needs an explicit UI/stdin decision — never silent autoApprove.
        const resumeValue =
          options.autoApprove && !planGate
            ? { decisions: [{ type: "approve" as const }] }
            : options.requestApproval
              ? await options.requestApproval(interrupt)
              : await promptApproval(interrupt);
        inputPayload = new Command({ resume: resumeValue });
        continue;
      }

      const messages = (result as { messages?: unknown[] })?.messages ?? [];
      for (const message of messages) {
        if (
          message &&
          typeof message === "object" &&
          "_summarizationEvent" in message
        ) {
          emit(options.onEvent, {
            type: "context_compacted",
            detail: "conversation summarized; continuing in next window",
          });
        }
      }

      finalText = pickFinalAssistantText(messages) || streamedText;
      // If we only have invoke (no stream tokens), push the full answer once.
      if (finalText && !streamedText) {
        emit(options.onEvent, { type: "token", text: finalText });
      }
      if (looksLikeIncompleteReasoning(finalText)) {
        emit(options.onEvent, {
          type: "warning",
          message:
            "Model returned unfinished reasoning instead of a final answer. Retry or switch AGENT_MODEL.",
        });
      }

      // Auto-retry on model availability errors (e.g. "Gemini 3.5 Flash is no longer available")
      if (finalText && isModelAvailabilityError(finalText)) {
        retryCount++;
        if (retryCount <= RETRY_MAX) {
          emit(options.onEvent, {
            type: "warning",
            message: `Model unavailable (attempt ${retryCount}/${RETRY_MAX}). Retrying in ${RETRY_DELAY_MS / 1000}s…`,
          });
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          // Re-use same input payload (fresh user message) so the model re-reads the request
          finalText = "";
          continue;
        }
        // Exhausted retries — fall through and return the error as-is
      }
      break;
    }

    const answer = resolveFinalAssistantText(finalText, lastStreamedText).trim();
    if (mem) {
      mem.sessionStore.markTurnComplete(answer);
      mem.sessionStore.appendTranscript({
        threadId,
        role: "assistant",
        content: answer,
      });
    }

    // Unlock the UI as soon as the answer is ready. Reflection is background work.
    emit(options.onEvent, {
      type: "status",
      phase: "done",
      detail: "turn complete",
    });
    emit(options.onEvent, { type: "done", text: answer });

    if (mem && mem.enableReflection !== false) {
      void reflectAndStore({
        store: mem.memoryStore,
        sessionStore: mem.sessionStore,
        embedder: mem.embedder,
        model: mem.model,
        agentsMdPath: agentsMdPathFor(mem.workspaceRoot),
        input: {
          threadId,
          userPrompt: options.prompt,
          assistantResponse: answer || "(empty)",
          hadError: false,
          skipEpisode:
            looksLikeIncompleteReasoning(answer) ||
            contentLooksLikeTextToolCall(answer),
        },
      })
        .then(({ storedIds }) => {
          emit(options.onEvent, {
            type: "reflection",
            memoryIds: storedIds,
          });
        })
        .catch(() => {
          // Reflection must not break the turn.
        });
    }

    return answer;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(options.onEvent, {
      type: "status",
      phase: "error",
      detail: message,
    });
    emit(options.onEvent, { type: "error", message });
    if (mem) {
      mem.sessionStore.markTurnError(message);
      mem.sessionStore.appendTranscript({
        threadId,
        role: "error",
        content: message,
      });
      if (mem.enableReflection !== false) {
        void reflectAndStore({
          store: mem.memoryStore,
          sessionStore: mem.sessionStore,
          embedder: mem.embedder,
          model: mem.model,
          agentsMdPath: agentsMdPathFor(mem.workspaceRoot),
          input: {
            threadId,
            userPrompt: options.prompt,
            assistantResponse: finalText || "(failed before response)",
            hadError: true,
            errorMessage: message,
          },
        })
          .then(({ storedIds }) => {
            emit(options.onEvent, {
              type: "reflection",
              memoryIds: storedIds,
            });
          })
          .catch(() => {
            // ignore
          });
      }
    }
    throw err;
  }
}

/**
 * Bypass the LLM for the open-Chrome/URL step. If the user also asked for
 * follow-up UI work (play song, search, …), return continue so the agent loop
 * finishes the rest with desktop_automate keystrokes.
 */
async function tryDesktopFastPath(
  options: RunAgentOptions,
  threadId: string,
): Promise<DesktopFastPathResult | null> {
  const enabled =
    options.desktopEnabled ??
    (isDesktopAutomationEnabled() && isDesktopAutomationSupported());
  if (!enabled) return null;

  const rawIntent = parseDesktopIntent(options.prompt);
  if (!rawIntent) return null;
  const intent = enrichDesktopIntent(rawIntent, options.prompt);
  const followUp = extractDesktopFollowUp(options.prompt, rawIntent);

  const workspaceRoot =
    options.memory?.workspaceRoot ?? process.env.AGENT_WORKSPACE ?? process.cwd();

  const toolInput =
    intent.kind === "open_url"
      ? {
          action: "open_url" as const,
          app: intent.app,
          url: intent.url,
        }
      : {
          action: "open_app" as const,
          app: intent.app,
        };

  const onEvent = options.onEvent;
  emit(onEvent, {
    type: "status",
    phase: "tool",
    detail: "desktop_automate (fast-path)",
  });
  emit(onEvent, {
    type: "tool_start",
    name: "desktop_automate",
    input: toolInput,
  });

  const interruptPayload = {
    actionRequests: [
      {
        name: "desktop_automate",
        args: toolInput,
        description:
          intent.kind === "open_url"
            ? `Open ${intent.url} in ${intent.app}`
            : `Open application ${intent.app}`,
      },
    ],
  };

  emit(onEvent, {
    type: "status",
    phase: "waiting_approval",
    detail: "desktop action requires approval",
  });
  emit(onEvent, { type: "interrupt", payload: interruptPayload });

  const mem = options.memory;
  mem?.sessionStore.appendTranscript({
    threadId,
    role: "interrupt",
    content: JSON.stringify(interruptPayload).slice(0, 4000),
  });

  const decision = options.autoApprove
    ? { decisions: [{ type: "approve" as const }] }
    : options.requestApproval
      ? await options.requestApproval(interruptPayload)
      : await promptApproval(interruptPayload);

  const approved = decision.decisions.some((d) => d.type === "approve");
  if (!approved) {
    const answer =
      "Dibatalkan — aksi desktop tidak dijalankan (approval ditolak).";
    emit(onEvent, {
      type: "tool_end",
      name: "desktop_automate",
      output: "rejected by user",
    });
    await finishDesktopTurn(options, threadId, answer, false);
    return { type: "complete", answer };
  }

  const result = await runDesktopAction(workspaceRoot, toolInput);
  emit(onEvent, {
    type: "tool_end",
    name: "desktop_automate",
    output: result.message,
  });

  if (!result.ok) {
    const answer = `Gagal desktop_automate: ${result.message}`;
    await finishDesktopTurn(options, threadId, answer, true);
    return { type: "complete", answer };
  }

  const openedSummary =
    intent.kind === "open_url"
      ? `Sudah membuka ${intent.url} di ${intent.app}.`
      : `Sudah membuka ${intent.app}.`;

  // YouTube + play/viral: open search results, wait, click first video.
  const playMusic =
    intent.kind === "open_url" &&
    /youtube\.com\/results/i.test(intent.url) &&
    isPlayMusicFollowUp(followUp);

  if (playMusic) {
    emit(onEvent, {
      type: "status",
      phase: "tool",
      detail: "waiting for YouTube results…",
    });
    await new Promise((r) => setTimeout(r, 2800));
    emit(onEvent, {
      type: "tool_start",
      name: "desktop_automate",
      input: { action: "youtube_play_first", app: intent.app },
    });
    const play = await runDesktopAction(workspaceRoot, {
      action: "youtube_play_first",
      app: intent.app,
    });
    emit(onEvent, {
      type: "tool_end",
      name: "desktop_automate",
      output: play.message,
    });
    const answer = play.ok
      ? `${openedSummary}\n${play.message}\nLagu/video pertama dari hasil pencarian sudah diklik — cek Chrome.`
      : `${openedSummary}\nGagal memutar hasil pertama: ${play.message}`;
    await finishDesktopTurn(options, threadId, answer, !play.ok);
    return { type: "complete", answer };
  }

  // Brief pause so the page can load before follow-up keystrokes.
  if (followUp) {
    await new Promise((r) => setTimeout(r, 1500));
    emit(onEvent, {
      type: "status",
      phase: "thinking",
      detail: "continuing remaining desktop request…",
    });
    emit(onEvent, { type: "token", text: `${openedSummary}\n` });
    return {
      type: "continue",
      openedSummary,
      followUpPrompt: buildDesktopFollowUpPrompt({
        openedSummary,
        followUp,
        app: intent.app,
      }),
    };
  }

  await finishDesktopTurn(options, threadId, openedSummary, false);
  return { type: "complete", answer: openedSummary };
}

async function finishDesktopTurn(
  options: RunAgentOptions,
  threadId: string,
  answer: string,
  hadError: boolean,
): Promise<void> {
  const mem = options.memory;
  const onEvent = options.onEvent;
  if (mem) {
    mem.sessionStore.markTurnComplete(answer);
    mem.sessionStore.appendTranscript({
      threadId,
      role: "assistant",
      content: answer,
    });
  }

  emit(onEvent, { type: "status", phase: "done", detail: "turn complete" });
  emit(onEvent, { type: "token", text: answer });
  emit(onEvent, { type: "done", text: answer });

  if (mem && mem.enableReflection !== false) {
    void reflectAndStore({
      store: mem.memoryStore,
      sessionStore: mem.sessionStore,
      embedder: mem.embedder,
      model: mem.model,
      agentsMdPath: agentsMdPathFor(mem.workspaceRoot),
      input: {
        threadId,
        userPrompt: options.prompt,
        assistantResponse: answer,
        hadError,
      },
    })
      .then(({ storedIds }) => {
        emit(onEvent, { type: "reflection", memoryIds: storedIds });
      })
      .catch(() => {
        /* ignore */
      });
  }
}
