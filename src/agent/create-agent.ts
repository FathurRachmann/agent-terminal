import fs from "node:fs";
import path from "node:path";
import {
  createDeepAgent,
  createMemoryMiddleware,
  createSummarizationMiddleware,
  registerHarnessProfile,
  CompositeBackend,
  FilesystemBackend,
  type DeepAgent,
} from "deepagents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createRouterModel } from "../model/9router.js";
import { PtySandbox } from "../sandbox/pty-sandbox.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import {
  CONTEXT_SUMMARY_PROMPT,
  HISTORY_PATH_PREFIX,
  KEEP_RECENT_TOKENS,
  SUMMARIZE_TRIGGER_TOKENS,
  describeContextPolicy,
} from "./context-policy.js";
import { createSpecialistSubagents } from "./subagents.js";
import { createNormalizeAiMessageMiddleware } from "./normalize-middleware.js";
import { createWorkspaceAccessTools } from "./workspace-access.js";
import { createTaskTools } from "./task-tools.js";
import {
  createDesktopTools,
  isDesktopAutomationEnabled,
  isDesktopAutomationSupported,
} from "../desktop/index.js";
import {
  PersistentMemoryStore,
  SessionStore,
  createEmbeddingClientOrFallback,
  createLongTermMemoryMiddleware,
  createMemoryTools,
  createPersistentCheckpointer,
  type EmbeddingClient,
} from "../memory/index.js";

/** Virtual mount for on-demand skill discovery via ls/read_file (not auto-injected). */
export const SKILLS_VIRTUAL_ROOT = "/skills/";
export const SKILLS_DIR_RELATIVE = path.join(".agent", "skills");


export type CreateAgentOptions = {
  workspaceRoot: string;
  autoApprove?: boolean;
  onPtyOutput?: (chunk: string) => void;
  enableCheckpointer?: boolean;
  /** Auto-reflect after turns (default true). */
  enableReflection?: boolean;
};

let profilesRegistered = false;

function ensureProfiles(): void {
  if (profilesRegistered) return;
  const shared = {
    excludedMiddleware: ["SummarizationMiddleware"],
  };
  registerHarnessProfile("openai", shared);
  registerHarnessProfile("anthropic", shared);
  profilesRegistered = true;
}

export type AgentBundle = {
  agent: DeepAgent;
  sandbox: PtySandbox;
  memoryStore: PersistentMemoryStore;
  sessionStore: SessionStore;
  embedder: EmbeddingClient;
  model: BaseChatModel;
  workspaceRoot: string;
  contextPolicy: string;
  enableReflection: boolean;
  desktopEnabled: boolean;
};

export async function createTerminalAgent(
  options: CreateAgentOptions,
): Promise<AgentBundle> {
  ensureProfiles();

  const workspaceRoot = path.resolve(options.workspaceRoot);
  fs.mkdirSync(path.join(workspaceRoot, ".agent", "context"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(workspaceRoot, ".agent", "memory"), {
    recursive: true,
  });

  const memoryRelativePath = ".agent/AGENTS.md";
  const memoryPath = path.join(workspaceRoot, memoryRelativePath);
  if (!fs.existsSync(memoryPath)) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(
      memoryPath,
      `# Agent Memory\n\n## Known Pitfalls\n\n`,
      "utf8",
    );
  }

  // Persistent Memory (infrastructure / durability)
  const memoryStore = new PersistentMemoryStore(workspaceRoot);
  memoryStore.syncRulesToAgentsMd(memoryPath);

  const sessionStore = new SessionStore(workspaceRoot);
  const embedder = createEmbeddingClientOrFallback();
  const model = createRouterModel();

  sessionStore.writeConfigSnapshot({
    model: process.env.AGENT_MODEL ?? "gpt-4o",
    embeddingModel: embedder.model,
    routerBaseUrl: process.env.ROUTER_BASE_URL ?? "https://api.9router.com/v1",
    contextWindowTokens: process.env.CONTEXT_WINDOW_TOKENS ?? "256000",
    workspaceRoot,
    enableCheckpointer: options.enableCheckpointer ?? false,
    enableReflection: options.enableReflection ?? true,
  });

  const sandbox = new PtySandbox({
    workingDirectory: workspaceRoot,
    autoApproveDestructive: options.autoApprove ?? false,
    onOutput: options.onPtyOutput,
  });

  const skillsDir = path.join(workspaceRoot, ".agent", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const backend = new CompositeBackend(sandbox, {
    [SKILLS_VIRTUAL_ROOT]: new FilesystemBackend({
      rootDir: skillsDir,
      virtualMode: true,
    }),
  });

  const summarization = createSummarizationMiddleware({
    model,
    backend,
    trigger: { type: "tokens", value: SUMMARIZE_TRIGGER_TOKENS },
    keep: { type: "tokens", value: KEEP_RECENT_TOKENS },
    historyPathPrefix: `/${HISTORY_PATH_PREFIX}`,
    summaryPrompt: CONTEXT_SUMMARY_PROMPT,
  });

  // Deep Agents file memory (always-on guidelines from AGENTS.md)
  const fileMemory = createMemoryMiddleware({
    backend,
    sources: [memoryRelativePath],
  });

  // Long-Term Memory (cognitive / relevance) — semantic + lexical top-K
  const longTerm = createLongTermMemoryMiddleware(memoryStore, {
    limit: 8,
    embedder,
  });
  const normalize = createNormalizeAiMessageMiddleware();

  const desktopEnabled =
    isDesktopAutomationEnabled() && isDesktopAutomationSupported();
  const desktopTools = desktopEnabled
    ? createDesktopTools(workspaceRoot)
    : [];

  // wrapModelCall order (last = closest to model):
  // summarization → fileMemory → longTerm → normalize → model
  // Skills are NOT auto-injected: agent must ls /skills/ and read only what it needs.
  const agent = await Promise.resolve(
    createDeepAgent({
      model,
      systemPrompt: SYSTEM_PROMPT,
      backend,
      interruptOn: options.autoApprove
        ? undefined
        : {
            execute: true,
            edit_file: true,
            write_file: true,
            request_folder_access: true,
            ...(desktopEnabled
              ? {
                  desktop_automate: true,
                  request_desktop_app_access: true,
                }
              : {}),
          },
      tools: [
        ...createMemoryTools(memoryStore, workspaceRoot, embedder),
        ...createWorkspaceAccessTools(sandbox),
        ...createTaskTools(workspaceRoot),
        ...desktopTools,
      ],
      subagents: createSpecialistSubagents(),
      middleware: [summarization, fileMemory, longTerm, normalize],
      checkpointer: options.enableCheckpointer
        ? createPersistentCheckpointer(workspaceRoot)
        : undefined,
      name: "terminal-agent",
    }),
  );

  return {
    agent,
    sandbox,
    memoryStore,
    sessionStore,
    embedder,
    model,
    workspaceRoot,
    contextPolicy: describeContextPolicy(),
    enableReflection: options.enableReflection ?? true,
    desktopEnabled,
  };
}
