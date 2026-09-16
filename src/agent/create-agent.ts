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
import { loadSkillSubagents } from "./skill-registry.js";
import { createMultiTaskInjectMiddleware } from "./multi-task-inject-middleware.js";
import { createNormalizeAiMessageMiddleware } from "./normalize-middleware.js";
import { createCapabilityFilterMiddleware } from "./capability-filter-middleware.js";
import {
  createBotScopeController,
  createBotScopeMiddleware,
  type BotScopeController,
} from "./bot-scope-middleware.js";
import {
  buildDisabledSkillPermissions,
  filterToolsByCapability,
  resolveCapabilityFilter,
} from "./capabilities-catalog.js";
import { createWorkspaceAccessTools } from "./workspace-access.js";
import { createTaskTools } from "./task-tools.js";
import { createWebTools } from "./web-tools.js";
import { createOrchestrationTools } from "./orchestration.js";
import { createSkillManagementTools } from "./skill-manage.js";
import { createProcessManagementTools } from "./process-manage.js";
import { createVaultManagementTools } from "./vault-manage.js";
import { createPlaywrightTools } from "./playwright-tools.js";
import { createVisionTools } from "./vision-tools.js";
import { createDocumentTools } from "./document-tools.js";
import { createGraphifyTools } from "./graphify-tools.js";
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
import {
  composeSystemPrompt,
  ensureSoul,
  readSoul,
} from "./profiles/index.js";

/** Virtual mount for on-demand skill discovery via ls/read_file (not auto-injected). */
export const SKILLS_VIRTUAL_ROOT = "/skills/";
export const SKILLS_DIR_RELATIVE = path.join(".agent", "skills");
/** Virtual mount of profile home so AGENTS.md / skills stay profile-scoped. */
export const PROFILE_VIRTUAL_ROOT = "/__profile__/";

export type CreateAgentOptions = {
  /** Project tree for PTY / filesystem tools. */
  workspaceRoot: string;
  /**
   * Extra sandbox roots (project folders). When set, these plus workspaceRoot
   * become allowedRoots; workingDirectory remains workspaceRoot (primary).
   */
  allowedFolders?: string[];
  /**
   * Profile home for agent state (`.agent/`, SOUL.md).
   * Defaults to workspaceRoot for CLI / legacy single-home mode.
   */
  profileHome?: string;
  profileId?: string;
  autoApprove?: boolean;
  /**
   * Interrupt before `task_todos` so the UI can show the plan and require
   * explicit Approve before execution continues. Independent of autoApprove.
   */
  requirePlanApproval?: boolean;
  onPtyOutput?: (chunk: string) => void;
  enableCheckpointer?: boolean;
  /** Auto-reflect after turns (default true). */
  enableReflection?: boolean;
  /**
   * After approved `task_todos`, run fixed parallel workers (explorer/coder/reviewer
   * + skill agents) and merge into the tool result. Default true.
   */
  enableFixedOrchestration?: boolean;
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
  profileHome: string;
  profileId: string;
  contextPolicy: string;
  enableReflection: boolean;
  desktopEnabled: boolean;
  /** Mutable allowlist for specialized bot sessions (null = general / all tools). */
  botScope: BotScopeController;
};

export async function createTerminalAgent(
  options: CreateAgentOptions,
): Promise<AgentBundle> {
  ensureProfiles();

  const workspaceRoot = path.resolve(options.workspaceRoot);
  const profileHome = path.resolve(options.profileHome ?? workspaceRoot);
  const profileId = options.profileId ?? "default";

  fs.mkdirSync(path.join(profileHome, ".agent", "context"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(profileHome, ".agent", "memory"), {
    recursive: true,
  });

  ensureSoul(profileHome);
  const soul = readSoul(profileHome);
  const systemPrompt = composeSystemPrompt(SYSTEM_PROMPT, soul);

  const memoryRelativePath = ".agent/AGENTS.md";
  const memoryPath = path.join(profileHome, memoryRelativePath);
  if (!fs.existsSync(memoryPath)) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(
      memoryPath,
      `# Agent Memory\n\n## Known Pitfalls\n\n`,
      "utf8",
    );
  }

  // Persistent Memory (infrastructure / durability)
  const memoryStore = new PersistentMemoryStore(workspaceRoot, profileHome);
  memoryStore.syncRulesToAgentsMd(memoryPath);

  const sessionStore = new SessionStore(workspaceRoot, profileHome);
  const embedder = createEmbeddingClientOrFallback();
  const model = createRouterModel();

  sessionStore.writeConfigSnapshot({
    model: process.env.AGENT_MODEL ?? "gpt-4o",
    embeddingModel: embedder.model,
    routerBaseUrl: process.env.ROUTER_BASE_URL ?? "https://api.9router.com/v1",
    contextWindowTokens: process.env.CONTEXT_WINDOW_TOKENS ?? "256000",
    workspaceRoot,
    profileHome,
    profileId,
    enableCheckpointer: options.enableCheckpointer ?? false,
    enableReflection: options.enableReflection ?? true,
  });

  const sandbox = new PtySandbox({
    workingDirectory: workspaceRoot,
    initialAllowedRoots: options.allowedFolders,
    autoApproveDestructive: options.autoApprove ?? false,
    onOutput: options.onPtyOutput,
  });

  const skillsDir = path.join(profileHome, ".agent", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const backend = new CompositeBackend(sandbox, {
    [SKILLS_VIRTUAL_ROOT]: new FilesystemBackend({
      rootDir: skillsDir,
      virtualMode: true,
    }),
    [PROFILE_VIRTUAL_ROOT]: new FilesystemBackend({
      rootDir: profileHome,
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

  // Deep Agents file memory (always-on guidelines from profile AGENTS.md)
  const fileMemory = createMemoryMiddleware({
    backend,
    sources: [`${PROFILE_VIRTUAL_ROOT}${memoryRelativePath}`],
  });

  // Long-Term Memory (cognitive / relevance) — semantic + lexical top-K
  const longTerm = createLongTermMemoryMiddleware(memoryStore, {
    limit: 8,
    embedder,
  });
  const normalize = createNormalizeAiMessageMiddleware();

  const desktopEnabled =
    isDesktopAutomationEnabled() && isDesktopAutomationSupported();
  const capabilityFilter = resolveCapabilityFilter(profileHome);
  const desktopTools = desktopEnabled
    ? createDesktopTools(workspaceRoot)
    : [];

  const customTools = filterToolsByCapability(
    [
      ...createMemoryTools(memoryStore, profileHome, embedder),
      ...createWorkspaceAccessTools(sandbox),
      ...createTaskTools(workspaceRoot),
      ...createWebTools(),
      ...createOrchestrationTools(),
      ...createSkillManagementTools(profileHome),
      ...createProcessManagementTools(),
      ...createVaultManagementTools(profileHome),
      ...createPlaywrightTools(),
      ...createVisionTools(),
      ...createDocumentTools(workspaceRoot),
      ...createGraphifyTools(workspaceRoot),
      ...desktopTools,
    ],
    capabilityFilter.disabledToolNames,
  );

  const capabilityFilterMw = createCapabilityFilterMiddleware(
    capabilityFilter.disabledToolNames,
  );
  const botScope = createBotScopeController();
  const botScopeMw = createBotScopeMiddleware(botScope);
  const skillPermissions = buildDisabledSkillPermissions(
    capabilityFilter.disabledSkillFolders,
  );
  const skillSubagents = loadSkillSubagents(skillsDir);
  const multiTaskInjectMw = createMultiTaskInjectMiddleware({
    workspaceRoot,
    skillsRoot: skillsDir,
    triggerOn: "task_todos",
    enabled: options.enableFixedOrchestration !== false,
  });

  // wrapModelCall order (last = closest to model):
  // summarization → fileMemory → longTerm → normalize → capabilityFilter → botScope → model
  // wrapToolCall: multiTaskInject last so capability/bot-scope filters run first.
  // Skills are NOT auto-injected: agent must ls /skills/ and read only what it needs.
  // Skill frontmatter `agent:` registers extra SubAgents for the `task` tool.
  const requirePlanApproval = options.requirePlanApproval !== false;
  const interruptOn: Record<string, boolean> = {
    ...(requirePlanApproval ? { task_todos: true } : {}),
    ...(options.autoApprove
      ? {}
      : {
          execute: true,
          edit_file: true,
          write_file: true,
          request_folder_access: true,
          ...(desktopEnabled
            ? {
                desktop_automate: true,
                request_desktop_app_access: true,
                computer_screenshot: true,
                computer_click: true,
                computer_type: true,
                computer_key: true,
              }
            : {}),
        }),
  };

  const agent = await Promise.resolve(
    createDeepAgent({
      model,
      systemPrompt,
      backend,
      permissions: skillPermissions.length ? skillPermissions : undefined,
      interruptOn: Object.keys(interruptOn).length ? interruptOn : undefined,
      tools: customTools,
      subagents: [...createSpecialistSubagents(), ...skillSubagents],
      middleware: [
        summarization,
        fileMemory,
        longTerm,
        normalize,
        capabilityFilterMw,
        botScopeMw,
        multiTaskInjectMw,
      ],
      checkpointer: options.enableCheckpointer
        ? createPersistentCheckpointer(workspaceRoot, profileHome)
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
    profileHome,
    profileId,
    contextPolicy: describeContextPolicy(),
    enableReflection: options.enableReflection ?? true,
    desktopEnabled,
    botScope,
  };
}
