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
import {
  buildAgentSystemPrompt,
  resolveAgentPreset,
  type AgentKind,
} from "./agent-presets.js";
import { createMultiTaskInjectMiddleware } from "./multi-task-inject-middleware.js";
import { createNormalizeAiMessageMiddleware } from "./normalize-middleware.js";
import { createCapabilityFilterMiddleware } from "./capability-filter-middleware.js";
import { createDecisionToolFilterMiddleware } from "./decision-tool-filter-middleware.js";
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
import { loadFolderAllowlist } from "./folder-allowlist.js";
import { defaultSandboxAllowedRoots, privacyStrictAllowedRoots } from "./default-sandbox-roots.js";
import { loadPrivacyMode } from "./privacy-mode.js";
import { createTaskTools } from "./task-tools.js";
import { createWebTools } from "./web-tools.js";
import { createOrchestrationTools } from "./orchestration.js";
import { createSkillManagementTools } from "./skill-manage.js";
import { createProcessManagementTools } from "./process-manage.js";
import { createVaultManagementTools } from "./vault-manage.js";
import { createPlaywrightTools } from "./playwright-tools.js";
import { createVisionTools } from "./vision-tools.js";
import { createSpeechTools } from "./speech-tools.js";
import { createDocumentTools } from "./document-tools.js";
import { createGraphifyTools } from "./graphify-tools.js";
import { createCodingTools } from "./coding-tools.js";
import { loadMcpTools } from "./mcp-loader.js";
import { createPostEditVerifyMiddleware } from "./post-edit-verify-middleware.js";
import { createEditRetryMiddleware } from "./edit-retry-middleware.js";
import { createEditDiffMiddleware } from "./edit-diff-middleware.js";
import { createToolResultCompactMiddleware } from "./tool-result-compact-middleware.js";
import { createOfficeBinaryWriteGuardMiddleware } from "./office-binary-write-guard.js";
import { createWritePersistMiddleware } from "./write-persist-middleware.js";
import { createConfigEditGuardMiddleware } from "./config-edit-guard.js";
import { createHooksToolMiddleware } from "./hooks/hooks-middleware.js";
import { runHooks } from "./hooks/run-hooks.js";
import {
  buildInterruptOn,
  createRunModeController,
  resolveRunMode,
  type RunMode,
  type RunModeController,
} from "./run-modes.js";
import { createPlanGateController, type PlanGateController } from "./chat-mode.js";
import { buildSkillCatalogPromptSection } from "./skill-catalog.js";
import { loadMergedPermissions } from "./permissions-store.js";
import { ensureTemplatesDir } from "./document-templates.js";
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
   * Agent application root — `tmp/global|bots|project/...` artifacts live here.
   * Defaults to profileHome ?? workspaceRoot.
   */
  artifactHome?: string;
  /**
   * Profile home for agent state (`.agent/`, SOUL.md).
   * Defaults to workspaceRoot for CLI / legacy single-home mode.
   */
  profileHome?: string;
  profileId?: string;
  /**
   * Top-level agent preset: general | research | ops (default general).
   * Same tools; different operating posture / system overlay.
   */
  agentKind?: string;
  /**
   * @deprecated Prefer `runMode`. true maps to run-everything.
   */
  autoApprove?: boolean;
  /** Cursor-style Run Mode (default auto-review). */
  runMode?: RunMode;
  /** Shell/tool allowlist entries for allowlist + auto-review short-circuit. */
  toolAllowlist?: string[];
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
  /**
   * Privacy ON (true) = project-only allowlist.
   * Privacy OFF (false) = whole-machine access.
   * When omitted, loaded from profile `.agent/privacy-mode.json` (default OFF).
   */
  privacyMode?: boolean;
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

import { AsyncLocalStorage } from "node:async_hooks";

export type MemoryScopeController = {
  getRequiredTags: () => string[] | undefined;
  setRequiredTags: (tags: string[] | undefined) => void;
  /** Run async work with per-task tags (safe for parallel workspace bots). */
  runWithTags: <T>(
    tags: string[] | undefined,
    fn: () => Promise<T>,
  ) => Promise<T>;
};

const memoryScopeAls = new AsyncLocalStorage<string[] | undefined>();

export function createMemoryScopeController(): MemoryScopeController {
  let required: string[] | undefined;
  return {
    getRequiredTags: () => {
      const fromAls = memoryScopeAls.getStore();
      if (fromAls !== undefined) return fromAls;
      return required;
    },
    setRequiredTags: (tags) => {
      required = tags && tags.length > 0 ? [...tags] : undefined;
    },
    runWithTags: (tags, fn) => {
      const scoped =
        tags && tags.length > 0 ? [...tags] : undefined;
      return memoryScopeAls.run(scoped, fn);
    },
  };
}

export type AgentBundle = {
  agent: DeepAgent;
  sandbox: PtySandbox;
  memoryStore: PersistentMemoryStore;
  sessionStore: SessionStore;
  embedder: EmbeddingClient;
  model: BaseChatModel;
  workspaceRoot: string;
  /** Agent repo root for tmp/global|bots|project artifacts. */
  artifactHome: string;
  profileHome: string;
  profileId: string;
  /** Active top-level agent preset (general | research | ops). */
  agentKind: AgentKind;
  contextPolicy: string;
  enableReflection: boolean;
  desktopEnabled: boolean;
  /** Mutable allowlist for specialized bot sessions (null = general / all tools). */
  botScope: BotScopeController;
  /** Mutable RAG filter for workspace/bot memory isolation. */
  memoryScope: MemoryScopeController;
  /** Cursor Run Mode controller (live updates from Settings). */
  runMode: RunModeController;
  /** Plan mode Build gate — unlock after task_todos Approve. */
  planGate: PlanGateController;
  /** MCP server names successfully configured for this agent. */
  mcpServerNames: string[];
  /** Tear down MCP stdio/HTTP clients. */
  closeMcp: () => Promise<void>;
};

export async function createTerminalAgent(
  options: CreateAgentOptions,
): Promise<AgentBundle> {
  ensureProfiles();

  const workspaceRoot = path.resolve(options.workspaceRoot);
  const profileHome = path.resolve(options.profileHome ?? workspaceRoot);
  const artifactHome = path.resolve(
    options.artifactHome ?? profileHome ?? workspaceRoot,
  );
  const profileId = options.profileId ?? "default";
  const agentPreset = resolveAgentPreset(options.agentKind);

  ensureTemplatesDir(artifactHome);

  fs.mkdirSync(path.join(profileHome, ".agent", "context"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(profileHome, ".agent", "memory"), {
    recursive: true,
  });

  ensureSoul(profileHome);
  const soul = readSoul(profileHome);
  const skillsDir = path.join(profileHome, ".agent", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const capabilityFilterEarly = resolveCapabilityFilter(profileHome);
  const skillCatalog = buildSkillCatalogPromptSection(
    skillsDir,
    capabilityFilterEarly.disabledSkillFolders,
  );
  const systemPrompt = [
    buildAgentSystemPrompt(
      composeSystemPrompt(SYSTEM_PROMPT, soul),
      agentPreset.id,
    ),
    skillCatalog,
  ]
    .filter(Boolean)
    .join("\n\n");

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
    contextWindowTokens: process.env.CONTEXT_WINDOW_TOKENS ?? "128000",
    workspaceRoot,
    profileHome,
    profileId,
    agentKind: agentPreset.id,
    enableCheckpointer: options.enableCheckpointer ?? false,
    enableReflection: options.enableReflection ?? true,
  });

  const persistedFolders = loadFolderAllowlist(profileHome);
  const privacyOn =
    typeof options.privacyMode === "boolean"
      ? options.privacyMode
      : loadPrivacyMode(profileHome);
  const rootOpts = {
    workspaceRoot,
    artifactHome,
    projectFolders: options.allowedFolders ?? [],
    persistedFolders,
  };
  const sandbox = new PtySandbox({
    workingDirectory: workspaceRoot,
    initialAllowedRoots: privacyOn
      ? privacyStrictAllowedRoots(rootOpts)
      : defaultSandboxAllowedRoots(rootOpts),
    artifactHome,
    privacyStrict: privacyOn,
    autoApproveDestructive:
      resolveRunMode({
        runMode: options.runMode,
        autoApproveDestructive: options.autoApprove,
      }) === "run-everything",
    onOutput: options.onPtyOutput,
  });

  const runModeCtrl = createRunModeController({
    runMode: resolveRunMode({
      runMode: options.runMode,
      autoApproveDestructive: options.autoApprove,
    }),
    toolAllowlist: [
      ...(options.toolAllowlist ?? []),
      ...loadMergedPermissions({
        workspaceRoot,
        profileHome,
      }).terminalAllowlist,
    ],
  });
  const planGate = createPlanGateController(false);
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
  const memoryScope = createMemoryScopeController();
  const longTerm = createLongTermMemoryMiddleware(memoryStore, {
    limit: 8,
    embedder,
    getRequiredTags: () => memoryScope.getRequiredTags(),
  });
  const normalize = createNormalizeAiMessageMiddleware();

  const desktopEnabled =
    isDesktopAutomationEnabled() && isDesktopAutomationSupported();
  const capabilityFilter = resolveCapabilityFilter(profileHome);
  const desktopTools = desktopEnabled
    ? createDesktopTools(workspaceRoot)
    : [];

  const mcp = await loadMcpTools({
    roots: [profileHome, workspaceRoot],
    disabledMcpServers: capabilityFilter.disabledMcpServers,
    profileHome,
  });

  const customTools = filterToolsByCapability(
    [
      ...createMemoryTools(memoryStore, profileHome, embedder),
      ...createWorkspaceAccessTools(sandbox, { profileHome }),
      ...createTaskTools(workspaceRoot),
      ...createCodingTools(workspaceRoot),
      ...createWebTools(),
      ...createOrchestrationTools(),
      ...createSkillManagementTools(profileHome),
      ...createProcessManagementTools(),
      ...createVaultManagementTools(profileHome),
      ...createPlaywrightTools(),
      ...createVisionTools(),
      ...createSpeechTools(workspaceRoot),
      ...createDocumentTools(workspaceRoot),
      ...createGraphifyTools(workspaceRoot),
      ...desktopTools,
      ...mcp.tools,
    ],
    capabilityFilter.disabledToolNames,
  );

  const mcpToolNames = customTools
    .map((t) =>
      t && typeof t === "object" && "name" in t
        ? String((t as { name?: string }).name ?? "")
        : "",
    )
    .filter((n) => n.startsWith("mcp_"));

  const capabilityFilterMw = createCapabilityFilterMiddleware(
    capabilityFilter.disabledToolNames,
  );
  const decisionToolFilterMw = createDecisionToolFilterMiddleware(
    capabilityFilter.disabledToolNames,
  );
  const botScope = createBotScopeController();
  const botScopeMw = createBotScopeMiddleware(botScope);
  const editRetryMw = createEditRetryMiddleware({ workspaceRoot });
  const editDiffMw = createEditDiffMiddleware({ workspaceRoot });
  const postEditVerifyMw = createPostEditVerifyMiddleware({
    workspaceRoot,
  });
  const toolCompactMw = createToolResultCompactMiddleware();
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
  // Skills: name/description catalog is in systemPrompt; full bodies on-demand via /skills/.
  // Skill frontmatter `agent:` registers extra SubAgents for the `task` tool.
  const requirePlanApproval = options.requirePlanApproval !== false;
  // Always register shell/MCP/desktop interrupts; live Run Mode resolves
  // allow/ask/deny via tryAutoResolveRunModeInterrupt (incl. run-everything).
  const interruptOn = buildInterruptOn({
    runMode: "auto-review",
    requirePlanApproval,
    desktopEnabled,
    extraGatedTools: mcpToolNames,
  });

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
        decisionToolFilterMw,
        botScopeMw,
        createConfigEditGuardMiddleware({
          getRunMode: () => runModeCtrl.getRunMode(),
        }),
        createHooksToolMiddleware({
          workspaceRoot,
          profileHome,
        }),
        createOfficeBinaryWriteGuardMiddleware(),
        createWritePersistMiddleware({
          artifactHome,
          workspaceRoot,
        }),
        editRetryMw,
        postEditVerifyMw,
        toolCompactMw,
        editDiffMw,
        multiTaskInjectMw,
      ],
      checkpointer: options.enableCheckpointer
        ? createPersistentCheckpointer(workspaceRoot, profileHome)
        : undefined,
      name: agentPreset.runtimeName,
    }),
  );

  void runHooks({
    name: "sessionStart",
    workspaceRoot,
    profileHome,
    payload: {
      session_id: profileId,
      workspace_root: workspaceRoot,
      agent_kind: agentPreset.id,
    },
  }).catch(() => undefined);

  return {
    agent,
    sandbox,
    memoryStore,
    sessionStore,
    embedder,
    model,
    workspaceRoot,
    artifactHome,
    profileHome,
    profileId,
    agentKind: agentPreset.id,
    contextPolicy: describeContextPolicy(),
    enableReflection: options.enableReflection ?? true,
    desktopEnabled,
    botScope,
    memoryScope,
    runMode: runModeCtrl,
    planGate,
    mcpServerNames: mcp.serverNames,
    closeMcp: mcp.close,
  };
}
