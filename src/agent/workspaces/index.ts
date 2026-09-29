import {
  assignProjectToWorkspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  loadWorkspaceRegistry,
  saveWorkspaceRegistry,
  setWorkspaceActiveProject,
  unassignProjectFromWorkspace,
  updateWorkspace,
  workspaceDir,
  workspacesRegistryPath,
  isValidWorkspaceId,
  type WorkspaceRecord,
  type WorkspaceRegistry,
  type WorkspaceSummary,
} from "./registry.js";
import {
  activeWorkspaceBots,
  buildWorkspaceBotInstruction,
  createWorkspaceBot,
  deleteWorkspaceBot,
  getWorkspaceBot,
  IT_DIVISION_SEED_BOTS,
  loadWorkspaceBots,
  mergeBotToolsForProject,
  resolveBotToolAllowlist,
  saveWorkspaceBots,
  seedDivisionBots,
  seedItDivisionBots,
  updateWorkspaceBot,
  WORKSPACE_DEFAULT_GROUP_TOOLS,
  WORKSPACE_PROJECT_TOOL_BASE,
  type WorkspaceBot,
  type WorkspaceDivisionId,
} from "./bots.js";
import {
  WORKSPACE_DIVISION_OPTIONS,
  resolveWorkspaceDivision,
  loadAgencyAgentsCatalog,
  seedBotsForDivision,
  getItDivisionSeedBots,
} from "./division-catalog.js";
import {
  countGroupChats,
  createGroupChat,
  deleteGroupChat,
  ensureDefaultGroupChat,
  getGroupChat,
  isWorkspaceThreadId,
  listGroupChats,
  parseWorkspaceThreadId,
  updateGroupChat,
  workspaceThreadId,
  WS_THREAD_PREFIX,
  WS_THREAD_SEP,
  type GroupChatRecord,
  type GroupChatReplyMode,
} from "./chats.js";
import {
  mentionSuggestions,
  parseMentions,
  stripMentions,
  type MentionMatch,
} from "./mentions.js";
import {
  buildReplyQueue,
  buildReplyQueueWithOptionalLlm,
  heuristicRouteBots,
  isAddressAllMessage,
  sortBotsForBroadcast,
  llmRouteBots,
  type LlmRouteSemanticCache,
  type ReplyQueueResult,
} from "./routing.js";
import {
  applyRoundBudget,
  buildSupervisorInstruction,
  buildSupervisorUserPrompt,
  buildSupervisorContinuePrompt,
  excludeSupervisorFromQueue,
  formatSupervisorSystemNote,
  MAX_SUPERVISOR_AUTO_CONTINUE,
  parseSupervisorVerdict,
  pickSupervisorBot,
  resolveContinueWorkerIds,
  shouldAutoContinue,
  looksLikeDeferredNextActions,
  type SupervisorStatus,
  type SupervisorVerdict,
} from "./supervisor.js";

export function listWorkspaceSummaries(
  profileHome: string,
): WorkspaceSummary[] {
  const reg = loadWorkspaceRegistry(profileHome);
  return reg.workspaces.map((w) => ({
    ...w,
    memberCount: loadWorkspaceBots(profileHome, w.id).length,
    chatCount: countGroupChats(profileHome, w.id),
  }));
}

export function createWorkspaceWithSeed(
  profileHome: string,
  input: {
    name: string;
    description?: string;
    id?: string;
    projectIds?: string[];
    /** Preferred: which division roster to seed. */
    division?: WorkspaceDivisionId | string;
    /** @deprecated use `division` — false seeds no bots; true seeds IT. */
    seedItRoles?: boolean;
  },
):
  | {
      ok: true;
      workspace: WorkspaceRecord;
      registry: WorkspaceRegistry;
      bots: WorkspaceBot[];
      chat: GroupChatRecord;
    }
  | { ok: false; error: string } {
  const division = resolveWorkspaceDivision(input);
  const created = createWorkspace(profileHome, {
    ...input,
    division,
  });
  if (!created.ok) return created;
  const bots = seedDivisionBots(
    profileHome,
    created.workspace.id,
    division,
  );
  const chat = ensureDefaultGroupChat(
    profileHome,
    created.workspace.id,
    created.workspace.activeProjectId,
  );
  return {
    ok: true,
    workspace: created.workspace,
    registry: created.registry,
    bots,
    chat,
  };
}

export type MemoryScopeTags = {
  workspaceId?: string;
  botId?: string;
};

export function memoryTagsForScope(scope?: MemoryScopeTags | null): string[] {
  const tags: string[] = [];
  if (scope?.workspaceId) tags.push(`workspace:${scope.workspaceId}`);
  if (scope?.botId) tags.push(`bot:${scope.botId}`);
  return tags;
}

export function memoryMatchesScope(
  tags: string[] | undefined,
  scope?: MemoryScopeTags | null,
): boolean {
  if (!scope?.workspaceId && !scope?.botId) return true;
  const set = new Set(tags ?? []);
  if (scope.workspaceId && !set.has(`workspace:${scope.workspaceId}`)) {
    return false;
  }
  if (scope.botId && !set.has(`bot:${scope.botId}`)) {
    return false;
  }
  return true;
}

export {
  activeWorkspaceBots,
  assignProjectToWorkspace,
  buildReplyQueue,
  buildReplyQueueWithOptionalLlm,
  buildWorkspaceBotInstruction,
  createGroupChat,
  createWorkspace,
  createWorkspaceBot,
  deleteGroupChat,
  deleteWorkspace,
  deleteWorkspaceBot,
  ensureDefaultGroupChat,
  getGroupChat,
  getWorkspace,
  getWorkspaceBot,
  heuristicRouteBots,
  isAddressAllMessage,
  isValidWorkspaceId,
  isWorkspaceThreadId,
  IT_DIVISION_SEED_BOTS,
  listGroupChats,
  llmRouteBots,
  loadWorkspaceBots,
  loadWorkspaceRegistry,
  mentionSuggestions,
  mergeBotToolsForProject,
  resolveBotToolAllowlist,
  WORKSPACE_DEFAULT_GROUP_TOOLS,
  WORKSPACE_PROJECT_TOOL_BASE,
  parseMentions,
  parseWorkspaceThreadId,
  parseSupervisorVerdict,
  pickSupervisorBot,
  applyRoundBudget,
  buildSupervisorInstruction,
  buildSupervisorUserPrompt,
  buildSupervisorContinuePrompt,
  excludeSupervisorFromQueue,
  formatSupervisorSystemNote,
  MAX_SUPERVISOR_AUTO_CONTINUE,
  resolveContinueWorkerIds,
  shouldAutoContinue,
  looksLikeDeferredNextActions,
  saveWorkspaceBots,
  saveWorkspaceRegistry,
  seedDivisionBots,
  seedItDivisionBots,
  setWorkspaceActiveProject,
  sortBotsForBroadcast,
  stripMentions,
  unassignProjectFromWorkspace,
  updateGroupChat,
  updateWorkspace,
  updateWorkspaceBot,
  WORKSPACE_DIVISION_OPTIONS,
  resolveWorkspaceDivision,
  loadAgencyAgentsCatalog,
  seedBotsForDivision,
  getItDivisionSeedBots,
  workspaceDir,
  workspaceThreadId,
  workspacesRegistryPath,
  WS_THREAD_PREFIX,
  WS_THREAD_SEP,
};

export type {
  GroupChatRecord,
  GroupChatReplyMode,
  LlmRouteSemanticCache,
  MentionMatch,
  ReplyQueueResult,
  SupervisorStatus,
  SupervisorVerdict,
  WorkspaceBot,
  WorkspaceDivisionId,
  WorkspaceRecord,
  WorkspaceRegistry,
  WorkspaceSummary,
};
