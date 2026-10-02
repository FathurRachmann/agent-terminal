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
  looksLikeToolPlanNarration,
  resolveFinalAssistantText,
  sanitizeAssistantText,
  extractSuggestedModel,
} from "../agent/sanitize-output.js";
import { isMalformedProviderSdkError } from "../agent/normalize-middleware.js";
import { contentLooksLikeTextToolCall } from "../agent/parse-text-tool-calls.js";
import {
  greetingFastReply,
  isTrivialGreeting,
} from "../agent/greeting-fast-path.js";
import {
  parseDesktopIntent,
  enrichDesktopIntent,
  extractDesktopFollowUp,
  buildDesktopFollowUpPrompt,
  isPlayMusicFollowUp,
} from "../desktop/intent.js";
import { runDesktopAction } from "../desktop/actions.js";
import {
  formatToolEndOutput,
  truncateOneLine,
} from "../agent/tool-end-output.js";
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
  /** Profile home for AGENTS.md / reflection sync. Falls back to workspaceRoot. */
  profileHome?: string;
  enableReflection?: boolean;
};

import {
  buildApprovalDecisions,
  extractInterruptActionNames,
  formatToolApprovalDetail,
  isFolderAccessInterrupt,
  isPlanApprovalInterrupt,
  normalizeApprovalDecision,
  requiresExplicitApproval,
} from "../agent/interrupt-utils.js";
import {
  chatModeSystemOverlay,
  chatModeToolAllowlist,
  intersectAllowlists,
  parseAgentChatMode,
} from "../agent/chat-mode.js";
import { tryAutoResolveRunModeInterrupt } from "../agent/run-mode-approval.js";
import { resolveRunMode } from "../agent/run-modes.js";
import { buildMentionContextNudge } from "../agent/context-mentions.js";
import { runHooks } from "../agent/hooks/run-hooks.js";
import { loadMergedPermissions } from "../agent/permissions-store.js";

export type ApprovalDecision = {
  decisions: Array<{ type: "approve" | "reject" }>;
};

export {
  extractInterruptActionNames,
  formatToolApprovalDetail,
  isFolderAccessInterrupt,
  isPlanApprovalInterrupt,
  requiresExplicitApproval,
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
  /**
   * LangGraph checkpointer thread id. Defaults to `threadId`.
   * Workspace parallel bots use `${groupThreadId}__${botId}` here while
   * keeping `threadId` as the shared group transcript id.
   */
  checkpointThreadId?: string;
  /** Stamp session meta; null = global, undefined = leave existing. */
  projectId?: string | null;
  workspaceId?: string | null;
  chatId?: string | null;
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
  /**
   * Injected each turn — tells the model which tmp/<scope>/ folder to use.
   * Combined with botInstruction when both are set.
   */
  workingScopeNudge?: string;
  /** Extra transcript meta for assistant messages (workspace group bots). */
  assistantMeta?: Record<string, unknown>;
  /** Tags for reflection isolation (workspace:/bot:). */
  memoryScopeTags?: string[];
  /** When true, do not append the user prompt to the transcript (multi-bot follow-ups). */
  skipUserTranscript?: boolean;
  /**
   * Optional botScope bridge so this turn can apply a decision-engine tool allowlist
   * (main session, workspace bots, WhatsApp — same path).
   */
  toolScope?: {
    get: () => string[] | null;
    set: (tools: string[] | null) => void;
  };
  /** Skip tools/agent turn-scope (e.g. self-heal). */
  skipTurnScope?: boolean;
  /** Cursor-style chat mode (orthogonal to agentKind). */
  chatMode?: import("../agent/chat-mode.js").AgentChatMode;
  /** Live Run Mode + allowlist (from agent bundle). */
  runMode?: {
    getRunMode: () => import("../agent/run-modes.js").RunMode;
    getAllowlist: () => string[];
  };
  /**
   * Live Privacy toggle. When false, `request_folder_access` auto-approves
   * (whole-machine sandbox). When true, folder grants need explicit HITL.
   */
  isPrivacyStrict?: () => boolean;
  /** Plan mode Build gate — unlock after task_todos Approve. */
  planGate?: {
    isUnlocked: () => boolean;
    unlock: () => void;
  };
  /** Recent PTY/terminal log for @Terminals mentions. */
  terminalLog?: string;
  /** Optional prior chat transcript for @Chats. */
  chatTranscript?: string;
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
  | { type: "pty"; text: string }
  | {
      type: "job_progress";
      text: string;
      path: string;
      fraction?: number | null;
      done?: boolean;
    }
  | {
      type: "continue_available";
      reason: "model_unavailable" | "self_heal";
      /** Last user prompt to resume. */
      prompt: string;
      /** Suggested replacement model from the provider notice, if any. */
      suggestedModel?: string | null;
      notice?: string;
    };

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
      decisions: buildApprovalDecisions(
        approved ? "approve" : "reject",
        payload,
      ),
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

function hasNonTextUserContent(
  content: string | MultimodalUserPart[] | undefined,
): boolean {
  if (!content || typeof content === "string") return false;
  return content.some(
    (part) => part && typeof part === "object" && part.type !== "text",
  );
}

function finishGreetingFastPath(
  options: RunAgentOptions,
  threadId: string,
  mem: MemoryRuntime | undefined,
  onEvent: RunAgentOptions["onEvent"],
): string {
  const answer = greetingFastReply(options.prompt);
  emit(onEvent, {
    type: "status",
    phase: "thinking",
    detail: "greeting fast-path (no LLM)",
  });
  emit(onEvent, { type: "token", text: answer });
  if (mem) {
    mem.sessionStore.markTurnComplete(answer, threadId);
    mem.sessionStore.appendTranscript({
      threadId,
      role: "assistant",
      content: answer,
      meta: { ...(options.assistantMeta ?? {}), greetingFastPath: true },
    });
  }
  emit(onEvent, {
    type: "status",
    phase: "done",
    detail: "greeting fast-path",
  });
  emit(onEvent, { type: "done", text: answer });
  // No reflectAndStore — greetings must not burn another model call or memory write.
  return answer;
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
      input: truncateOneLine(event.input, 1200),
    };
  }
  if (event.type === "tool_end") {
    return {
      type: "tool_end",
      name: event.name,
      output: formatToolEndOutput(event.name, event.output, 1200),
    };
  }
  if (event.type === "interrupt") {
    return {
      type: "interrupt",
      payload: truncateOneLine(event.payload, 1200),
    };
  }
  if (event.type === "error") {
    return { type: "error", message: truncateOneLine(event.message, 800) };
  }
  if (event.type === "warning") {
    return { type: "warning", message: truncateOneLine(event.message, 800) };
  }
  return event;
}

/**
 * Chat-only "ya saya izinkan" does not expand the sandbox. Nudge the model to
 * call request_folder_access so the Approve/Deny interrupt UI appears.
 */
export function looksLikeVerbalFolderPermission(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 160) return false;
  if (/\b(izin(kan)?|silakan|silahkan)\b/.test(t)) return true;
  if (
    /\b(grant|allow|approve)\b[\s\S]{0,40}\b(access|folder|permission)\b/.test(
      t,
    ) ||
    /\b(access|folder|permission)\b[\s\S]{0,40}\b(grant|allow|approve)\b/.test(t)
  ) {
    return true;
  }
  // Short pure affirmatives only (avoid matching "yes, make the PDF…").
  return /^(ya|yes|y|ok|okay|oke|boleh)([\s,.!]*(saya\s*)?(izinkan?|boleh|lanjut(kan)?)?)?[\s!.]*$/.test(
    t,
  );
}

const VERBAL_FOLDER_PERMISSION_NUDGE =
  "[SYSTEM] User granted folder permission in chat. Chat text does not expand the sandbox. " +
  "Call request_folder_access NOW with the folder path they named (e.g. Desktop). " +
  "That tool opens the Approve/Deny UI — wait for Approve, then continue the file/shell work.";

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
              const text = formatToolEndOutput(call.name, out, 400);
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
  const checkpointThreadId = options.checkpointThreadId ?? threadId;
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
    configurable: { thread_id: checkpointThreadId },
    recursionLimit: 80,
  };

  if (mem) {
    const modelName = process.env.AGENT_MODEL ?? "gpt-4o";
    mem.sessionStore.startOrResume({
      threadId,
      model: modelName,
      projectId: options.projectId,
      workspaceId: options.workspaceId,
      chatId: options.chatId,
    });
    if (!options.skipUserTranscript) {
      mem.sessionStore.markTurnStart(options.prompt, threadId);
      mem.sessionStore.appendTranscript({
        threadId,
        role: "user",
        content: options.prompt,
      });
    }
  }

  // Pure greetings → local reply (0 model tokens). No tools, no Laya, no reflection.
  if (
    isTrivialGreeting(options.prompt) &&
    !hasNonTextUserContent(options.userContent)
  ) {
    return finishGreetingFastPath(options, threadId, mem, onEvent);
  }

  // Cursor hooks: beforeSubmitPrompt can block or inject additional_context.
  let hookContextNudge = "";
  if (mem?.workspaceRoot) {
    try {
      const hookResult = await runHooks({
        name: "beforeSubmitPrompt",
        workspaceRoot: mem.workspaceRoot,
        profileHome: mem.profileHome,
        payload: {
          prompt: options.prompt,
          thread_id: threadId,
          chat_mode: options.chatMode ?? "agent",
        },
        matcherHaystack: options.prompt,
      });
      if (hookResult.continue === false || hookResult.denied) {
        const msg =
          hookResult.user_message ||
          hookResult.agent_message ||
          "Blocked by beforeSubmitPrompt hook.";
        emit(onEvent, { type: "error", message: msg });
        emit(onEvent, { type: "done", text: msg });
        return msg;
      }
      if (hookResult.additional_context?.trim()) {
        hookContextNudge = hookResult.additional_context.trim();
      }
    } catch {
      /* fail open */
    }
  }

  const mentionPack = mem?.workspaceRoot
    ? buildMentionContextNudge(options.prompt, {
        workspaceRoot: mem.workspaceRoot,
        terminalLog: options.terminalLog,
        chatTranscript: options.chatTranscript,
      })
    : { nudge: "", mentions: [] };

  // Deterministic Chrome/desktop path — open URL first; continue LLM for leftovers.
  const desktopPrep = await tryDesktopFastPath(options, threadId);
  if (desktopPrep?.type === "complete") {
    return desktopPrep.answer;
  }

  let turnScopeNudge = "";
  let previousToolAllowlist: string[] | null | undefined;
  const chatMode = parseAgentChatMode(options.chatMode, "agent");
  const modeOverlay = chatModeSystemOverlay(chatMode);
  const modeAllowlist = chatModeToolAllowlist(chatMode, {
    planUnlocked: options.planGate?.isUnlocked() ?? false,
  });

  if (!options.skipTurnScope) {
    try {
      emit(onEvent, {
        type: "status",
        phase: "thinking",
        detail: "scoping tools…",
      });
      const { resolveTurnScope } = await import("../decision/turn-scope.js");
      const base = options.toolScope?.get() ?? null;
      const scopeStarted = Date.now();
      const scope = await resolveTurnScope({
        prompt: options.prompt,
        baseAllowlist: base,
      });
      turnScopeNudge = scope.nudge;
      const layaList = scope.allowlist ?? null;
      const combined = intersectAllowlists(modeAllowlist, layaList);
      if (combined && options.toolScope) {
        previousToolAllowlist = base;
        options.toolScope.set(combined);
        emit(onEvent, {
          type: "status",
          phase: "thinking",
          detail: `turn scope (${scope.source}+${chatMode}, ${Date.now() - scopeStarted}ms): ${scope.reason}`,
        });
      } else if (modeAllowlist && options.toolScope) {
        previousToolAllowlist = base;
        options.toolScope.set(modeAllowlist);
        emit(onEvent, {
          type: "status",
          phase: "thinking",
          detail: `chat mode ${chatMode} tool allowlist`,
        });
      } else if (scope.allowlist && options.toolScope) {
        previousToolAllowlist = base;
        options.toolScope.set(scope.allowlist);
        emit(onEvent, {
          type: "status",
          phase: "thinking",
          detail: `turn scope (${scope.source}, ${Date.now() - scopeStarted}ms): ${scope.reason}`,
        });
      }
    } catch {
      /* fail open — apply mode allowlist only */
      if (modeAllowlist && options.toolScope) {
        previousToolAllowlist = options.toolScope.get();
        options.toolScope.set(modeAllowlist);
      }
    }
  } else if (modeAllowlist && options.toolScope) {
    previousToolAllowlist = options.toolScope.get();
    options.toolScope.set(modeAllowlist);
  }

  // Persona/handoff last so it wins over generic turn-scope nudge (recency).
  const verbalFolderNudge = looksLikeVerbalFolderPermission(options.prompt)
    ? VERBAL_FOLDER_PERMISSION_NUDGE
    : "";
  const turnPrefix = [
    modeOverlay,
    mentionPack.nudge,
    hookContextNudge,
    options.workingScopeNudge,
    turnScopeNudge,
    verbalFolderNudge,
    options.botInstruction,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const scopedUserPrompt = turnPrefix
    ? `${turnPrefix}\n\n[USER]\n${options.prompt}`
    : options.prompt;

  const scopedUserContent: string | MultimodalUserPart[] = (() => {
    const raw = options.userContent;
    if (raw == null) return scopedUserPrompt;
    if (typeof raw === "string") {
      return turnPrefix ? `${turnPrefix}\n\n[USER]\n${raw}` : raw;
    }
    if (!Array.isArray(raw) || raw.length === 0) return scopedUserPrompt;
    if (!turnPrefix) return raw;
    const parts = [...raw];
    const firstText = parts.findIndex((p) => p.type === "text");
    if (firstText >= 0) {
      const t = parts[firstText] as { type: "text"; text: string };
      parts[firstText] = {
        type: "text",
        text: `${turnPrefix}\n\n[USER]\n${t.text}`,
      };
      return parts;
    }
    return [
      { type: "text" as const, text: `${turnPrefix}\n\n[USER]` },
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
      let result: Awaited<ReturnType<typeof runOnce>>["result"];
      let streamedText = "";
      try {
        ({ result, streamedText } = await runOnce(
          options.agent,
          inputPayload,
          config,
          options.onEvent,
        ));
      } catch (invokeErr) {
        if (
          isMalformedProviderSdkError(invokeErr) &&
          retryCount < RETRY_MAX
        ) {
          retryCount++;
          emit(options.onEvent, {
            type: "warning",
            message: `Provider error payload malformed (attempt ${retryCount}/${RETRY_MAX}). Retrying…`,
          });
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw invokeErr;
      }
      lastStreamedText = streamedText;
      const interrupt = getInterruptPayload(result);
      if (interrupt) {
        const planGate = isPlanApprovalInterrupt(interrupt);
        const folderGate = isFolderAccessInterrupt(interrupt);
        // Omit bridge → assume Privacy ON so folder HITL is not silently skipped.
        const privacyOn =
          typeof options.isPrivacyStrict === "function"
            ? options.isPrivacyStrict() === true
            : true;
        const explicitGate = requiresExplicitApproval(interrupt, {
          privacyOn,
        });
        let resumeValue: ApprovalDecision | undefined;

        // Privacy OFF: folder grants expand an already-open allowlist — no HITL UI.
        if (folderGate && !privacyOn && !planGate) {
          resumeValue = {
            decisions: buildApprovalDecisions("approve", interrupt),
          };
          emit(options.onEvent, {
            type: "status",
            phase: "thinking",
            detail: "privacy off — folder access auto-approved",
          });
        } else {
          // Auto-resolve BEFORE emitting waiting_approval so Run Everything /
          // allowlist / classifier never flash a sticky Approve card.
          if (!explicitGate) {
            const runMode =
              options.runMode?.getRunMode() ??
              resolveRunMode({
                autoApproveDestructive: options.autoApprove,
              });
            const perms = mem?.workspaceRoot
              ? loadMergedPermissions({
                  workspaceRoot: mem.workspaceRoot,
                  profileHome: mem.profileHome,
                })
              : null;
            const allowlist = [
              ...(options.runMode?.getAllowlist() ?? []),
              ...(perms?.terminalAllowlist ?? []),
            ];
            const auto = await tryAutoResolveRunModeInterrupt({
              payload: interrupt,
              runMode,
              allowlist,
              chatMode,
              autoApprove: options.autoApprove,
              allowInstructions: perms?.allowInstructions,
              blockInstructions: perms?.blockInstructions,
              mcpAllowlist: perms?.mcpAllowlist,
              privacyOn,
            });
            if (auto) {
              resumeValue = { decisions: auto.decisions };
              emit(options.onEvent, {
                type: "status",
                phase: "thinking",
                detail: `run mode ${auto.source}${auto.verdict ? ` (${auto.verdict})` : ""}`,
              });
            }
          }

          if (!resumeValue) {
            emit(options.onEvent, {
              type: "status",
              phase: "waiting_approval",
              detail: planGate
                ? "plan approval required"
                : folderGate
                  ? formatToolApprovalDetail(interrupt)
                  : "human approval required",
            });
            emit(options.onEvent, { type: "interrupt", payload: interrupt });
            mem?.sessionStore.appendTranscript({
              threadId,
              role: "interrupt",
              content: JSON.stringify(interrupt).slice(0, 4000),
              meta: planGate
                ? { kind: "plan_approval" }
                : folderGate
                  ? { kind: "folder_access" }
                  : undefined,
            });

            resumeValue =
              options.autoApprove && !explicitGate
                ? { decisions: buildApprovalDecisions("approve", interrupt) }
                : options.requestApproval
                  ? await options.requestApproval(interrupt)
                  : await promptApproval(interrupt);
            // HITL requires one decision per hanging tool call.
            resumeValue = normalizeApprovalDecision(resumeValue, interrupt);
          }
        }

        if (
          planGate &&
          resumeValue.decisions.some((d) => d.type === "approve")
        ) {
          options.planGate?.unlock();
          // After Build, expand tools for remainder of this turn if Plan mode.
          if (chatMode === "plan" && options.toolScope) {
            options.toolScope.set(null);
          }
        }

        // Always pad decisions to hanging action count before resume.
        inputPayload = new Command({
          resume: normalizeApprovalDecision(resumeValue, interrupt),
        });
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

      // One auto-retry when the model dumps reply-planning CoT instead of answering.
      if (
        finalText &&
        looksLikeIncompleteReasoning(finalText) &&
        !isModelAvailabilityError(finalText) &&
        retryCount < 1
      ) {
        retryCount++;
        const toolPlan = looksLikeToolPlanNarration(finalText);
        emit(options.onEvent, {
          type: "warning",
          message: toolPlan
            ? "Model narrated tools instead of calling them — retrying with forced tool use…"
            : "Model leaked planning text — retrying for a direct user-facing answer…",
        });
        inputPayload = {
          messages: [
            { role: "user", content: scopedUserContent },
            { role: "assistant", content: finalText },
            {
              role: "user",
              content: toolPlan
                ? "STOP narrating. Call tools NOW (at least `ls`), then reply ONLY with a short final answer in the user's language based on tool results. No English planning. No \"I should use…\". No \"I need to remember…\"."
                : "Stop planning out loud. Reply with ONLY the final user-facing answer in the user's language. No analysis of the greeting, no guidelines commentary, no 'my response should…'.",
            },
          ],
        };
        finalText = "";
        lastStreamedText = "";
        continue;
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
        // Exhausted retries — offer Continue so the user can switch model and resume.
        emit(options.onEvent, {
          type: "continue_available",
          reason: "model_unavailable",
          prompt: options.prompt,
          suggestedModel: extractSuggestedModel(finalText),
          notice: finalText.slice(0, 500),
        });
      }
      break;
    }

    const answer = resolveFinalAssistantText(finalText, lastStreamedText).trim();
    if (mem) {
      mem.sessionStore.markTurnComplete(answer, threadId);
      mem.sessionStore.appendTranscript({
        threadId,
        role: "assistant",
        content: answer,
        meta: options.assistantMeta,
      });
    }

    // Unlock the UI as soon as the answer is ready. Reflection is background work.
    emit(options.onEvent, {
      type: "status",
      phase: "done",
      detail: "turn complete",
    });
    emit(options.onEvent, { type: "done", text: answer });

    if (mem?.workspaceRoot) {
      void runHooks({
        name: "afterAgentResponse",
        workspaceRoot: mem.workspaceRoot,
        profileHome: mem.profileHome,
        payload: { text: answer, thread_id: threadId },
      }).catch(() => undefined);
      void runHooks({
        name: "stop",
        workspaceRoot: mem.workspaceRoot,
        profileHome: mem.profileHome,
        payload: { status: "completed", thread_id: threadId },
      }).catch(() => undefined);
    }

    if (mem && mem.enableReflection !== false) {
      void reflectAndStore({
        store: mem.memoryStore,
        sessionStore: mem.sessionStore,
        embedder: mem.embedder,
        model: mem.model,
        agentsMdPath: agentsMdPathFor(mem.profileHome ?? mem.workspaceRoot),
        input: {
          threadId,
          userPrompt: options.prompt,
          assistantResponse: answer || "(empty)",
          hadError: false,
          scopeTags: options.memoryScopeTags,
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
      mem.sessionStore.markTurnError(message, threadId);
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
          agentsMdPath: agentsMdPathFor(mem.profileHome ?? mem.workspaceRoot),
          input: {
            threadId,
            userPrompt: options.prompt,
            assistantResponse: finalText || "(failed before response)",
            hadError: true,
            errorMessage: message,
            scopeTags: options.memoryScopeTags,
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
  } finally {
    if (previousToolAllowlist !== undefined && options.toolScope) {
      options.toolScope.set(previousToolAllowlist);
    }
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

  try {
    const { gateDesktopFastPath } = await import("../decision/desktop-gate.js");
    const gate = await gateDesktopFastPath({
      prompt: options.prompt,
      hasParsedIntent: true,
      hasFollowUp: Boolean(followUp),
    });
    if (!gate.allowFastPath) {
      emit(options.onEvent, {
        type: "status",
        phase: "boot",
        detail: `desktop fast-path skipped (${gate.reason})`,
      });
      return null;
    }
  } catch {
    /* fail open — keep legacy fast-path */
  }

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
    mem.sessionStore.markTurnComplete(answer, threadId);
    mem.sessionStore.appendTranscript({
      threadId,
      role: "assistant",
      content: answer,
      meta: options.assistantMeta,
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
          agentsMdPath: agentsMdPathFor(mem.profileHome ?? mem.workspaceRoot),
      input: {
        threadId,
        userPrompt: options.prompt,
        assistantResponse: answer,
        hadError,
        scopeTags: options.memoryScopeTags,
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
