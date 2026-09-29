import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody.js";
import { PlanApprovalCard } from "./PlanApprovalCard.js";
import { ToolApprovalCard } from "./ToolApprovalCard.js";
import {
  ContinueTurnCard,
  type ContinueOffer,
} from "./ContinueTurnCard.js";
import { ChatFileCard } from "./ChatFileCard.js";
import { UserBubbleAttachments } from "./UserBubbleAttachments.js";
import {
  parseUserMessageContent,
  type UserBubbleAttachment,
} from "./user-message-attachments.js";
import {
  sessionPreviewLabel,
  sortSessionsForSidebar,
  touchSessionRow,
} from "./session-list.js";
import {
  formatPlanApprovalMarkdown,
  parseTaskPlanArgs,
  parseTaskBoardJson,
  extractTodosFromPlanInterrupt,
} from "./plan-approval.js";
import { buildDeliverableFileChips } from "../deliverable-chips.js";
import {
  buildChatSegments,
  CollapsibleTraceGroup,
  phaseColor,
  shouldMirrorInChat,
  type AgentPhase,
  type AgentUiEvent,
} from "./ActivityChips.js";
import {
  StreamingCaret,
  TypingDots,
  WaitingCard,
} from "./WaitingIndicator.js";
import { ReasoningBlock } from "./ReasoningBlock.js";
import { CapabilitiesView } from "./CapabilitiesView.js";
import { ArtifactsView, type ArtifactRecord } from "./ArtifactsView.js";
import { SettingsView } from "./SettingsView.js";
import { MessagingView } from "./MessagingView.js";
import { ProfilesView } from "./ProfilesView.js";
import { KanbanView } from "./KanbanView.js";
import { NewProfileModal } from "./NewProfileModal.js";
import { NewProjectModal } from "./NewProjectModal.js";
import { type GatewayStatusSnapshot } from "./GatewayStatusBar.js";
import { AppHeader } from "./AppHeader.js";
import { NavIconRail, type NavRailId } from "./NavIconRail.js";
import { SessionRowMenu } from "./SessionRowMenu.js";
import { AppFooter } from "./AppFooter.js";
import {
  ActivityCanvas,
  artifactToCanvasTab,
  type CanvasTab,
} from "./ActivityCanvas.js";
import {
  asRecord,
  canvasResultRank,
  inferPreviewKind,
  languageForExt,
  extensionOf,
  basenamePath,
  pickAutoFocusArtifact,
  preferCanvasPath,
  normalizeCanvasKey,
  resolveArtifactsFromTool,
  shouldAutoFocusCanvas,
  type ActivityArtifact,
} from "./activity-artifact.js";
import {
  AssistantBubbleActions,
  UserBubbleActions,
  type BubbleFeedback,
} from "./ChatBubbleActions.js";
import { ChatComposer, type ComposerAttachment, type ComposerEffort, type ComposerMode } from "./ChatComposer.js";
import { PanelResizeHandle } from "./LayoutToolbar.js";
import { LayoutsModal } from "./LayoutsModal.js";
import {
  TerminalPanel,
  appendTerminalLog,
} from "./TerminalPanel.js";
import {
  LAYOUT_DEFAULTS,
  RAIL_MAX,
  RAIL_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  TERMINAL_MAX,
  TERMINAL_MIN,
  applyLayoutTemplate,
  loadLayoutPrefs,
  resetLayoutPrefs,
  saveLayoutPrefs,
  type LayoutPrefs,
  type LayoutTemplateId,
} from "./layout-prefs.js";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel.js";
import {
  formatToolApprovalDetail,
  isPlanApprovalInterrupt,
} from "../../agent/interrupt-utils.js";
import {
  extractSuggestedModel,
  resolveFinalAssistantText,
  sanitizeAssistantText,
  shouldRenderAsReasoning,
} from "../../agent/sanitize-output.js";
import { looksLikeTextToolCallDump } from "../../agent/parse-text-tool-calls.js";
import {
  emptySessionSnap,
  reduceSessionEvent,
  type SessionUiSnap,
} from "./session-ui-state.js";

type DesktopAgentEvent = AgentUiEvent & { threadId?: string };

declare global {
  interface Window {
    electronAgent?: {
      sendPrompt: (
        prompt: string,
        attachments?: Array<{
          path?: string;
          absPath?: string;
          basename?: string;
          kind?: string;
        }>,
        options?: { chatMode?: string },
      ) => Promise<{
        ok: boolean;
        content?: string;
        error?: string;
        threadId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
      }>;
      pickAttachments?: (options?: {
        imagesOnly?: boolean;
        directories?: boolean;
      }) => Promise<{
        ok: boolean;
        cancelled?: boolean;
        error?: string;
        warnings?: string[];
        files: Array<{
          path: string;
          absPath: string;
          basename: string;
          mime: string;
          size: number;
          kind: "image" | "file";
          previewUrl?: string;
          label?: string;
        }>;
      }>;
      importAttachmentPaths?: (paths: string[]) => Promise<{
        ok: boolean;
        error?: string;
        warnings?: string[];
        files: Array<{
          path: string;
          absPath: string;
          basename: string;
          mime: string;
          size: number;
          kind: "image" | "file";
          previewUrl?: string;
          label?: string;
        }>;
      }>;
      importAttachmentBuffer?: (payload: {
        base64: string;
        fileName: string;
        mime?: string;
        label?: string;
      }) => Promise<{
        ok: boolean;
        error?: string;
        file: {
          path: string;
          absPath: string;
          basename: string;
          mime: string;
          size: number;
          kind: "image" | "file";
          previewUrl?: string;
          label?: string;
        } | null;
      }>;
      getPathForFile?: (file: File) => string;
      selfHeal?: (payload?: {
        note?: string;
        threadId?: string;
      }) => Promise<{
        ok: boolean;
        content?: string;
        error?: string;
        threadId?: string;
      }>;
      selfHealStatus?: () => Promise<{
        phase: string;
        running: boolean;
        trigger: string | null;
      }>;
      getStatus: () => Promise<{
        bridge: boolean;
        agentReady: boolean;
        agentBooting?: boolean;
        error: string | null;
        model: string;
        workspaceRoot: string;
        defaultWorkspaceRoot?: string;
        profileId?: string;
        profileHome?: string;
        activeProjectId?: string | null;
        projectFolders?: string[] | null;
        privacyMode?: boolean;
        allowedRoots?: string[] | null;
        gateway?: GatewayStatusSnapshot;
        busy?: boolean;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        activeThreadId?: string;
        activeBotId?: string;
      }>;
      setPrivacyMode?: (
        enabled: boolean,
      ) => Promise<{
        ok: boolean;
        privacyMode?: boolean;
        allowedRoots?: string[];
        deferred?: boolean;
        detail?: string;
        error?: string;
      }>;
      getGitSummary?: () => Promise<{
        ok: boolean;
        branch: string | null;
        additions: number;
        deletions: number;
        dirty: boolean;
        error?: string;
      }>;
      listGitBranches?: () => Promise<{
        ok: boolean;
        current?: string | null;
        branches?: Array<{ name: string; current: boolean; remote: boolean }>;
        error?: string;
      }>;
      checkoutGitBranch?: (
        branch: string,
      ) => Promise<{ ok: boolean; branch?: string; error?: string }>;
      listProfiles?: () => Promise<{
        ok: boolean;
        profiles: Array<{
          id: string;
          name?: string;
          home: string;
          isActive: boolean;
          isDefault: boolean;
          hasEnv: boolean;
          soulPreview: string;
          skillsCount: number;
          model?: string;
        }>;
        activeProfileId: string;
        error?: string;
      }>;
      getProfile?: (id?: string) => Promise<{
        ok: boolean;
        profile?: {
          id: string;
          home: string;
          isActive: boolean;
          isDefault: boolean;
          hasEnv: boolean;
          skillsCount: number;
          model?: string;
        };
        soul?: string;
        error?: string;
      }>;
      createProfile?: (payload: {
        id: string;
        cloneFrom?: string;
        soul?: string;
        name?: string;
      }) => Promise<{
        ok: boolean;
        profile?: { id: string };
        error?: string;
      }>;
      updateProfileSoul?: (payload: {
        id?: string;
        soul?: string;
      }) => Promise<{ ok: boolean; reloaded?: boolean; error?: string }>;
      setDefaultProfile?: (
        id: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      switchProfile?: (id: string) => Promise<{
        ok: boolean;
        profileId?: string;
        threadId?: string;
        error?: string;
      }>;
      listProjects?: () => Promise<{
        ok: boolean;
        activeProjectId: string | null;
        projects: Array<{
          id: string;
          name: string;
          folders: string[];
          idea?: string;
          primaryFolder: string | null;
          isActive: boolean;
        }>;
      }>;
      createProject?: (payload: {
        name: string;
        folders: string[];
        idea?: string;
        activate?: boolean;
      }) => Promise<{
        ok: boolean;
        project?: { id: string; name: string; folders: string[] };
        threadId?: string;
        activeProjectId?: string | null;
        workspaceRoot?: string;
        error?: string;
        warning?: string;
      }>;
      updateProject?: (payload: {
        id: string;
        name?: string;
        folders?: string[];
        idea?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      deleteProject?: (
        id: string,
      ) => Promise<{
        ok: boolean;
        error?: string;
        warning?: string;
        activeProjectId?: string | null;
        workspaceRoot?: string;
      }>;
      setActiveProject?: (
        id: string | null,
        opts?: { force?: boolean },
      ) => Promise<{
        ok: boolean;
        activeProjectId?: string | null;
        threadId?: string;
        workspaceRoot?: string;
        error?: string;
        busyThreadIds?: string[];
      }>;
      pickProjectFolder?: () => Promise<{
        ok: boolean;
        path?: string;
        cancelled?: boolean;
        error?: string;
      }>;
      listWorkspaces?: () => Promise<{
        ok: boolean;
        workspaces: Array<{
          id: string;
          name: string;
          description?: string;
          projectIds: string[];
          activeProjectId: string | null;
          memberCount: number;
          chatCount: number;
        }>;
      }>;
      createWorkspace?: (payload: {
        name: string;
        description?: string;
        seedItRoles?: boolean;
        division?: string;
      }) => Promise<{
        ok: boolean;
        workspace?: { id: string; name: string; description?: string };
        error?: string;
      }>;
      getWorkspace?: (id: string) => Promise<{
        ok: boolean;
        workspace?: Record<string, unknown>;
        bots?: unknown[];
        chats?: unknown[];
        error?: string;
      }>;
      assignWorkspaceProject?: (payload: {
        workspaceId: string;
        projectId: string;
      }) => Promise<{
        ok: boolean;
        workspace?: unknown;
        workspaceRoot?: string;
        activeProjectId?: string | null;
        error?: string;
        warning?: string;
      }>;
      unassignWorkspaceProject?: (payload: {
        workspaceId: string;
        projectId: string;
      }) => Promise<{ ok: boolean; workspace?: unknown; error?: string }>;
      setWorkspaceActiveProject?: (payload: {
        workspaceId: string;
        projectId: string | null;
        force?: boolean;
      }) => Promise<{
        ok: boolean;
        workspace?: unknown;
        workspaces?: unknown[];
        workspaceRoot?: string;
        activeProjectId?: string | null;
        reused?: boolean;
        error?: string;
        warning?: string;
        busyThreadIds?: string[];
      }>;
      createWorkspaceBot?: (payload: Record<string, unknown>) => Promise<{
        ok: boolean;
        bots?: unknown[];
        error?: string;
      }>;
      updateWorkspaceBot?: (payload: Record<string, unknown>) => Promise<{
        ok: boolean;
        bots?: unknown[];
        error?: string;
      }>;
      deleteWorkspaceBot?: (payload: {
        workspaceId: string;
        botId: string;
      }) => Promise<{ ok: boolean; bots?: unknown[]; error?: string }>;
      updateWorkspaceChat?: (payload: Record<string, unknown>) => Promise<{
        ok: boolean;
        error?: string;
        chat?: {
          id: string;
          name: string;
          replyMode?: "auto" | "mention_only";
          maxResponders?: number;
        };
      }>;
      deleteWorkspace?: (id: string) => Promise<{ ok: boolean; error?: string }>;
      openWorkspaceChat?: (payload: {
        workspaceId: string;
        chatId: string;
      }) => Promise<{
        ok: boolean;
        threadId?: string;
        events?: TranscriptRow[];
        bots?: Array<{ id: string; name: string; role?: string }>;
        chat?: { id: string; name: string };
        workspace?: { id: string; name: string };
        error?: string;
      }>;
      sendWorkspaceGroupPrompt?: (payload: {
        workspaceId: string;
        chatId: string;
        prompt: string;
        attachments?: Array<{ path?: string; absPath?: string }>;
      }) => Promise<{
        ok: boolean;
        threadId?: string;
        replies?: Array<{ botId: string; botName: string; content: string }>;
        note?: string;
        supervisor?: {
          botId?: string | null;
          botName?: string | null;
          status?: string;
          summary?: string;
          gaps?: string[];
          nextActions?: string[];
          note?: string | null;
        } | null;
        autoContinue?: boolean;
        autoContinuePrompt?: string | null;
        error?: string;
      }>;
      openWorkspacesWindow?: () => Promise<{ ok: boolean; error?: string }>;
      getGatewayStatus?: () => Promise<GatewayStatusSnapshot>;
      testLocalGateway?: () => Promise<{ ok: boolean; detail: string }>;
      setGatewayMode?: (
        mode: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      openGatewayLogs?: () => Promise<{
        ok: boolean;
        path?: string;
        error?: string;
      }>;
      getBots?: () => Promise<
        Array<{
          id: string;
          name: string;
          description: string;
          specialized?: boolean;
          threadId?: string | null;
          preview?: string;
          turnCount?: number;
          updatedAt?: string | null;
          tools?: string[];
        }>
      >;
      setActiveBot?: (id: string) => Promise<{
        ok: boolean;
        activeBotId: string;
        threadId?: string;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        events?: TranscriptRow[];
        error?: string;
      }>;
      getLearnedRules?: () => Promise<Array<{ id: string; kind: string; title: string; content: string; updatedAt: string; tags: string[] }>>;
      getSettings?: () => Promise<{
        model: {
          agentModel: string;
          routerBaseUrl: string;
          routerApiKeyConfigured: boolean;
          routerApiKeyMasked: string;
          embeddingModel: string;
          visionModel: string;
          contextWindowTokens: number;
        };
        agent: {
          autoApproveDestructive: boolean;
          runMode?: "auto-review" | "allowlist" | "run-everything";
          toolAllowlist?: string[];
          requirePlanApproval: boolean;
          enableReflection: boolean;
          enableCheckpointer: boolean;
          autoSelfHeal?: boolean;
          selfHealErrorThreshold?: number;
        };
        sandbox: {
          ptyTimeoutMs: number;
          ptyPoolSize: number;
          ptyShell: string;
          allowedFolders: string[];
        };
        desktop: { enabled: boolean; apps: string[] };
        memory: {
          enableReflection: boolean;
          agentsMd: string;
          agentsMdPath: string;
        };
        ui: {
          defaultRailOpen: boolean;
          defaultRailLayer: "canvas" | "files";
          compactActivity: boolean;
          showFooterPhase?: boolean;
          showLearnedInFooter?: boolean;
          openChatPathsInCanvas?: boolean;
          preferStreamedAnswer?: boolean;
        };
        bots: Array<{
          id: string;
          name: string;
          description: string;
          systemPrompt?: string;
          tools?: string[];
        }>;
        toolCatalog: Array<{
          name: string;
          category: string;
          description: string;
        }>;
        paths: Record<string, string>;
        reloadRequiredHint: string;
      }>;
      updateSettings?: (payload: unknown) => Promise<{
        ok: boolean;
        error?: string;
        reloaded?: boolean;
        reloadReason?: string;
        snapshot?: Awaited<
          NonNullable<Window["electronAgent"]>["getSettings"]
        > extends () => Promise<infer R>
          ? R
          : never;
      }>;
      listSessions?: () => Promise<{
        activeThreadId: string;
        activeBotId?: string;
        activeProjectId?: string | null;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        sessions: Array<{
          threadId: string;
          updatedAt: string;
          preview: string;
          turnCount: number;
          projectId?: string | null;
        }>;
      }>;
      newSession?: (opts?: {
        projectId?: string | null;
      }) => Promise<{
        ok: boolean;
        threadId?: string;
        activeBotId?: string;
        activeProjectId?: string | null;
        projectId?: string | null;
        workspaceRoot?: string;
        projectFolders?: string[] | null;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        error?: string;
      }>;
      openSession?: (
        threadId: string,
      ) => Promise<{
        ok: boolean;
        threadId?: string;
        activeBotId?: string;
        projectId?: string | null;
        activeProjectId?: string | null;
        workspaceRoot?: string;
        projectFolders?: string[] | null;
        busyThreadId?: string | null;
        busyThreadIds?: string[];
        busy?: boolean;
        error?: string;
        events?: TranscriptRow[];
      }>;
      clearSession?: (threadId: string) => Promise<{
        ok: boolean;
        threadId?: string;
        events?: TranscriptRow[];
        busyThreadIds?: string[];
        busyThreadId?: string | null;
        error?: string;
      }>;
      deleteSession?: (threadId: string) => Promise<{
        ok: boolean;
        threadId?: string;
        activeThreadId?: string;
        events?: TranscriptRow[];
        switched?: boolean;
        busyThreadIds?: string[];
        busyThreadId?: string | null;
        error?: string;
      }>;
      moveSessionToProject?: (
        threadId: string,
        projectId: string | null,
      ) => Promise<{
        ok: boolean;
        threadId?: string;
        projectId?: string | null;
        busyThreadIds?: string[];
        busyThreadId?: string | null;
        error?: string;
      }>;
      listProcesses?: () => Promise<{
        processes: ManagedProcessRow[];
      }>;
      pollProcess?: (
        pid: number,
      ) => Promise<{ ok: boolean; detail: string }>;
      killProcess?: (
        pid: number,
      ) => Promise<{ ok: boolean; detail: string }>;
      terminalCreate?: (opts?: {
        cols?: number;
        rows?: number;
        cwd?: string;
        shell?: string;
      }) => Promise<{
        ok: boolean;
        session?: {
          id: string;
          cwd: string;
          cols: number;
          rows: number;
          pid: number;
        };
        error?: string;
      }>;
      terminalWrite?: (
        id: string,
        data: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      terminalResize?: (
        id: string,
        cols: number,
        rows: number,
      ) => Promise<{ ok: boolean; error?: string }>;
      terminalKill?: (
        id: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      terminalList?: () => Promise<{
        sessions: Array<{
          id: string;
          cwd: string;
          cols: number;
          rows: number;
          pid: number;
        }>;
      }>;
      onTerminalData?: (
        callback: (payload: { id: string; data: string }) => void,
      ) => () => void;
      onTerminalExit?: (
        callback: (payload: {
          id: string;
          exitCode: number;
          signal?: number;
        }) => void,
      ) => () => void;
      listCapabilities?: () => Promise<{
        skills: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        tools: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        mcp: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        counts: { skills: number; tools: number; mcp: number };
      }>;
      listArtifacts?: () => Promise<{
        artifacts: ArtifactRecord[];
        counts: {
          all: number;
          images: number;
          files: number;
          links: number;
        };
      }>;
      setCapabilityEnabled?: (
        id: string,
        enabled: boolean,
      ) => Promise<{
        ok: boolean;
        error?: string;
        skills?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        tools?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        mcp?: Array<{
          id: string;
          kind: "skills" | "tools" | "mcp";
          name: string;
          category: string;
          description: string;
          badge?: string;
          enabled: boolean;
          detailMarkdown: string;
        }>;
        counts?: { skills: number; tools: number; mcp: number };
        reloaded?: boolean;
        reloadReason?: string;
      }>;
      readWorkspacePreview?: (filePath: string) => Promise<{
        ok: boolean;
        error?: string;
        path?: string;
        basename?: string;
        ext?: string;
        kind?:
          | "markdown"
          | "code"
          | "html"
          | "csv"
          | "spreadsheet"
          | "document"
          | "pdf"
          | "media"
          | "binary"
          | "image"
          | "text"
          | "unsupported";
        language?: string;
        text?: string;
        html?: string;
        dataUrl?: string;
        previewUrl?: string;
        mime?: string;
        size?: number;
        sizeLabel?: string;
        sheets?: Array<{ name: string; rows: string[][] }>;
        truncated?: boolean;
        note?: string;
      }>;
      listWorkspaceDir?: (
        dirPath?: string,
      ) => Promise<
        | {
            ok: true;
            path: string;
            entries: Array<{
              name: string;
              path: string;
              kind: "file" | "dir";
            }>;
          }
        | { ok: false; error: string }
      >;
      listWorkspaceChanges?: () => Promise<{
        ok: boolean;
        entries?: Array<{ path: string; status: string }>;
        error?: string;
      }>;
      discoverDeliverables?: (payload: {
        texts?: string[];
        command?: string;
        maxAgeMs?: number;
      }) => Promise<{ ok: boolean; paths: string[] }>;
      exportWorkspaceFile?: (
        filePath: string,
      ) => Promise<{ ok: boolean; savedAs?: string; error?: string }>;
      revealWorkspaceFile?: (
        filePath: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      openWorkspaceFile?: (
        filePath: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      resolveApproval?: (
        approve: boolean,
        threadId?: string,
      ) => Promise<{
        ok: boolean;
        approve?: boolean;
        threadId?: string;
        error?: string;
      }>;
      getMessagingConfig?: () => Promise<{
        ok: boolean;
        error?: string;
        config?: {
          version: 1;
          whatsapp: {
            enabled: boolean;
            users: string[];
            friends: string[];
            conciseReplies: boolean;
          };
        };
        whatsapp?: {
          status:
            | "disconnected"
            | "connecting"
            | "qr"
            | "connected"
            | "error";
          enabled: boolean;
          hasAuth: boolean;
          me?: string | null;
          lastError?: string | null;
          qrDataUrl?: string | null;
        };
      }>;
      saveMessagingConfig?: (payload: {
        version?: 1;
        whatsapp: {
          enabled: boolean;
          users: string[];
          friends: string[];
          conciseReplies: boolean;
        };
      }) => Promise<{
        ok: boolean;
        error?: string;
        config?: {
          version: 1;
          whatsapp: {
            enabled: boolean;
            users: string[];
            friends: string[];
            conciseReplies: boolean;
          };
        };
        whatsapp?: {
          status:
            | "disconnected"
            | "connecting"
            | "qr"
            | "connected"
            | "error";
          enabled: boolean;
          hasAuth: boolean;
          me?: string | null;
          lastError?: string | null;
          qrDataUrl?: string | null;
        };
      }>;
      whatsappStatus?: () => Promise<{
        ok: boolean;
        whatsapp?: {
          status:
            | "disconnected"
            | "connecting"
            | "qr"
            | "connected"
            | "error";
          enabled: boolean;
          hasAuth: boolean;
          me?: string | null;
          lastError?: string | null;
          qrDataUrl?: string | null;
        };
      }>;
      whatsappStart?: () => Promise<{ ok: boolean; error?: string }>;
      whatsappStop?: () => Promise<{ ok: boolean }>;
      whatsappLogout?: () => Promise<{ ok: boolean; error?: string }>;
      onMessagingEvent?: (
        callback: (event: unknown) => void,
      ) => () => void;
      onEvent: (callback: (event: DesktopAgentEvent) => void) => () => void;
    };
  }
}

type ManagedProcessRow = {
  pid: number;
  command: string;
  startedAt: string;
  source: "process_manage" | "pty";
  slot?: number;
  status: "running" | "exited" | "killed";
  logPreview: string;
};

type TranscriptRow = {
  ts: string;
  role: string;
  content: string;
  meta?: { uiEvent?: AgentUiEvent; [key: string]: unknown };
};

type ActivityRow = { id: string; event: AgentUiEvent; at: string };

type ChatItem =
  | {
      id: string;
      kind: "user";
      text: string;
      at: string;
      attachments?: UserBubbleAttachment[];
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      at: string;
      botId?: string;
      botName?: string;
      botRole?: string;
    }
  | { id: string; kind: "system"; text: string; at: string }
  | { id: string; kind: "reasoning"; text: string; at: string; label?: string; durationSec?: number }
  | {
      id: string;
      kind: "file";
      path: string;
      basename: string;
      at: string;
      note?: string;
    }
  | {
      id: string;
      kind: "trace";
      event: AgentUiEvent;
      at: string;
      /** Args from matching tool_start (for tool_end rows). */
      toolInput?: unknown;
    };

type BridgeStatus = {
  connected: boolean;
  agentReady: boolean;
  agentBooting?: boolean;
  error: string | null;
  model: string;
  workspaceRoot: string;
  profileId: string;
  gateway: GatewayStatusSnapshot | null;
};

function now() {
  return new Date().toLocaleTimeString();
}

function sessionAgeLabel(updatedAt: string): string {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(ageMs) || ageMs < 60_000) return "now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h`;
  return `${Math.floor(ageMs / 86_400_000)}d`;
}

type SessionListRow = {
  threadId: string;
  updatedAt: string;
  preview: string;
  turnCount: number;
  projectId?: string | null;
};

export function App() {
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: "welcome",
      kind: "assistant",
      text: "Agent Desktop ready. Ask a task — thinking, reasoning, and tool calls stream live on the right.",
      at: now(),
    },
  ]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activeTab, setActiveTab] = useState<
    "sessions" | "bots" | "projects"
  >("sessions");
  const [learnedRules, setLearnedRules] = useState<
    Array<{ id: string; kind: string; title: string; content: string; updatedAt: string; tags: string[] }>
  >([]);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [draftReasoning, setDraftReasoning] = useState("");
  const [bots, setBots] = useState<
    Array<{
      id: string;
      name: string;
      description: string;
      specialized?: boolean;
      threadId?: string | null;
      preview?: string;
      turnCount?: number;
      updatedAt?: string | null;
      tools?: string[];
    }>
  >([]);
  const [selectedBotId, setSelectedBotId] = useState("general");
  const specializedBots = useMemo(
    () => bots.filter((b) => b.specialized === true),
    [bots],
  );
  const inBotSession = selectedBotId !== "general";
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [projectsFocusId, setProjectsFocusId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [busyThreadIds, setBusyThreadIds] = useState<string[]>([]);
  const [threadPhases, setThreadPhases] = useState<
    Record<string, AgentPhase>
  >({});
  const [layout, setLayout] = useState<LayoutPrefs>(() => loadLayoutPrefs());
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutsModalOpen, setLayoutsModalOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const v = localStorage.getItem("agent.desktop.theme");
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [ptyLog, setPtyLog] = useState("");
  const [agentLog, setAgentLog] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("agent.desktop.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const appendPty = (chunk: string) => {
    setPtyLog((prev) => appendTerminalLog(prev, chunk));
  };
  const appendAgentLog = (chunk: string) => {
    setAgentLog((prev) => appendTerminalLog(prev, chunk));
  };
  const [composerMode, setComposerMode] = useState<ComposerMode>(() => {
    try {
      const v = localStorage.getItem("agent.desktop.composer.mode");
      return v === "agent" ||
        v === "ask" ||
        v === "plan" ||
        v === "debug"
        ? v
        : "agent";
    } catch {
      return "agent";
    }
  });
  const [composerEffort, setComposerEffort] = useState<ComposerEffort>(() => {
    try {
      const v = localStorage.getItem("agent.desktop.composer.effort");
      if (v === "XHigh" || v === "ExtraHigh") return "ExtraHigh";
      if (
        v === "Minimal" ||
        v === "Low" ||
        v === "Medium" ||
        v === "High" ||
        v === "Max" ||
        v === "Ultra"
      ) {
        return v;
      }
      return "Medium";
    } catch {
      return "Medium";
    }
  });
  const [composerThinking, setComposerThinking] = useState(() => {
    try {
      return localStorage.getItem("agent.desktop.composer.thinking") !== "0";
    } catch {
      return true;
    }
  });
  const [chatDropActive, setChatDropActive] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(true);
  const [privacyMode, setPrivacyModeState] = useState(() => {
    try {
      return localStorage.getItem("agent.desktop.composer.privacy") === "1";
    } catch {
      return false;
    }
  });
  const applyPrivacyMode = useCallback(async (enabled: boolean) => {
    setPrivacyModeState(enabled);
    try {
      localStorage.setItem(
        "agent.desktop.composer.privacy",
        enabled ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
    if (window.electronAgent?.setPrivacyMode) {
      const res = await window.electronAgent.setPrivacyMode(enabled);
      if (res && res.ok === false && res.error) {
        console.warn("[privacy]", res.error);
      }
    }
  }, []);
  const [gitChrome, setGitChrome] = useState<{
    branch: string | null;
    additions: number;
    deletions: number;
    dirty: boolean;
  } | null>(null);
  const [railLayer, setRailLayer] = useState<"canvas" | "files">("canvas");
  const [uiPrefs, setUiPrefs] = useState({
    showFooterPhase: true,
    showLearnedInFooter: true,
    openChatPathsInCanvas: true,
    preferStreamedAnswer: true,
    compactActivity: false,
  });
  const uiPrefsRef = useRef(uiPrefs);
  uiPrefsRef.current = uiPrefs;
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [planApprovalPending, setPlanApprovalPending] = useState(false);
  const [planApprovalBusy, setPlanApprovalBusy] = useState(false);
  const [pendingPlanMarkdown, setPendingPlanMarkdown] = useState<string | null>(
    null,
  );
  const [toolApprovalPending, setToolApprovalPending] = useState(false);
  const [toolApprovalBusy, setToolApprovalBusy] = useState(false);
  const [continueOffer, setContinueOffer] = useState<ContinueOffer | null>(
    null,
  );
  const [continueBusy, setContinueBusy] = useState(false);
  const [toolApprovalDetail, setToolApprovalDetail] = useState<string | null>(
    null,
  );

  const railOpen = layout.railOpen;
  const sidebarOpen = layout.sidebarOpen;
  const terminalOpen = layout.terminalOpen;

  const patchLayout = (
    patch: Partial<LayoutPrefs> | ((prev: LayoutPrefs) => LayoutPrefs),
  ) => {
    setLayout((prev) => {
      const next =
        typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      saveLayoutPrefs(next);
      return next;
    });
  };

  const applyTemplate = (id: LayoutTemplateId) => {
    patchLayout((prev) => applyLayoutTemplate(prev, id));
  };

  const setRailOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    patchLayout((prev) => ({
      ...prev,
      railOpen: typeof value === "function" ? value(prev.railOpen) : value,
    }));
  };
  const [mainView, setMainView] = useState<
    | "chat"
    | "capabilities"
    | "artifacts"
    | "settings"
    | "messaging"
    | "profiles"
    | "kanban"
  >("chat");
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
      folders: string[];
      primaryFolder: string | null;
      isActive: boolean;
    }>
  >([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [profileIds, setProfileIds] = useState<string[]>(["default"]);
  const [sessionFilter, setSessionFilter] = useState<"all" | "busy">("all");
  const stickToBottom = useRef(true);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const globalSessions = useMemo(
    () =>
      sortSessionsForSidebar(
        sessions.filter((s) => !s.projectId),
        busyThreadIds,
      ),
    [sessions, busyThreadIds],
  );
  const sessionsByProject = useMemo(() => {
    const map = new Map<string, SessionListRow[]>();
    for (const s of sessions) {
      if (!s.projectId) continue;
      const list = map.get(s.projectId) ?? [];
      list.push(s);
      map.set(s.projectId, list);
    }
    for (const [key, list] of map) {
      map.set(key, sortSessionsForSidebar(list, busyThreadIds));
    }
    return map;
  }, [sessions, busyThreadIds]);
  const focusedProject = useMemo(
    () => projects.find((p) => p.id === projectsFocusId) ?? null,
    [projects, projectsFocusId],
  );

  const openCanvas = (tab: CanvasTab, switchLayer = true) => {
    const key = normalizeCanvasKey(tab.path) || tab.id;
    setCanvasTabs((prev) => {
      const existing = prev.find(
        (t) =>
          t.id === key ||
          normalizeCanvasKey(t.path) === key ||
          t.id === tab.id,
      );
      if (existing) {
        return prev.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                id: key,
                path: preferCanvasPath(t.path, tab.path),
                basename: tab.basename || t.basename,
                inlineContent: tab.inlineContent ?? t.inlineContent,
                kind: tab.kind,
                language: tab.language,
              }
            : t,
        );
      }
      return [...prev, { ...tab, id: key }].slice(-12);
    });
    setActiveCanvasId(key);
    if (switchLayer) setRailLayer("canvas");
  };
  const openCanvasRef = useRef(openCanvas);
  openCanvasRef.current = openCanvas;

  const appendDeliverableFileChips = (
    texts: string[],
    extraPaths: string[] = [],
    atTs = now(),
  ) => {
    const chips = buildDeliverableFileChips(texts, extraPaths, atTs, {
      limit: 5,
    });
    if (!chips.length) return;
    setItems((prev) => [...prev, ...chips]);
  };
  const appendDeliverableFileChipsRef = useRef(appendDeliverableFileChips);
  appendDeliverableFileChipsRef.current = appendDeliverableFileChips;

  const publishPlanMarkdown = (md: string) => {
    const trimmed = md.trim();
    if (!trimmed) return;
    setPendingPlanMarkdown(trimmed);
    openCanvasRef.current(
      {
        id: "plan:.agent/task/board.md",
        path: ".agent/task/board.md",
        basename: "Plan",
        kind: "markdown",
        language: "markdown",
        inlineContent: trimmed,
      },
      true,
    );
  };

  /** Fill empty plan card from interrupt todos + on-disk board.json. */
  const hydratePlanApprovalContent = async (interruptPayload?: unknown) => {
    const interruptTodos = interruptPayload
      ? extractTodosFromPlanInterrupt(interruptPayload)
      : [];

    let board = null as ReturnType<typeof parseTaskBoardJson>;
    try {
      const res = await window.electronAgent?.readWorkspacePreview?.(
        ".agent/task/board.json",
      );
      if (res?.ok && res.text) {
        board = parseTaskBoardJson(res.text);
      }
    } catch {
      // ignore — fall back to whatever we already have
    }

    const md = formatPlanApprovalMarkdown({
      goal: board?.goal,
      plan: board?.plan,
      skillsUsed: board?.skillsUsed,
      todos: interruptTodos.length ? interruptTodos : board?.todos,
    });

    // Only publish if we have real content (avoid overwriting with empty stub).
    if (board?.goal || board?.plan || interruptTodos.length) {
      publishPlanMarkdown(md);
    }
  };
  const hydratePlanApprovalRef = useRef(hydratePlanApprovalContent);
  hydratePlanApprovalRef.current = hydratePlanApprovalContent;

  const openWorkspacePath = (relPath: string) => {
    const cleaned = relPath.trim().replace(/\\/g, "/");
    if (!cleaned) return;
    const ext = extensionOf(cleaned);
    openCanvas(
      {
        id: normalizeCanvasKey(cleaned) || cleaned,
        path: cleaned,
        basename: basenamePath(cleaned),
        kind: inferPreviewKind(ext),
        language: languageForExt(ext),
      },
      true,
    );
    setMainView("chat");
    setRailOpen(true);
    setRailLayer("canvas");
  };

  const openDiscoveredDeliverables = async (payload: {
    texts?: string[];
    command?: string;
  }) => {
    const api = window.electronAgent?.discoverDeliverables;
    if (!api) return;
    try {
      const res = await api(payload);
      if (!res?.ok || !res.paths?.length) return;
      let first = true;
      for (const p of res.paths) {
        const ext = extensionOf(p);
        const kind = inferPreviewKind(ext);
        if (kind === "code" || kind === "unsupported") continue;
        openCanvasRef.current(
          {
            id: normalizeCanvasKey(p) || p,
            path: p,
            basename: basenamePath(p),
            kind,
            language: languageForExt(ext),
          },
          first && shouldAutoFocusCanvas(kind),
        );
        first = false;
      }
    } catch {
      /* ignore discovery errors */
    }
  };
  const openDiscoveredRef = useRef(openDiscoveredDeliverables);
  openDiscoveredRef.current = openDiscoveredDeliverables;

  const refreshBots = async () => {
    if (!window.electronAgent?.getBots) return;
    const b = await window.electronAgent.getBots();
    if (b) setBots(b);
  };

  useEffect(() => {
    void refreshBots();
    void refreshProjects();
    if (window.electronAgent?.getLearnedRules) {
      window.electronAgent.getLearnedRules().then((r) => r && setLearnedRules(r));
    }
    if (window.electronAgent?.getSettings) {
      void window.electronAgent.getSettings().then((s) => {
        if (!s?.ui) return;
        // Settings default only applies when user has not customized layout yet.
        const saved = loadLayoutPrefs();
        if (
          saved.railOpen === LAYOUT_DEFAULTS.railOpen &&
          saved.sidebarOpen === LAYOUT_DEFAULTS.sidebarOpen
        ) {
          patchLayout({ railOpen: s.ui.defaultRailOpen });
        }
        setRailLayer(s.ui.defaultRailLayer === "files" ? "files" : "canvas");
        setUiPrefs({
          showFooterPhase: s.ui.showFooterPhase !== false,
          showLearnedInFooter: s.ui.showLearnedInFooter !== false,
          openChatPathsInCanvas: s.ui.openChatPathsInCanvas !== false,
          preferStreamedAnswer: s.ui.preferStreamedAnswer !== false,
          compactActivity: Boolean(s.ui.compactActivity),
        });
      });
    }
  }, []);

  const refreshSessions = async (opts?: { syncBusy?: boolean }) => {
    if (!window.electronAgent?.listSessions) return;
    const res = await window.electronAgent.listSessions();
    setSessions(
      (res.sessions || []).map((s) => ({
        ...s,
        preview: sessionPreviewLabel(s.preview || ""),
      })),
    );
    setActiveThreadId(res.activeThreadId);
    if (res.activeBotId) setSelectedBotId(res.activeBotId);
    if ("activeProjectId" in res) {
      setActiveProjectId(res.activeProjectId ?? null);
    }
    // Only sync busy from main when explicitly requested (open/new session).
    // Mid-turn list refreshes must not touch busy badges (avoids wipe/flicker).
    if (
      opts?.syncBusy &&
      (res.busyThreadIds !== undefined || res.busyThreadId !== undefined)
    ) {
      const fromMain = Array.isArray(res.busyThreadIds)
        ? res.busyThreadIds
        : res.busyThreadId
          ? [res.busyThreadId]
          : [];
      busyThreadIdsRef.current = fromMain;
      setBusyThreadIds(fromMain);
    }
    return res;
  };

  const bumpSessionInSidebar = (
    threadId: string | null | undefined,
    previewText: string,
    projectId?: string | null,
  ) => {
    if (!threadId) return;
    const preview = sessionPreviewLabel(previewText || "…");
    setSessions((prev) =>
      touchSessionRow(prev, threadId, {
        preview,
        projectId: projectId ?? activeProjectId,
      }),
    );
  };

  const refreshProjects = async () => {
    if (!window.electronAgent?.listProjects) return;
    const res = await window.electronAgent.listProjects();
    if (!res?.ok) return;
    setProjects(res.projects);
    setActiveProjectId(res.activeProjectId);
  };

  /** Wipe previous-profile UI, then load the active profile's workspace/sessions. */
  const reloadUiForProfile = async (id: string) => {
    sessionCacheRef.current.clear();
    activeThreadIdRef.current = "";
    busyThreadIdsRef.current = [];
    threadPhasesRef.current = {};
    pendingToolsRef.current = [];
    pendingDeliverablesRef.current = [];
    draftRef.current = "";

    setActiveThreadId("");
    setBusyThreadIds([]);
    setThreadPhases({});
    setSessions([]);
    setBots([]);
    setProjects([]);
    setActiveProjectId(null);
    setProjectsFocusId(null);
    setExpandedProjectIds([]);
    setSelectedBotId("general");
    setActiveTab("sessions");
    setMainView("chat");

    setItems([
      {
        id: "welcome",
        kind: "assistant",
        text: `Switched to profile “${id}”. Empty workspace — send a message or open a session.`,
        at: now(),
      },
    ]);
    setActivity([]);
    setDraftAnswer("");
    reasoningRef.current = "";
    setDraftReasoning("");
    reasoningStartedAtRef.current = 0;
    setInput("");
    setPendingAttachments([]);
    setCanvasTabs([]);
    setActiveCanvasId(null);
    setPtyLog("");
    setAgentLog("");
    setPlanApprovalPending(false);
    setPendingPlanMarkdown(null);
    setPlanApprovalBusy(false);
    setToolApprovalPending(false);
    setToolApprovalDetail(null);
    setToolApprovalBusy(false);
    setLoading(false);
    setPhase("boot");
    setMessageFeedback({});
    setCopiedId(null);
    setEditingUserId(null);
    setEditDraft("");
    setLearnedRules([]);
    stickToBottom.current = true;

    const st = await window.electronAgent?.getStatus?.();
    if (st) {
      setStatus({
        connected: true,
        agentReady: st.agentReady,
        error: st.error,
        model: st.model,
        workspaceRoot: st.workspaceRoot,
        profileId: st.profileId || id,
        gateway: st.gateway ?? null,
      });
    } else {
      setStatus((s) => ({ ...s, profileId: id }));
    }

    const listed = await window.electronAgent?.listProfiles?.();
    if (listed?.ok) {
      setProfileIds(listed.profiles.map((p) => p.id));
    }

    await refreshProjects();
    await refreshBots();
    // Profile switch = clean general session (no sticky project / terminal cwd).
    if (window.electronAgent?.newSession) {
      const created = await window.electronAgent.newSession({ projectId: null });
      if (created.ok && created.threadId) {
        syncBusyFromPayload(created.busyThreadIds, created.busyThreadId);
        activeThreadIdRef.current = created.threadId;
        setActiveThreadId(created.threadId);
        setSelectedBotId(created.activeBotId || "general");
        setActiveProjectId(null);
        setProjectsFocusId(null);
        setActiveTab("sessions");
        if (created.workspaceRoot) {
          setStatus((s) => ({ ...s, workspaceRoot: created.workspaceRoot! }));
        }
        setItems([
          {
            id: "welcome",
            kind: "assistant",
            text: `Switched to profile “${id}”. New session — what's the goal?`,
            at: now(),
          },
        ]);
        setActivity([]);
      }
    }
    await refreshSessions({ syncBusy: true });

    if (window.electronAgent?.getLearnedRules) {
      const rules = await window.electronAgent.getLearnedRules();
      if (rules) setLearnedRules(rules);
    }
  };

  const handleProfileSwitch = async (id: string) => {
    const res = await window.electronAgent?.switchProfile?.(id);
    if (!res?.ok) return;
    await reloadUiForProfile(id);
  };

  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    ComposerAttachment[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>("boot");
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null);
  const [tokensPerSec, setTokensPerSec] = useState<number | null>(null);
  const tokenRateRef = useRef({ chars: 0, startedAt: 0 });
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, BubbleFeedback>
  >({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    agentReady: false,
    error: null,
    model: "…",
    workspaceRoot: "…",
    profileId: "default",
    gateway: null,
  });

  useEffect(() => {
    let cancelled = false;
    const refreshGit = async () => {
      if (!window.electronAgent?.getGitSummary) return;
      try {
        const res = await window.electronAgent.getGitSummary();
        if (cancelled || !res) return;
        setGitChrome({
          branch: res.branch,
          additions: res.additions,
          deletions: res.deletions,
          dirty: res.dirty,
        });
      } catch {
        /* ignore */
      }
    };
    void refreshGit();
    const id = window.setInterval(() => void refreshGit(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status.workspaceRoot]);

  useEffect(() => {
    try {
      localStorage.setItem("agent.desktop.composer.mode", composerMode);
      localStorage.setItem("agent.desktop.composer.effort", composerEffort);
      localStorage.setItem(
        "agent.desktop.composer.thinking",
        composerThinking ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
  }, [composerMode, composerEffort, composerThinking]);

  useEffect(() => {
    const clearDrop = () => setChatDropActive(false);
    window.addEventListener("dragend", clearDrop);
    window.addEventListener("drop", clearDrop);
    return () => {
      window.removeEventListener("dragend", clearDrop);
      window.removeEventListener("drop", clearDrop);
    };
  }, []);

  const streamRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  const reasoningRef = useRef("");
  const reasoningStartedAtRef = useRef(0);
  const pendingToolsRef = useRef<Array<{ name: string; input: unknown }>>([]);
  /** Deliverable paths (.docx etc.) referenced by generator scripts, opened after execute. */
  const pendingDeliverablesRef = useRef<string[]>([]);
  const activeThreadIdRef = useRef("");
  const busyThreadIdsRef = useRef<string[]>([]);
  const threadPhasesRef = useRef<Record<string, AgentPhase>>({});
  const sessionCacheRef = useRef<Map<string, SessionUiSnap>>(new Map());
  const liveUiRef = useRef({
    items,
    activity,
    phase: "boot" as AgentPhase,
    planApprovalPending: false,
    pendingPlanMarkdown: null as string | null,
    toolApprovalPending: false,
    toolApprovalDetail: null as string | null,
    canvasTabs,
    activeCanvasId,
    railLayer,
    loading: false,
  });

  activeThreadIdRef.current = activeThreadId;
  busyThreadIdsRef.current = busyThreadIds;
  threadPhasesRef.current = threadPhases;
  liveUiRef.current = {
    items,
    activity,
    phase,
    planApprovalPending,
    pendingPlanMarkdown,
    toolApprovalPending,
    toolApprovalDetail,
    canvasTabs,
    activeCanvasId,
    railLayer,
    loading,
  };

  const captureLiveSnap = (): SessionUiSnap => ({
    ...liveUiRef.current,
    draftAnswer: draftRef.current,
    pendingTools: [...pendingToolsRef.current],
    pendingDeliverables: [...pendingDeliverablesRef.current],
  });

  const applySessionSnap = (snap: SessionUiSnap) => {
    setItems(snap.items);
    setActivity(snap.activity);
    draftRef.current = snap.draftAnswer;
    setDraftAnswer(snap.draftAnswer);
    setPhase(snap.phase);
    setPlanApprovalPending(snap.planApprovalPending);
    setPendingPlanMarkdown(snap.pendingPlanMarkdown ?? null);
    setToolApprovalPending(snap.toolApprovalPending);
    setToolApprovalDetail(snap.toolApprovalDetail ?? null);
    setCanvasTabs(snap.canvasTabs);
    setActiveCanvasId(snap.activeCanvasId);
    setRailLayer(snap.railLayer === "files" ? "files" : "canvas");
    pendingToolsRef.current = [...snap.pendingTools];
    pendingDeliverablesRef.current = [...snap.pendingDeliverables];
    setLoading(snap.loading);
  };

  const stashCurrentSession = () => {
    const id = activeThreadIdRef.current;
    if (!id) return;
    sessionCacheRef.current.set(id, captureLiveSnap());
  };

  const normalizeBusyIds = (
    ids?: string[] | null,
    legacy?: string | null,
  ): string[] => {
    if (Array.isArray(ids)) {
      return [...new Set(ids.filter(Boolean))];
    }
    if (legacy) return [legacy];
    return [];
  };

  const syncBusyFromPayload = (
    ids?: string[] | null,
    legacy?: string | null,
  ) => {
    const next = normalizeBusyIds(ids, legacy);
    busyThreadIdsRef.current = next;
    setBusyThreadIds(next);
  };

  const addBusyThread = (id: string, phase: AgentPhase = "thinking") => {
    if (!id) return;
    if (!busyThreadIdsRef.current.includes(id)) {
      const next = [...busyThreadIdsRef.current, id];
      busyThreadIdsRef.current = next;
      setBusyThreadIds(next);
    }
    const phases = { ...threadPhasesRef.current, [id]: phase };
    threadPhasesRef.current = phases;
    setThreadPhases(phases);
  };

  const removeBusyThread = (id: string) => {
    if (!id) return;
    const next = busyThreadIdsRef.current.filter((t) => t !== id);
    busyThreadIdsRef.current = next;
    setBusyThreadIds(next);
    if (threadPhasesRef.current[id]) {
      const phases = { ...threadPhasesRef.current };
      delete phases[id];
      threadPhasesRef.current = phases;
      setThreadPhases(phases);
    }
  };

  const setThreadPhase = (id: string, nextPhase: AgentPhase) => {
    if (!id) return;
    if (threadPhasesRef.current[id] === nextPhase) return;
    const phases = { ...threadPhasesRef.current, [id]: nextPhase };
    threadPhasesRef.current = phases;
    setThreadPhases(phases);
  };

  const isThreadBusy = (id: string) => busyThreadIdsRef.current.includes(id);

  const applyTranscript = (events: TranscriptRow[]) => {
    pendingToolsRef.current = [];
    const restoredItems: ChatItem[] = [];
    const activityRows: ActivityRow[] = [];
    const pendingTools: Array<{ name: string; input: unknown }> = [];

    for (const ev of events) {
      const at = new Date(ev.ts).toLocaleTimeString();
      if (ev.role === "user") {
        const parsed = parseUserMessageContent(ev.content);
        restoredItems.push({
          id: `u-${ev.ts}-${restoredItems.length}`,
          kind: "user",
          text: parsed.text,
          at,
          attachments: parsed.attachments.length
            ? parsed.attachments
            : undefined,
        });
        continue;
      }
      if (ev.role === "assistant") {
        if (shouldRenderAsReasoning(ev.content)) {
          restoredItems.push({
            id: `r-${ev.ts}-${restoredItems.length}`,
            kind: "reasoning",
            text: ev.content,
            at,
            label: "Model notice",
          });
        } else {
          const botName =
            typeof ev.meta?.botName === "string" ? ev.meta.botName : undefined;
          const botId =
            typeof ev.meta?.botId === "string" ? ev.meta.botId : undefined;
          const botRole =
            typeof ev.meta?.botRole === "string" ? ev.meta.botRole : undefined;
          restoredItems.push({
            id: `a-${ev.ts}-${restoredItems.length}`,
            kind: "assistant",
            text: ev.content,
            at,
            botId,
            botName,
            botRole,
          });
        }
        continue;
      }
      if (ev.role === "error") {
        restoredItems.push({
          id: `e-${ev.ts}-${restoredItems.length}`,
          kind: "system",
          text: ev.content,
          at,
        });
        continue;
      }
      if (ev.role !== "tool") continue;
      const ui = ev.meta?.uiEvent;
      if (!ui || typeof ui !== "object" || !("type" in ui)) continue;

      activityRows.push({
        id: `act-${ev.ts}-${activityRows.length}`,
        event: ui,
        at,
      });

      if (ui.type === "tool_start") {
        pendingTools.push({ name: ui.name, input: ui.input });
        restoredItems.push({
          id: `t-${ev.ts}-${restoredItems.length}`,
          kind: "trace",
          event: ui,
          at,
          toolInput: ui.input,
        });
      } else if (ui.type === "tool_end") {
        let input: unknown = {};
        for (let i = pendingTools.length - 1; i >= 0; i -= 1) {
          if (pendingTools[i]!.name === ui.name) {
            input = pendingTools[i]!.input;
            pendingTools.splice(i, 1);
            break;
          }
        }
        // Prefer upgrading the matching tool_start row when present.
        let upgraded = false;
        for (let i = restoredItems.length - 1; i >= 0; i -= 1) {
          const row = restoredItems[i];
          if (
            row?.kind === "trace" &&
            row.event.type === "tool_start" &&
            row.event.name === ui.name
          ) {
            restoredItems[i] = {
              ...row,
              event: { type: "tool_end", name: ui.name, output: ui.output },
              toolInput: row.toolInput ?? input,
            };
            upgraded = true;
            break;
          }
        }
        if (!upgraded) {
          restoredItems.push({
            id: `t-${ev.ts}-${restoredItems.length}`,
            kind: "trace",
            event: { type: "tool_end", name: ui.name, output: ui.output },
            at,
            toolInput: input,
          });
        }
      } else if (shouldMirrorInChat(ui)) {
        restoredItems.push({
          id: `t-${ev.ts}-${restoredItems.length}`,
          kind: "trace",
          event: ui,
          at,
        });
      }
    }

    setItems(
      restoredItems.length
        ? restoredItems
        : [
            {
              id: "empty",
              kind: "assistant",
              text: "Empty session — send a message to start.",
              at: now(),
            },
          ],
    );
    setActivity(activityRows.length > 200 ? activityRows.slice(-200) : activityRows);
    void hydrateUserAttachmentPreviews(restoredItems);
  };

  const hydrateUserAttachmentPreviews = async (chatItems: ChatItem[]) => {
    if (!window.electronAgent?.readWorkspacePreview) return;
    const updates = new Map<string, UserBubbleAttachment[]>();
    for (const item of chatItems) {
      if (item.kind !== "user" || !item.attachments?.length) continue;
      let changed = false;
      const next = [];
      for (const att of item.attachments) {
        if (att.kind !== "image" || att.previewUrl) {
          next.push(att);
          continue;
        }
        try {
          const res = await window.electronAgent.readWorkspacePreview!(
            att.absPath || att.path,
          );
          if (res?.ok && res.dataUrl) {
            changed = true;
            next.push({ ...att, previewUrl: res.dataUrl });
          } else {
            next.push(att);
          }
        } catch {
          next.push(att);
        }
      }
      if (changed) updates.set(item.id, next);
    }
    if (!updates.size) return;
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== "user") return item;
        const atts = updates.get(item.id);
        return atts ? { ...item, attachments: atts } : item;
      }),
    );
  };

  const restoreThreadView = (
    threadId: string,
    events: TranscriptRow[] | undefined,
    busyIds?: string[] | null,
    legacyBusyId?: string | null,
  ) => {
    if (busyIds !== undefined || legacyBusyId !== undefined) {
      syncBusyFromPayload(busyIds, legacyBusyId);
    }
    const threadBusy = isThreadBusy(threadId);
    const cached = sessionCacheRef.current.get(threadId);
    const turnLive = threadBusy || Boolean(cached?.loading);
    if (turnLive && cached) {
      applySessionSnap({
        ...cached,
        loading: threadBusy || cached.loading,
      });
      if (threadBusy) setThreadPhase(threadId, cached.phase);
      return;
    }
    applyTranscript(events ?? []);
    draftRef.current = "";
    pendingToolsRef.current = [];
    pendingDeliverablesRef.current = [];
    setDraftAnswer("");
    reasoningRef.current = "";
    setDraftReasoning("");
    reasoningStartedAtRef.current = 0;
    setPlanApprovalPending(false);
    setPendingPlanMarkdown(null);
    setToolApprovalPending(false);
    setToolApprovalDetail(null);
    setLoading(threadBusy);
    if (!threadBusy) {
      setPhase("boot");
    }
  };

  useEffect(() => {
    void (async () => {
      // Wait for main boot — MCP/tool load can take >4s on cold start.
      let ready = false;
      for (let i = 0; i < 120; i += 1) {
        const st = await window.electronAgent?.getStatus?.();
        if (st) {
          setStatus((s) => ({
            ...s,
            connected: true,
            agentReady: Boolean(st.agentReady),
            agentBooting: Boolean(st.agentBooting),
            error: st.error,
            model: st.model || s.model,
            workspaceRoot: st.workspaceRoot || s.workspaceRoot,
            profileId: st.profileId || s.profileId,
            gateway: st.gateway ?? s.gateway,
          }));
          if (st.agentReady) {
            ready = true;
            break;
          }
          if (st.error && !st.agentBooting) break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready) {
        const st = await window.electronAgent?.getStatus?.();
        if (st && !st.agentReady) {
          setStatus((s) => ({
            ...s,
            agentReady: false,
            agentBooting: Boolean(st.agentBooting),
            error:
              st.error ||
              (st.agentBooting
                ? "Agent engine is still starting…"
                : "Agent engine not ready"),
          }));
        }
      }
      if (!window.electronAgent?.newSession) return;
      const res = await window.electronAgent.newSession({ projectId: null });
      if (!res.ok || !res.threadId) return;
      syncBusyFromPayload(res.busyThreadIds, res.busyThreadId);
      activeThreadIdRef.current = res.threadId;
      setActiveThreadId(res.threadId);
      setSelectedBotId(res.activeBotId || "general");
      setActiveProjectId(null);
      setProjectsFocusId(null);
      setActiveTab("sessions");
      if (res.workspaceRoot) {
        setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
      }
      setItems([
        {
          id: "welcome",
          kind: "assistant",
          text: "New session. What's the goal?",
          at: now(),
        },
      ]);
      setActivity([]);
      setLoading(false);
      setPhase("boot");
      stickToBottom.current = true;
      await refreshSessions({ syncBusy: true });
      await refreshProjects();
      await refreshBots();
    })();
  }, []);

  const handleNewSession = async (opts?: { projectId?: string | null }) => {
    if (!window.electronAgent?.newSession) return;
    stashCurrentSession();
    // Sessions tab / top button → always general (null). Project "+" → that project.
    const wantProject =
      opts && "projectId" in opts ? (opts.projectId ?? null) : null;
    const res = await window.electronAgent.newSession({
      projectId: wantProject,
    });
    if (!res.ok || !res.threadId) return;
    syncBusyFromPayload(res.busyThreadIds, res.busyThreadId);
    activeThreadIdRef.current = res.threadId;
    setActiveThreadId(res.threadId);
    setSelectedBotId(res.activeBotId || "general");
    const projectId = res.projectId ?? res.activeProjectId ?? wantProject;
    setActiveProjectId(projectId);
    if (res.workspaceRoot) {
      setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
    }
    if (projectId) {
      setActiveTab("projects");
      setProjectsFocusId(projectId);
    } else {
      setActiveTab("sessions");
      setProjectsFocusId(null);
    }
    setMainView("chat");
    setItems([
      {
        id: "welcome",
        kind: "assistant",
        text: projectId
          ? "New project session. What's the goal?"
          : "New session. What's the goal?",
        at: now(),
      },
    ]);
    setActivity([]);
    setContinueOffer(null);
    setContinueBusy(false);
    draftRef.current = "";
    pendingToolsRef.current = [];
    pendingDeliverablesRef.current = [];
    setDraftAnswer("");
    reasoningRef.current = "";
    setDraftReasoning("");
    reasoningStartedAtRef.current = 0;
    setPlanApprovalPending(false);
    setPendingPlanMarkdown(null);
    setToolApprovalPending(false);
    setToolApprovalDetail(null);
    setLoading(false);
    setPhase("boot");
    stickToBottom.current = true;
    await refreshSessions({ syncBusy: true });
    await refreshBots();
    if (projectId === null) {
      await refreshProjects();
    }
  };

  /** Cursor: each chat mode keeps its own context — switching modes starts a fresh thread. */
  const handleComposerModeChange = useCallback(
    (next: ComposerMode) => {
      if (next === composerMode) return;
      setComposerMode(next);
      void handleNewSession({ projectId: activeProjectId });
    },
    // handleNewSession closes over many setters; mode+project are the deps that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composerMode, activeProjectId],
  );

  const handleOpenSession = async (
    threadId: string,
    opts?: { tab?: "sessions" | "bots" | "projects" },
  ) => {
    if (threadId === activeThreadIdRef.current) return;
    if (!window.electronAgent?.openSession) return;
    stashCurrentSession();
    activeThreadIdRef.current = threadId;
    setLoading(false);
    const res = await window.electronAgent.openSession(threadId);
    if (!res.ok) return;
    const nextId = res.threadId || threadId;
    activeThreadIdRef.current = nextId;
    setActiveThreadId(nextId);
    setSelectedBotId(res.activeBotId || "general");
    const sessionProjectId =
      res.projectId !== undefined
        ? (res.projectId ?? null)
        : (sessions.find((s) => s.threadId === nextId)?.projectId ?? null);
    if (res.activeProjectId !== undefined) {
      setActiveProjectId(res.activeProjectId ?? null);
    } else if (!sessionProjectId) {
      setActiveProjectId(null);
    }
    if (res.workspaceRoot) {
      setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
    }
    if (opts?.tab) {
      setActiveTab(opts.tab);
    } else if (res.activeBotId && res.activeBotId !== "general") {
      setActiveTab("bots");
    } else if (sessionProjectId) {
      setActiveTab("projects");
      setProjectsFocusId(sessionProjectId);
    } else {
      setActiveTab("sessions");
      setProjectsFocusId(null);
    }
    setMainView("chat");
    setContinueOffer(null);
    setContinueBusy(false);
    restoreThreadView(nextId, res.events, res.busyThreadIds, res.busyThreadId);
    stickToBottom.current = true;
    await refreshSessions({ syncBusy: true });
    await refreshBots();
    if (!sessionProjectId) {
      await refreshProjects();
    }
  };

  const handleClearSession = async (threadId: string) => {
    if (!window.electronAgent?.clearSession) return;
    const res = await window.electronAgent.clearSession(threadId);
    if (!res.ok) return;
    sessionCacheRef.current.delete(threadId);
    if (threadId === activeThreadIdRef.current) {
      setItems([
        {
          id: "empty",
          kind: "assistant",
          text: "Session cleared — send a message to start.",
          at: now(),
        },
      ]);
      setActivity([]);
      setDraftAnswer("");
      reasoningRef.current = "";
      setDraftReasoning("");
      reasoningStartedAtRef.current = 0;
      draftRef.current = "";
      setCanvasTabs([]);
      setActiveCanvasId(null);
      setPlanApprovalPending(false);
      setPendingPlanMarkdown(null);
      setToolApprovalPending(false);
      setToolApprovalDetail(null);
      setContinueOffer(null);
      setContinueBusy(false);
      setLoading(false);
      setPhase("boot");
    }
    await refreshSessions({ syncBusy: true });
  };

  const handleDeleteSession = async (threadId: string) => {
    if (!window.electronAgent?.deleteSession) return;
    const res = await window.electronAgent.deleteSession(threadId);
    if (!res.ok) return;
    sessionCacheRef.current.delete(threadId);
    removeBusyThread(threadId);
    if (res.switched && res.activeThreadId) {
      activeThreadIdRef.current = res.activeThreadId;
      setActiveThreadId(res.activeThreadId);
      if ((res.events?.length ?? 0) > 0) {
        applyTranscript(res.events ?? []);
      } else {
        setItems([
          {
            id: "empty",
            kind: "assistant",
            text: "Empty session — send a message to start.",
            at: now(),
          },
        ]);
        setActivity([]);
        setDraftAnswer("");
        reasoningRef.current = "";
        setDraftReasoning("");
        reasoningStartedAtRef.current = 0;
        draftRef.current = "";
        setCanvasTabs([]);
        setActiveCanvasId(null);
        setPlanApprovalPending(false);
        setPendingPlanMarkdown(null);
        setToolApprovalPending(false);
        setToolApprovalDetail(null);
        setLoading(false);
        setPhase("boot");
      }
    }
    await refreshSessions({ syncBusy: true });
    await refreshProjects();
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!window.electronAgent?.deleteProject) return;
    const ok = window.confirm(
      `Hapus project “${projectName}”?\n\nFolder di disk tidak dihapus. Session yang terikat project ini tetap ada (jadi session global).`,
    );
    if (!ok) return;
    const res = await window.electronAgent.deleteProject(projectId);
    if (!res.ok) {
      window.alert(res.error || "Gagal menghapus project");
      return;
    }
    if (projectsFocusId === projectId) setProjectsFocusId(null);
    setExpandedProjectIds((prev) => prev.filter((id) => id !== projectId));
    if (res.activeProjectId !== undefined) {
      setActiveProjectId(res.activeProjectId ?? null);
    }
    if (res.workspaceRoot) {
      setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
    }
    if (res.warning) {
      window.alert(res.warning);
    }
    await refreshProjects();
    await refreshSessions({ syncBusy: true });
  };

  const handleMoveSessionToProject = async (
    threadId: string,
    projectId: string | null,
  ) => {
    if (!window.electronAgent?.moveSessionToProject) return;
    const res = await window.electronAgent.moveSessionToProject(
      threadId,
      projectId,
    );
    if (!res.ok) return;
    const cached = sessionCacheRef.current.get(threadId);
    if (cached) {
      sessionCacheRef.current.set(threadId, cached);
    }
    await refreshSessions({ syncBusy: true });
    await refreshProjects();
    if (projectId) {
      setActiveTab("projects");
      setProjectsFocusId(projectId);
      setExpandedProjectIds((prev) =>
        prev.includes(projectId) ? prev : [...prev, projectId],
      );
    } else if (threadId === activeThreadIdRef.current) {
      setActiveTab("sessions");
      setProjectsFocusId(null);
    }
  };

  const handleOpenBot = async (botId: string) => {
    if (!window.electronAgent?.setActiveBot) return;
    if (botId === selectedBotId && activeTab === "bots") return;
    stashCurrentSession();
    const res = await window.electronAgent.setActiveBot(botId);
    if (!res.ok) return;
    setSelectedBotId(res.activeBotId || botId);
    if (res.threadId) {
      activeThreadIdRef.current = res.threadId;
      setActiveThreadId(res.threadId);
    }
    setActiveTab("bots");
    setMainView("chat");
    if (res.threadId) {
      restoreThreadView(
        res.threadId,
        res.events,
        res.busyThreadIds,
        res.busyThreadId,
      );
    }
    stickToBottom.current = true;
    await refreshSessions({ syncBusy: true });
    await refreshBots();
  };

  const applyProjectContext = async (opts: {
    threadId?: string;
    workspaceRoot?: string;
    activeProjectId?: string | null;
  }) => {
    if (opts.activeProjectId !== undefined) {
      setActiveProjectId(opts.activeProjectId);
    }
    if (opts.workspaceRoot) {
      setStatus((s) => ({ ...s, workspaceRoot: opts.workspaceRoot! }));
    }
    if (opts.threadId) {
      stashCurrentSession();
      activeThreadIdRef.current = opts.threadId;
      setActiveThreadId(opts.threadId);
      setSelectedBotId("general");
      if (opts.activeProjectId) {
        setActiveTab("projects");
        setProjectsFocusId(opts.activeProjectId);
      } else {
        setActiveTab("sessions");
        setProjectsFocusId(null);
      }
      setMainView("chat");
      setItems([
        {
          id: "welcome",
          kind: "assistant",
          text: opts.activeProjectId
            ? `Project session ready. Only files inside this project's folders are in scope.`
            : "Global session. What's the goal?",
          at: now(),
        },
      ]);
      setActivity([]);
      draftRef.current = "";
      setDraftAnswer("");
      reasoningRef.current = "";
      setDraftReasoning("");
      reasoningStartedAtRef.current = 0;
      setLoading(false);
      setPhase("boot");
    }
    await refreshProjects();
    await refreshSessions({ syncBusy: true });
    await refreshBots();
  };

  const handleActivateProject = async (id: string | null) => {
    if (!window.electronAgent?.setActiveProject) return;
    let res = await window.electronAgent.setActiveProject(id);
    if (!res.ok && res.error?.includes("running turns")) {
      // Leaving project (id=null) should soft-detach without confirm; only prompt when switching TO a project.
      if (id !== null && id !== undefined && id !== "") {
        const busy =
          Array.isArray(res.busyThreadIds) && res.busyThreadIds.length
            ? `\n\nBusy: ${res.busyThreadIds.join(", ")}`
            : "";
        const ok = window.confirm(
          `Masih ada turn yang jalan, jadi project belum bisa diganti.${busy}\n\nStop turn itu dan pindah sekarang?`,
        );
        if (!ok) return;
        res = await window.electronAgent.setActiveProject(id, { force: true });
      }
    }
    if (!res.ok) {
      window.alert(res.error || "Could not switch project");
      return;
    }
    const soft =
      Boolean((res as { softDetached?: boolean }).softDetached) ||
      Boolean((res as { reused?: boolean }).reused);
    if (soft || id === null) {
      setActiveProjectId(res.activeProjectId ?? null);
      if (!res.activeProjectId) {
        setActiveTab("sessions");
        setProjectsFocusId(null);
      }
      if (res.workspaceRoot) {
        setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
      }
      await refreshProjects();
      await refreshSessions({ syncBusy: true });
      return;
    }
    await applyProjectContext({
      threadId: res.threadId,
      workspaceRoot: res.workspaceRoot,
      activeProjectId: res.activeProjectId ?? null,
    });
  };

  const handleEnterProject = async (id: string) => {
    setExpandedProjectIds((prev) =>
      prev.includes(id) ? prev : [...prev, id],
    );
    setProjectsFocusId(id);
    setActiveTab("projects");
    if (activeProjectId === id) return;
    await handleActivateProject(id);
  };

  const handleOpenProjectSession = async (
    projectId: string,
    threadId: string,
  ) => {
    setProjectsFocusId(projectId);
    setActiveTab("projects");
    if (activeProjectId !== projectId) {
      if (!window.electronAgent?.setActiveProject) return;
      let res = await window.electronAgent.setActiveProject(projectId);
      if (!res.ok && res.error?.includes("running turns")) {
        const ok = window.confirm(
          "Masih ada turn yang jalan. Stop dan pindah project sekarang?",
        );
        if (!ok) return;
        res = await window.electronAgent.setActiveProject(projectId, {
          force: true,
        });
      }
      if (!res.ok) {
        window.alert(res.error || "Could not switch project");
        return;
      }
      if (res.activeProjectId !== undefined) {
        setActiveProjectId(res.activeProjectId ?? null);
      }
      if (res.workspaceRoot) {
        setStatus((s) => ({ ...s, workspaceRoot: res.workspaceRoot! }));
      }
      await refreshProjects();
      await refreshSessions({ syncBusy: true });
    }
    await handleOpenSession(threadId, { tab: "projects" });
  };

  const toggleProjectAccordion = (id: string) => {
    setExpandedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleReturnToSessions = async () => {
    if (!window.electronAgent?.setActiveBot) return;
    stashCurrentSession();
    const res = await window.electronAgent.setActiveBot("general");
    if (!res.ok) return;
    setSelectedBotId("general");
    if (res.threadId) {
      activeThreadIdRef.current = res.threadId;
      setActiveThreadId(res.threadId);
      restoreThreadView(
        res.threadId,
        res.events,
        res.busyThreadIds,
        res.busyThreadId,
      );
    }
    setActiveTab("sessions");
    setProjectsFocusId(null);
    if (activeProjectId) {
      void handleActivateProject(null);
    }
    stickToBottom.current = true;
    await refreshSessions({ syncBusy: true });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.electronAgent?.getStatus) {
        setStatus({
          connected: false,
          agentReady: false,
          error: "Preload bridge missing. Run npm run desktop:start.",
          model: "demo",
          workspaceRoot: "(browser preview)",
          profileId: "default",
          gateway: null,
        });
        return;
      }
      try {
        const s = await window.electronAgent.getStatus();
        if (cancelled) return;
        setStatus({
          connected: true,
          agentReady: s.agentReady,
          agentBooting: Boolean(s.agentBooting),
          error: s.error,
          model: s.model,
          workspaceRoot: s.workspaceRoot,
          profileId: s.profileId || "default",
          gateway: s.gateway ?? null,
        });
        // Push composer Privacy toggle into the sandbox allowlist.
        if (s.agentReady && window.electronAgent?.setPrivacyMode) {
          const localOn =
            localStorage.getItem("agent.desktop.composer.privacy") === "1";
          void window.electronAgent.setPrivacyMode(localOn).then((res) => {
            if (cancelled || !res?.ok) return;
            if (typeof res.privacyMode === "boolean") {
              setPrivacyModeState(res.privacyMode);
            }
          });
        }
        // Do not re-stick activeProjectId from getStatus on boot — launch
        // always starts a fresh general session (see newSession mount effect).
        void refreshProjects();
        const profiles = await window.electronAgent.listProfiles?.();
        if (profiles?.ok && !cancelled) {
          setProfileIds(profiles.profiles.map((p) => p.id));
        }
      } catch (e) {
        if (cancelled) return;
        setStatus({
          connected: false,
          agentReady: false,
          error: e instanceof Error ? e.message : String(e),
          model: "unknown",
          workspaceRoot: "unknown",
          profileId: "default",
          gateway: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAgent?.onEvent) return;
    return window.electronAgent.onEvent((event) => {
      const at = now();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const eventTid =
        typeof event.threadId === "string" && event.threadId.trim()
          ? event.threadId.trim()
          : null;
      // Live UI falls back to active thread; busy badge updates require explicit threadId
      // so stray errors without threadId cannot wipe the THINKING label.
      const tid = eventTid || activeThreadIdRef.current;

      if (eventTid) {
        if (event.type === "status" && event.detail === "turn started") {
          addBusyThread(eventTid, "thinking");
          void refreshSessions();
        }
        if (event.type === "status") {
          setThreadPhase(eventTid, event.phase);
          // Keep busy while waiting on approvals / tools — only clear on terminal phases
          if (
            event.phase !== "done" &&
            event.phase !== "error" &&
            event.phase !== "reflecting" &&
            event.phase !== "boot"
          ) {
            addBusyThread(eventTid, event.phase);
          }
        }
        if (
          event.type === "done" ||
          event.type === "error" ||
          (event.type === "status" &&
            (event.phase === "done" || event.phase === "error"))
        ) {
          removeBusyThread(eventTid);
          void refreshSessions();
        }
      }

      const isLive = !tid || tid === activeThreadIdRef.current;
      if (!isLive) {
        if (event.type === "pty") {
          appendPty(event.text);
          return;
        }
        const base = sessionCacheRef.current.get(tid) ?? emptySessionSnap();
        const reduced = reduceSessionEvent(base, event, { id, at });
        sessionCacheRef.current.set(tid, reduced);
        return;
      }

      if (event.type === "status") {
        setPhase(event.phase);
        const detail = String(event.detail || "").trim();
        if (detail === "agent ready") {
          setStatus((s) => ({
            ...s,
            agentReady: true,
            agentBooting: false,
            error: null,
          }));
        }
        if (detail && detail !== "turn started") {
          setPhaseDetail(detail);
          appendAgentLog(`[status] ${event.phase} · ${detail}\n`);
        } else if (event.phase === "thinking" || event.phase === "boot") {
          setPhaseDetail(null);
        }
        if (
          event.phase === "waiting_approval" &&
          /plan approval/i.test(event.detail)
        ) {
          setPlanApprovalPending(true);
          setRailLayer("canvas");
          setRailOpen(true);
          void hydratePlanApprovalRef.current();
        } else if (event.phase === "waiting_approval") {
          setToolApprovalPending(true);
          setToolApprovalDetail(
            String(event.detail || "").trim() || "Tool approval required",
          );
        }
        if (event.phase === "done" || event.phase === "error") {
          setLoading(false);
          // Keep Approve UI if we're still gating on a saved plan (model often
          // ends after task_plan without an interrupt). Error clears the gate.
          if (event.phase === "error") {
            setPlanApprovalPending(false);
            setPendingPlanMarkdown(null);
            setToolApprovalPending(false);
            setToolApprovalDetail(null);
          }
        }
        // Reflection is background — never keep the composer locked on it.
        if (event.phase === "reflecting") {
          setLoading(false);
        }
        if (event.detail === "turn started") {
          setLoading(true);
        }
      }

      if (event.type === "interrupt") {
        if (isPlanApprovalInterrupt(event.payload)) {
          setPlanApprovalPending(true);
          setToolApprovalPending(false);
          setToolApprovalDetail(null);
          setRailLayer("canvas");
          setRailOpen(true);
          void hydratePlanApprovalRef.current(event.payload);
        } else {
          setToolApprovalPending(true);
          setToolApprovalDetail(formatToolApprovalDetail(event.payload));
        }
      }

      const flushReasoningToChat = (stamp: string) => {
        const text = reasoningRef.current.trim();
        if (!text) return;
        const started = reasoningStartedAtRef.current;
        const durationSec =
          started > 0 ? Math.max(0.1, (Date.now() - started) / 1000) : undefined;
        reasoningRef.current = "";
        setDraftReasoning("");
        reasoningStartedAtRef.current = 0;
        setItems((prev) => [
          ...prev,
          {
            id: `r-${stamp}-${prev.length}`,
            kind: "reasoning" as const,
            text,
            at: stamp,
            durationSec,
          },
        ]);
      };

      if (event.type === "reasoning") {
        const chunk = String(event.text || "");
        if (chunk) {
          if (!reasoningStartedAtRef.current) {
            reasoningStartedAtRef.current = Date.now();
          }
          reasoningRef.current += chunk;
          setDraftReasoning(reasoningRef.current);
        }
      }

      if (event.type === "token") {
        if (reasoningRef.current.trim()) {
          flushReasoningToChat(at);
        }
        const chunk = event.text || "";
        draftRef.current += chunk;
        setDraftAnswer(draftRef.current);
        const tr = tokenRateRef.current;
        if (!tr.startedAt) tr.startedAt = Date.now();
        tr.chars += chunk.length;
        const elapsedSec = (Date.now() - tr.startedAt) / 1000;
        if (elapsedSec >= 0.25) {
          // Rough token estimate: ~4 chars per token for Latin text.
          setTokensPerSec(tr.chars / 4 / elapsedSec);
        }
      }

      if (event.type === "pty") {
        appendPty(event.text);
      }

      if (event.type === "done") {
        const preferStreamed = uiPrefsRef.current.preferStreamedAnswer;
        const finalText = (
          preferStreamed
            ? resolveFinalAssistantText(event.text, draftRef.current)
            : sanitizeAssistantText(
                String(event.text || draftRef.current || ""),
              )
        ).trim();
        draftRef.current = "";
        setDraftAnswer("");
        if (reasoningRef.current.trim()) {
          flushReasoningToChat(at);
        }
        setLoading(false);
        setTokensPerSec(null);
        tokenRateRef.current = { chars: 0, startedAt: 0 };
        if (finalText && shouldRenderAsReasoning(finalText)) {
          setItems((prev) => {
            const next = [
              ...prev,
              {
                id,
                kind: "reasoning" as const,
                text: finalText,
                at,
                label: "Model notice",
              },
            ];
            if (
              /no longer available|please switch|model.*not found|antigravity/i.test(
                finalText,
              )
            ) {
              const lastUser = [...prev]
                .reverse()
                .find((m) => m.kind === "user");
              const promptText =
                lastUser && lastUser.kind === "user" ? lastUser.text : "";
              if (promptText.trim()) {
                const suggested = extractSuggestedModel(finalText);
                queueMicrotask(() => {
                  setContinueOffer((cur) =>
                    cur ?? {
                      reason: "model_unavailable",
                      prompt: promptText,
                      suggestedModel: suggested,
                      notice: finalText.slice(0, 500),
                    },
                  );
                });
              }
            }
            return next;
          });
        } else if (finalText) {
          const evAny = event as {
            botName?: unknown;
            botId?: unknown;
          };
          const botName =
            typeof evAny.botName === "string" ? evAny.botName : undefined;
          const botId =
            typeof evAny.botId === "string" ? evAny.botId : undefined;
          setItems((prev) => [
            ...prev,
            {
              id,
              kind: "assistant",
              text: finalText,
              at,
              botId,
              botName,
            },
          ]);
        }
        setPhase("done");
        // Final answer often cites the deliverable path — open it in Canvas + chat chip.
        if (finalText) {
          void openDiscoveredRef.current({ texts: [finalText] });
          appendDeliverableFileChipsRef.current(
            [finalText],
            [...pendingDeliverablesRef.current],
            at,
          );
        }
      }

      if (event.type === "warning" && /retrying/i.test(event.message)) {
        draftRef.current = "";
        setDraftAnswer("");
        reasoningRef.current = "";
        setDraftReasoning("");
        reasoningStartedAtRef.current = 0;
      }

      if (event.type === "warning") {
        appendAgentLog(`[warn] ${event.message}\n`);
      }

      if (event.type === "error") {
        appendAgentLog(`[error] ${event.message}\n`);
        setItems((prev) => [
          ...prev,
          { id, kind: "system", text: event.message, at },
        ]);
        setPhase("error");
        setLoading(false);
        setTokensPerSec(null);
        tokenRateRef.current = { chars: 0, startedAt: 0 };
      }

      if (event.type === "continue_available") {
        setContinueOffer({
          reason: event.reason,
          prompt: event.prompt,
          suggestedModel: event.suggestedModel,
          notice: event.notice,
        });
        setLoading(false);
      }

      // Keep a dense live activity log (skip raw token / pty spam)
      if (event.type !== "token" && event.type !== "pty") {
        setActivity((prev) => {
          const next = [...prev, { id, event, at }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }

      if (event.type === "tool_start") {
        if (reasoningRef.current.trim()) {
          flushReasoningToChat(at);
        }
        pendingToolsRef.current.push({ name: event.name, input: event.input });
        setItems((prev) => [
          ...prev,
          {
            id: `t-${id}`,
            kind: "trace",
            event,
            at,
            toolInput: event.input,
          },
        ]);
      }

      if (event.type === "tool_end") {
        const pending = pendingToolsRef.current;
        let input: unknown = {};
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (pending[i]!.name === event.name) {
            input = pending[i]!.input;
            pending.splice(i, 1);
            break;
          }
        }
        const artifacts = resolveArtifactsFromTool({
          name: event.name,
          input,
          output: event.output,
        });

        if (
          event.name === "execute" ||
          /pty|shell|command/i.test(event.name)
        ) {
          const out = (event.output || "").trim();
          const args = asRecord(input);
          const command = String(args.command ?? args.cmd ?? event.name);
          appendAgentLog(`$ ${command}\n${out ? `${out}\n` : ""}`);
          if (out) appendPty(`\n$ ${command}\n${out}\n`);
        }

        // Show coding plan in Canvas + chat right after task_plan saves.
        if (event.name === "task_plan") {
          const parsed = parseTaskPlanArgs(input);
          if (parsed.plan || parsed.goal) {
            const md = formatPlanApprovalMarkdown(parsed);
            setPendingPlanMarkdown(md);
            setPlanApprovalPending(true);
            openCanvasRef.current(
              {
                id: "plan:.agent/task/board.md",
                path: ".agent/task/board.md",
                basename: "Plan",
                kind: "markdown",
                language: "markdown",
                inlineContent: md,
              },
              true,
            );
          }
        }

        const isFileWrite =
          event.name === "write_file" ||
          event.name === "write" ||
          event.name === "edit_file" ||
          event.name === "edit";
        const wroteCode = artifacts.some((a) => a.kind === "code");

        // Generator scripts (.py/.js) often name the real output — open after execute.
        if (wroteCode && isFileWrite) {
          for (const a of artifacts) {
            if (
              shouldAutoFocusCanvas(a.kind) &&
              !pendingDeliverablesRef.current.includes(a.path)
            ) {
              pendingDeliverablesRef.current.push(a.path);
            }
          }
        }

        const merged: ActivityArtifact[] = [...artifacts];
        const isShell =
          event.name === "execute" ||
          event.name === "shell" ||
          event.name === "bash";
        if (isShell) {
          for (const p of pendingDeliverablesRef.current) {
            if (!merged.some((a) => a.path === p)) {
              const ext = extensionOf(p);
              merged.push({
                path: p,
                basename: basenamePath(p),
                ext,
                kind: inferPreviewKind(ext),
                language: languageForExt(ext),
                source: "path_only",
              });
            }
          }
          merged.sort(
            (a, b) => canvasResultRank(b.kind) - canvasResultRank(a.kind),
          );
          pendingDeliverablesRef.current = [];
        }

        const focus = pickAutoFocusArtifact(merged);
        for (const a of merged) {
          // Never auto-open generator/source code — show the hasil (docx/md/…).
          if (a.kind === "code" || a.kind === "unsupported") continue;
          // Referenced outputs inside a script: wait until shell runs.
          if (wroteCode && isFileWrite && a.source === "path_only") continue;
          openCanvasRef.current(
            artifactToCanvasTab(a),
            focus?.path === a.path,
          );
        }

        // Shell: also discover deliverables by reading the script + recent files.
        if (isShell) {
          const args = asRecord(input);
          const command = String(args.command ?? args.cmd ?? "");
          void openDiscoveredRef.current({
            command,
            texts: [command, String(event.output ?? "")],
          });
        }

        const endEvent: AgentUiEvent = {
          type: "tool_end",
          name: event.name,
          output: event.output,
        };
        setItems((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const row = next[i];
            if (
              row?.kind === "trace" &&
              row.event.type === "tool_start" &&
              row.event.name === event.name
            ) {
              next[i] = {
                ...row,
                event: endEvent,
                toolInput: row.toolInput ?? input,
              };
              return next;
            }
          }
          return [
            ...next,
            {
              id: `t-${id}`,
              kind: "trace",
              event: endEvent,
              at,
              toolInput: input,
            },
          ];
        });
      } else if (shouldMirrorInChat(event) && event.type !== "tool_start") {
        setItems((prev) => [
          ...prev,
          { id: `t-${id}`, kind: "trace", event, at },
        ]);
      }
    });
  }, []);

  useEffect(() => {
    if (!planApprovalPending) return;
    if (pendingPlanMarkdown?.trim()) return;
    void hydratePlanApprovalRef.current();
  }, [planApprovalPending, pendingPlanMarkdown]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items, draftAnswer, draftReasoning, loading, planApprovalPending, pendingPlanMarkdown, toolApprovalPending, toolApprovalDetail]);

  const onStreamScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = dist < 80;
  };

  const handleSend = async (
    promptOverride?: string,
    options?: {
      truncateFromId?: string;
      /** Resume after model failure — keep full history, no new user bubble. */
      continueMode?: boolean;
    },
  ) => {
    const prompt = (promptOverride ?? input).trim();
    const attachmentsForSend =
      promptOverride != null ? [] : [...pendingAttachments];
    if ((!prompt && attachmentsForSend.length === 0) || loading) return;
    if (!status.agentReady) {
      const msg = status.agentBooting
        ? "Agent engine is still starting (tools/MCP)… wait a moment and retry."
        : status.error ||
          "Agent engine not ready. Check terminal for boot errors (ROUTER_API_KEY, etc).";
      setStatus((s) => ({ ...s, error: msg }));
      setItems((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          kind: "system",
          text: msg,
          at: now(),
        },
      ]);
      return;
    }
    const turnId = activeThreadIdRef.current;
    if (turnId && isThreadBusy(turnId)) return;

    const truncateId = options?.truncateFromId;
    const continueMode = Boolean(options?.continueMode);
    const cutIdx = truncateId
      ? items.findIndex((m) => m.id === truncateId)
      : -1;

    const bubbleAttachments: UserBubbleAttachment[] = attachmentsForSend.map(
      (a) => ({
        path: a.path,
        absPath: a.absPath,
        basename: a.basename,
        kind: a.kind,
        mime: a.mime,
        size: a.size,
        label: a.label,
        previewUrl: a.previewUrl,
      }),
    );

    const displayText = prompt;
    const sidebarPreview =
      displayText ||
      attachmentsForSend[0]?.label ||
      attachmentsForSend[0]?.basename ||
      "…";

    if (!promptOverride) {
      setInput("");
      setPendingAttachments([]);
    }
    setContinueOffer(null);
    setEditingUserId(null);
    setEditDraft("");
    setLoading(true);
    setPhase("thinking");
    setPhaseDetail(null);
    setTokensPerSec(null);
    tokenRateRef.current = { chars: 0, startedAt: 0 };
    if (turnId) {
      addBusyThread(turnId, "thinking");
      bumpSessionInSidebar(turnId, sidebarPreview);
    }
    draftRef.current = "";
    setDraftAnswer("");
    reasoningRef.current = "";
    setDraftReasoning("");
    reasoningStartedAtRef.current = 0;
    setItems((prev) => {
      const base =
        truncateId != null
          ? (() => {
              const idx = prev.findIndex((m) => m.id === truncateId);
              return idx < 0 ? prev : prev.slice(0, idx);
            })()
          : prev;
      if (continueMode) {
        return [
          ...base,
          {
            id: `s-cont-${Date.now()}`,
            kind: "system" as const,
            text: "↩ Continuing previous task (history preserved)…",
            at: now(),
          },
        ];
      }
      return [
        ...base,
        {
          id: `u-${Date.now()}`,
          kind: "user" as const,
          text: displayText,
          at: now(),
          attachments: bubbleAttachments.length
            ? bubbleAttachments
            : undefined,
        },
      ];
    });
    if (cutIdx >= 0) {
      const keptIds = new Set(items.slice(0, cutIdx).map((m) => m.id));
      setMessageFeedback((prev) => {
        const next: Record<string, BubbleFeedback> = {};
        for (const [id, v] of Object.entries(prev)) {
          if (keptIds.has(id)) next[id] = v;
        }
        return next;
      });
    }

    try {
      if (!window.electronAgent?.sendPrompt) {
        setItems((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            kind: "system",
            text: "Bridge tidak terhubung. Jalankan: npm run desktop:start",
            at: now(),
          },
        ]);
        return;
      }
      const res = await window.electronAgent.sendPrompt(
        prompt,
        attachmentsForSend.map((a) => ({
          path: a.path,
          absPath: a.absPath,
          basename: a.basename,
          kind: a.kind,
        })),
        { chatMode: composerMode },
      );
      if (!res.ok && res.error) {
        // error event may already have been emitted
        if (activeThreadIdRef.current === turnId) {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === "system" && last.text === res.error) return prev;
            return [
              ...prev,
              {
                id: `e-${Date.now()}`,
                kind: "system",
                text: res.error!,
                at: now(),
              },
            ];
          });
        } else if (turnId) {
          const base = sessionCacheRef.current.get(turnId) ?? emptySessionSnap();
          sessionCacheRef.current.set(turnId, {
            ...base,
            items: [
              ...base.items,
              {
                id: `e-${Date.now()}`,
                kind: "system",
                text: res.error!,
                at: now(),
              },
            ],
            loading: false,
            phase: "error",
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (activeThreadIdRef.current === turnId) {
        setItems((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            kind: "system",
            text: msg,
            at: now(),
          },
        ]);
      }
    } finally {
      if (activeThreadIdRef.current === turnId) {
        setLoading(false);
      }
      if (turnId) removeBusyThread(turnId);
      if (turnId) {
        const cached = sessionCacheRef.current.get(turnId);
        if (cached?.loading) {
          sessionCacheRef.current.set(turnId, { ...cached, loading: false });
        }
      }
      void refreshSessions();
      void refreshBots();
    }
  };

  const appendPendingAttachments = (files: ComposerAttachment[]) => {
    setPendingAttachments((prev) => {
      const seen = new Set(prev.map((p) => p.path));
      const next = [...prev];
      for (const f of files) {
        if (seen.has(f.path)) continue;
        seen.add(f.path);
        next.push(f);
      }
      return next;
    });
  };

  const handleAttachError = (message: string) => {
    setItems((prev) => [
      ...prev,
      {
        id: `s-${Date.now()}`,
        kind: "system",
        text: message,
        at: now(),
      },
    ]);
  };

  const importDroppedPaths = async (paths: string[]) => {
    if (!paths.length) return;
    if (!window.electronAgent?.importAttachmentPaths) {
      handleAttachError("Drop import unavailable. Restart the desktop app.");
      return;
    }
    const res = await window.electronAgent.importAttachmentPaths(paths);
    if (!res?.ok) {
      handleAttachError(res?.error || "Could not import dropped files");
      return;
    }
    appendPendingAttachments(
      res.files.map((f) => ({
        path: f.path,
        absPath: f.absPath,
        basename: f.basename,
        mime: f.mime,
        size: f.size,
        kind: f.kind,
        previewUrl: f.previewUrl,
        label: f.label,
        subtitle: f.absPath || f.path,
      })),
    );
    if (res.warnings?.length) handleAttachError(res.warnings.join("; "));
  };

  const onChatColumnDragOver = (e: React.DragEvent) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setChatDropActive(true);
  };

  const onChatColumnDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    setChatDropActive(false);
  };

  const onChatColumnDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setChatDropActive(false);
    if (loading) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const paths = files
      .map(
        (f) =>
          window.electronAgent?.getPathForFile?.(f) ||
          (f as File & { path?: string }).path ||
          "",
      )
      .filter(Boolean);
    if (paths.length) {
      void importDroppedPaths(paths);
      return;
    }
    void (async () => {
      if (!window.electronAgent?.importAttachmentBuffer) {
        handleAttachError("Drop import unavailable. Restart the desktop app.");
        return;
      }
      const { blobToBase64, pastedImageFileName } = await import(
        "./composer-attachments.js"
      );
      const imported: ComposerAttachment[] = [];
      for (const file of files) {
        const base64 = await blobToBase64(file);
        const res = await window.electronAgent.importAttachmentBuffer!({
          base64,
          fileName:
            file.name ||
            (file.type.startsWith("image/")
              ? pastedImageFileName(file.type)
              : "drop.bin"),
          mime: file.type || undefined,
        });
        if (res?.ok && res.file) {
          imported.push({
            path: res.file.path,
            absPath: res.file.absPath,
            basename: res.file.basename,
            mime: res.file.mime,
            size: res.file.size,
            kind: res.file.kind,
            previewUrl: res.file.previewUrl,
            label: res.file.label,
            subtitle: res.file.absPath || res.file.path,
          });
        }
      }
      if (imported.length) appendPendingAttachments(imported);
      else handleAttachError("Could not import dropped files");
    })();
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? null : cur));
      }, 1500);
    } catch {
      /* ignore */
    }
  };

  const toggleFeedback = (id: string, value: "up" | "down") => {
    setMessageFeedback((prev) => ({
      ...prev,
      [id]: prev[id] === value ? null : value,
    }));
  };

  /** Retry assistant: resend the nearest prior user prompt. */
  const retryAssistant = (assistantId: string) => {
    if (loading) return;
    const idx = items.findIndex((m) => m.id === assistantId);
    if (idx < 0) return;
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (items[i]?.kind === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return;
    const user = items[userIdx]!;
    if (user.kind !== "user") return;
    void handleSend(user.text, { truncateFromId: user.id });
  };

  /** Retry user: resend the same message from that point. */
  const retryUser = (userId: string) => {
    if (loading) return;
    const user = items.find((m) => m.id === userId);
    if (!user || user.kind !== "user") return;
    void handleSend(user.text, { truncateFromId: userId });
  };

  /** Resume after model failure / self-heal — keep full chat history. */
  const handleContinueTurn = async (opts: { switchToSuggested: boolean }) => {
    const offer = continueOffer;
    if (!offer || loading || continueBusy) return;
    setContinueBusy(true);
    try {
      if (opts.switchToSuggested && offer.suggestedModel?.trim()) {
        const model = offer.suggestedModel.trim();
        if (window.electronAgent?.updateSettings) {
          const res = await window.electronAgent.updateSettings({
            model: { agentModel: model },
          });
          if (res && (res as { ok?: boolean }).ok === false) {
            setItems((prev) => [
              ...prev,
              {
                id: `s-${Date.now()}`,
                kind: "system",
                text: `Gagal ganti model ke ${model}. Continue tetap dicoba dengan model sekarang.`,
                at: now(),
              },
            ]);
          } else {
            setStatus((s) => ({
              ...s,
              model: model,
            }));
            // Allow agent reload to settle.
            await new Promise((r) => setTimeout(r, 800));
          }
        }
      }
      const continuePrompt = [
        "[CONTINUE AFTER INTERRUPTION]",
        "Previous attempt stopped (model unavailable or self-heal).",
        "Continue the user's original task in THIS same thread.",
        "Do NOT restart from scratch — reuse prior tool results, plans, and files already in context.",
        "Reply in the user's language.",
        "",
        "Original request:",
        offer.prompt,
      ].join("\n");
      setContinueOffer(null);
      await handleSend(continuePrompt, { continueMode: true });
    } finally {
      setContinueBusy(false);
    }
  };

  const startEditUser = (userId: string, text: string) => {
    if (loading) return;
    setEditingUserId(userId);
    setEditDraft(text);
  };

  const submitEditUser = (userId: string) => {
    const text = editDraft.trim();
    if (!text || loading) return;
    void handleSend(text, { truncateFromId: userId });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key === "\\" || e.code === "Backslash") {
        e.preventDefault();
        setLayoutsModalOpen((v) => {
          const next = !v;
          setLayoutEditing(next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeBot = bots.find((b) => b.id === selectedBotId);
  const backgroundBusyCount = busyThreadIds.filter(
    (id) => id !== activeThreadId,
  ).length;

  const resolvePlanApproval = async (approved: boolean) => {
    setPlanApprovalBusy(true);
    try {
      const res = await window.electronAgent?.resolveApproval?.(
        approved,
        activeThreadIdRef.current,
      );
      setPlanApprovalPending(false);
      setPendingPlanMarkdown(null);
      // Soft gate: model ended after task_plan without hitting interruptOn.task_todos.
      if (!res?.ok && approved) {
        await handleSend(
          "Plan approved. Call task_todos now with ≥3 atomic todos from the saved plan, then implement and task_verify. Do not call task_plan again.",
        );
      } else if (!res?.ok && !approved) {
        setItems((prev) => [
          ...prev,
          {
            id: `s-${Date.now()}`,
            kind: "system",
            text: "Plan rejected. Adjust the plan or ask for a new task_plan.",
            at: now(),
          },
        ]);
      }
    } finally {
      setPlanApprovalBusy(false);
    }
  };

  const resolveToolApproval = async (approved: boolean) => {
    setToolApprovalBusy(true);
    try {
      await window.electronAgent?.resolveApproval?.(
        approved,
        activeThreadIdRef.current,
      );
      setToolApprovalPending(false);
      setToolApprovalDetail(null);
      if (!approved) {
        setItems((prev) => [
          ...prev,
          {
            id: `s-rej-${Date.now()}`,
            kind: "system",
            text: "Approval rejected — turn stopped.",
            at: now(),
          },
        ]);
      }
    } finally {
      setToolApprovalBusy(false);
    }
  };

  const navRailActive: NavRailId =
    mainView === "settings"
      ? "settings"
      : mainView === "profiles"
        ? "profiles"
        : mainView === "artifacts"
          ? "artifacts"
          : mainView === "kanban"
            ? "kanban"
            : mainView === "messaging"
              ? "messaging"
              : railOpen && railLayer === "files"
                ? "files"
                : "chat";

  const handleNavRailSelect = (id: NavRailId) => {
    switch (id) {
      case "chat":
        setMainView("chat");
        break;
      case "history":
        setMainView("chat");
        patchLayout((prev) => ({ ...prev, sidebarOpen: true }));
        setActiveTab("sessions");
        break;
      case "files":
        setMainView("chat");
        setRailOpen(true);
        setRailLayer("files");
        break;
      case "artifacts":
        setMainView("artifacts");
        break;
      case "kanban":
        setMainView("kanban");
        break;
      case "messaging":
        setMainView("messaging");
        break;
      case "workspaces":
        void window.electronAgent?.openWorkspacesWindow?.();
        break;
      case "profiles":
        setMainView("profiles");
        break;
      case "settings":
        setSettingsFocus(null);
        setMainView("settings");
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={`flex h-screen flex-col overflow-hidden bg-surface-1 font-mono text-fg ${
        layoutEditing ? "layout-editing" : ""
      }`}
    >
      <AppHeader
        title={
          inBotSession && activeBot
            ? `${activeBot.name} · bot session`
            : activeThreadId || status.workspaceRoot || "agent:runtime"
        }
        subtitle={`${status.model}${
          inBotSession && activeBot?.tools?.length
            ? ` · tools: ${activeBot.tools.join(", ")}`
            : inBotSession && activeBot
              ? ` · ${activeBot.name}`
              : " · general session"
        }${layoutsModalOpen || layoutEditing ? " · layout" : ""}`}
        modelLabel={status.model}
        gatewayReady={status.gateway?.phase === "ready"}
        layoutActive={layoutsModalOpen || layoutEditing}
        sidebarOpen={sidebarOpen}
        railOpen={railOpen}
        swapped={layout.swapped}
        terminalOpen={terminalOpen}
        theme={theme}
        onToggleTheme={() =>
          setTheme((t) => (t === "dark" ? "light" : "dark"))
        }
        onLayoutClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            const next = resetLayoutPrefs();
            setLayout(next);
            setLayoutEditing(false);
            setLayoutsModalOpen(false);
            return;
          }
          setLayoutsModalOpen(true);
          setLayoutEditing(true);
        }}
        onToggleSidebar={() =>
          patchLayout((prev) => ({
            ...prev,
            sidebarOpen: !prev.sidebarOpen,
          }))
        }
        onSwapPanels={() =>
          patchLayout((prev) => ({ ...prev, swapped: !prev.swapped }))
        }
        onToggleRail={() => setRailOpen((v) => !v)}
        onToggleTerminal={() =>
          patchLayout((prev) => {
            const nextOpen = !prev.terminalOpen;
            return {
              ...prev,
              terminalOpen: nextOpen,
              templateId: nextOpen
                ? prev.railOpen
                  ? "quad"
                  : "terminal-deck"
                : prev.railOpen
                  ? "default"
                  : "focus",
            };
          })
        }
        settingsActive={mainView === "settings"}
        profilesActive={mainView === "profiles"}
        onOpenSettings={() => {
          setSettingsFocus(null);
          setMainView("settings");
        }}
        onOpenProfiles={() => setMainView("profiles")}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
      <NavIconRail
        active={navRailActive}
        onSelect={handleNavRailSelect}
        onOpenWorkspaces={() => {
          void window.electronAgent?.openWorkspacesWindow?.();
        }}
      />
      {/* Sidebar */}
      {sidebarOpen ? (
      <aside
        className="layout-panel flex shrink-0 flex-col bg-surface-0"
        style={{ width: layout.sidebarWidth }}
      >
        <div className="flex flex-col gap-2 bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] font-bold tracking-widest text-fg-dim uppercase">
                Sessions
              </span>
              <span className="bg-surface-3 px-1 py-0.5 font-mono text-[9px] font-bold text-accent">
                {busyThreadIds.length || sessions.length} ACT
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              {!inBotSession ? (
                <button
                  type="button"
                  onClick={() => void handleNewSession({ projectId: null })}
                  className="p-1 text-accent transition hover:bg-surface-4 hover:text-fg"
                  data-tip="New Session (⌘N)"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    add_box
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleReturnToSessions()}
                  className="p-1 text-fg-dim transition hover:bg-surface-4 hover:text-fg"
                  data-tip="Back to sessions"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    arrow_back
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setSessionFilter((f) => (f === "all" ? "busy" : "all"))
                }
                className="p-1 text-fg-dim transition hover:bg-surface-4 hover:text-fg"
                data-tip="Filter sessions"
              >
                <span className="material-symbols-outlined text-[15px]">
                  tune
                </span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => void handleNewSession({ projectId: null })}
              className="bg-surface-1 py-1 px-1 text-center font-mono text-[10px] font-bold text-accent transition hover:bg-accent hover:text-surface-0"
            >
              + CHAT
            </button>
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              className="bg-surface-1 py-1 px-1 text-center font-mono text-[10px] font-bold text-fg-dim transition hover:bg-surface-4 hover:text-fg"
            >
              + PROJ
            </button>
            <button
              type="button"
              onClick={() => setNewProfileOpen(true)}
              className="bg-surface-1 py-1 px-1 text-center font-mono text-[10px] font-bold text-fg-dim transition hover:bg-surface-4 hover:text-fg"
            >
              + BOT
            </button>
          </div>
        </div>

        <div className="app-no-drag flex min-h-0 flex-1 flex-col px-0 pb-0">
          {!inBotSession ? null : (
            <button
              type="button"
              onClick={() => void handleReturnToSessions()}
              className="mx-2 mb-2 w-[calc(100%-1rem)] border border-border bg-surface-2 px-3 py-2 text-left font-mono text-[11px] font-medium text-fg transition hover:border-accent/40 hover:bg-surface-3"
            >
              ← Back to sessions
            </button>
          )}

          <div className="flex border-b border-border/60 bg-surface-0">
            {(
              [
                ["sessions", "Sessions"],
                ["bots", "Bots"],
                ["projects", "Projects"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                data-tip={label}
                data-tip-pos="bottom"
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "sessions") {
                    setProjectsFocusId(null);
                    if (inBotSession) {
                      void handleReturnToSessions();
                    } else if (activeProjectId) {
                      void handleActivateProject(null);
                    }
                  }
                  if (tab === "projects") {
                    void refreshProjects();
                    void refreshSessions({ syncBusy: true });
                  }
                }}
                className={`flex-1 py-1.5 font-mono text-[9px] font-bold tracking-wider uppercase transition ${
                  activeTab === tab
                    ? "bg-surface-2 text-accent"
                    : "text-muted hover:text-fg-dim"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab === "sessions" ? (
              globalSessions.length === 0 ? (
                <div className="px-3 py-2 font-mono text-xs text-muted">
                  No sessions yet
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-2">
                  {/* PINNED & ACTIVE */}
                  <div className="flex items-center justify-between px-2 pt-1 text-muted">
                    <span className="font-mono text-[9px] tracking-wider text-muted uppercase">
                      PINNED &amp; ACTIVE
                    </span>
                    <span className="material-symbols-outlined text-[12px]">
                      push_pin
                    </span>
                  </div>
                  {globalSessions
                    .filter(
                      (s) =>
                        (sessionFilter === "all" ||
                          busyThreadIds.includes(s.threadId)) &&
                        (busyThreadIds.includes(s.threadId) ||
                          s.threadId === activeThreadId),
                    )
                    .map((s) => {
                      const active =
                        s.threadId === activeThreadId && !inBotSession;
                      const sessionBusy = busyThreadIds.includes(s.threadId);
                      const ageLabel = sessionAgeLabel(s.updatedAt);
                      const label = sessionPreviewLabel(
                        s.preview || s.threadId,
                      );
                      return (
                        <div
                          key={s.threadId}
                          className={`group relative cursor-pointer p-2 transition ${
                            active
                              ? "bg-surface-3"
                              : "hover:bg-surface-2"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => void handleOpenSession(s.threadId)}
                            className="w-full border-0 bg-transparent p-0 text-left"
                          >
                            <div className="mb-1 flex items-start justify-between gap-1">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 ${
                                    sessionBusy
                                      ? "animate-pulse bg-accent"
                                      : "bg-muted"
                                  }`}
                                />
                                <span
                                  className={`truncate font-mono text-[12px] font-bold ${
                                    active || sessionBusy
                                      ? "text-accent"
                                      : "text-fg"
                                  }`}
                                >
                                  {label}
                                </span>
                              </div>
                              {sessionBusy ? (
                                <span className="bg-surface-0 px-1 font-mono text-[9px] font-bold text-tertiary">
                                  LIVE
                                </span>
                              ) : (
                                <span className="font-mono text-[9px] text-muted">
                                  {ageLabel}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between pl-3 font-mono text-[10px] text-fg-dim">
                              <span className="flex items-center gap-1 truncate text-fg">
                                <span className="material-symbols-outlined text-[11px] text-accent">
                                  alt_route
                                </span>
                                {s.threadId.slice(0, 12)}
                              </span>
                              <span className="shrink-0 font-bold">
                                <span className="text-muted">
                                  {s.turnCount ?? 0}t
                                </span>
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between pl-3 font-mono text-[9px] text-muted">
                              <span className="truncate">
                                {status.model?.slice(0, 18) || "agent"}
                              </span>
                              <span className="text-accent/80">{ageLabel}</span>
                            </div>
                          </button>
                          <div className="absolute top-1 right-1 hidden items-center gap-0.5 bg-surface-4 px-1 py-0.5 group-hover:flex">
                            <SessionRowMenu
                              threadId={s.threadId}
                              projects={projects.map((p) => ({
                                id: p.id,
                                name: p.name,
                              }))}
                              currentProjectId={s.projectId}
                              onClear={handleClearSession}
                              onDelete={handleDeleteSession}
                              onMoveToProject={handleMoveSessionToProject}
                            />
                          </div>
                        </div>
                      );
                    })}

                  {/* BACKGROUND / IDLE */}
                  <div className="mt-2 flex items-center justify-between px-2 pt-2 text-muted">
                    <span className="font-mono text-[9px] tracking-wider text-muted uppercase">
                      BACKGROUND TASKS
                    </span>
                    <span className="font-mono text-[9px] text-fg-dim">
                      {
                        globalSessions.filter(
                          (s) =>
                            !busyThreadIds.includes(s.threadId) &&
                            s.threadId !== activeThreadId,
                        ).length
                      }
                    </span>
                  </div>
                  {globalSessions
                    .filter(
                      (s) =>
                        sessionFilter === "all" &&
                        !busyThreadIds.includes(s.threadId) &&
                        s.threadId !== activeThreadId,
                    )
                    .map((s) => {
                      const ageLabel = sessionAgeLabel(s.updatedAt);
                      const label = sessionPreviewLabel(
                        s.preview || s.threadId,
                      );
                      return (
                        <div
                          key={s.threadId}
                          className="group relative cursor-pointer p-2 transition hover:bg-surface-2"
                        >
                          <button
                            type="button"
                            onClick={() => void handleOpenSession(s.threadId)}
                            className="w-full border-0 bg-transparent p-0 text-left"
                          >
                            <div className="mb-1 flex items-start justify-between gap-1">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="h-1.5 w-1.5 shrink-0 bg-muted" />
                                <span className="truncate font-mono text-[12px] text-fg-dim">
                                  {label}
                                </span>
                              </div>
                              <span className="font-mono text-[9px] text-muted">
                                {ageLabel}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pl-3 font-mono text-[10px] text-muted">
                              <span className="flex items-center gap-1 truncate">
                                <span className="material-symbols-outlined text-[11px]">
                                  description
                                </span>
                                {s.threadId.slice(0, 10)}
                              </span>
                              <span className="text-muted">IDLE</span>
                            </div>
                          </button>
                          <div className="absolute top-1 right-1 hidden items-center gap-0.5 bg-surface-4 px-1 py-0.5 group-hover:flex">
                            <SessionRowMenu
                              threadId={s.threadId}
                              projects={projects.map((p) => ({
                                id: p.id,
                                name: p.name,
                              }))}
                              currentProjectId={s.projectId}
                              onClear={handleClearSession}
                              onDelete={handleDeleteSession}
                              onMoveToProject={handleMoveSessionToProject}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )
            ) : activeTab === "bots" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
                <div className="px-1 pb-1 font-mono text-[9.5px] leading-snug text-muted">
                  Setiap bot punya sesi sendiri + tools terbatas. History ikut ter-load.
                </div>
                {specializedBots.length === 0 ? (
                  <div className="px-1 py-2 text-xs text-muted">No specialized bots</div>
                ) : (
                  specializedBots.map((b) => {
                    const active = b.id === selectedBotId && inBotSession;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => void handleOpenBot(b.id)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          active
                            ? "border-accent/30 bg-surface-3"
                            : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-medium text-fg">{b.name}</div>
                          {(b.turnCount ?? 0) > 0 ? (
                            <span className="shrink-0 text-[9px] text-muted">
                              {b.turnCount} turns
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[9.5px] leading-snug text-muted">
                          {b.description}
                        </div>
                        {b.preview ? (
                          <div className="mt-1 truncate font-mono text-[9px] text-fg-dim">
                            {b.preview}
                          </div>
                        ) : (
                          <div className="mt-1 text-[9px] italic text-muted">
                            Belum ada chat — klik untuk mulai
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : activeTab === "projects" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {focusedProject ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setProjectsFocusId(null)}
                      className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-muted hover:text-fg"
                    >
                      <span aria-hidden>←</span> All projects
                    </button>
                    <div className="mb-1 flex items-center gap-1.5 px-1">
                      <span className="text-muted" aria-hidden>
                        ⌂
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">
                        {focusedProject.name}
                      </span>
                      <button
                        type="button"
                        title="New session in project"
                        onClick={() =>
                          void handleNewSession({
                            projectId: focusedProject.id,
                          })
                        }
                        className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title="Delete project"
                        onClick={() =>
                          void handleDeleteProject(
                            focusedProject.id,
                            focusedProject.name,
                          )
                        }
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-red-500/15 hover:text-red-300"
                      >
                        Del
                      </button>
                    </div>
                    {(sessionsByProject.get(focusedProject.id) ?? []).length ===
                    0 ? (
                      <div className="px-1 py-2 text-xs text-muted">
                        No sessions in this project
                      </div>
                    ) : (
                      (sessionsByProject.get(focusedProject.id) ?? []).map(
                        (s) => {
                          const active =
                            s.threadId === activeThreadId && !inBotSession;
                          const sessionBusy = busyThreadIds.includes(
                            s.threadId,
                          );
                          return (
                            <div
                              key={s.threadId}
                              className={`group flex w-full items-center gap-0.5 rounded-lg border px-2 py-2 text-left transition ${
                                active
                                  ? "border-accent/30 bg-surface-3"
                                  : "border-transparent hover:bg-surface-2"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  void handleOpenProjectSession(
                                    focusedProject.id,
                                    s.threadId,
                                  )
                                }
                                className="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent p-0 text-left"
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    sessionBusy ? "bg-accent" : "bg-muted"
                                  }`}
                                />
                                <div className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-fg">
                                  {sessionPreviewLabel(s.preview || s.threadId)}
                                </div>
                                <span className="shrink-0 text-[9px] text-muted">
                                  {sessionAgeLabel(s.updatedAt)}
                                </span>
                              </button>
                              <SessionRowMenu
                                threadId={s.threadId}
                                projects={projects.map((p) => ({
                                  id: p.id,
                                  name: p.name,
                                }))}
                                currentProjectId={s.projectId}
                                onClear={handleClearSession}
                                onDelete={handleDeleteSession}
                                onMoveToProject={handleMoveSessionToProject}
                              />
                            </div>
                          );
                        },
                      )
                    )}
                  </>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between px-1">
                      <div className="text-[10px] font-semibold tracking-wider text-accent-soft uppercase">
                        Projects
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewProjectOpen(true)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
                      >
                        + New
                      </button>
                    </div>
                    {projects.length === 0 ? (
                      <div className="px-1 py-2 text-xs text-muted">
                        No projects yet
                      </div>
                    ) : (
                      projects.map((p) => {
                        const expanded = expandedProjectIds.includes(p.id);
                        const projectSessions =
                          sessionsByProject.get(p.id) ?? [];
                        const previewSessions = projectSessions.slice(0, 3);
                        return (
                          <div
                            key={p.id}
                            className={`rounded-lg border ${
                              p.id === activeProjectId
                                ? "border-accent/30 bg-surface-3/60"
                                : "border-transparent"
                            }`}
                          >
                            <div className="group flex items-stretch">
                              <button
                                type="button"
                                title={expanded ? "Collapse" : "Expand"}
                                onClick={() => toggleProjectAccordion(p.id)}
                                className="px-1.5 text-[10px] text-muted hover:text-fg"
                              >
                                {expanded ? "▾" : "▸"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleEnterProject(p.id)}
                                className="min-w-0 flex-1 px-1.5 py-2 text-left hover:bg-surface-2/80"
                              >
                                <div className="truncate text-[11px] font-medium text-fg">
                                  {p.name}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[9.5px] text-muted">
                                  {p.folders.length} folder
                                  {p.folders.length === 1 ? "" : "s"}
                                  {projectSessions.length
                                    ? ` · ${projectSessions.length} session${
                                        projectSessions.length === 1 ? "" : "s"
                                      }`
                                    : ""}
                                </div>
                              </button>
                              <button
                                type="button"
                                title="Delete project"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteProject(p.id, p.name);
                                }}
                                className="shrink-0 self-center rounded px-1.5 py-1 text-[10px] text-muted opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                              >
                                Del
                              </button>
                            </div>
                            {expanded ? (
                              <div className="space-y-0.5 border-t border-border/60 px-1.5 py-1.5">
                                {previewSessions.length === 0 ? (
                                  <div className="px-1 py-1 text-[10px] text-muted">
                                    No sessions yet
                                  </div>
                                ) : (
                                  previewSessions.map((s) => {
                                    const active =
                                      s.threadId === activeThreadId &&
                                      !inBotSession;
                                    const sessionBusy = busyThreadIds.includes(
                                      s.threadId,
                                    );
                                    return (
                                      <button
                                        key={s.threadId}
                                        type="button"
                                        onClick={() =>
                                          void handleOpenProjectSession(
                                            p.id,
                                            s.threadId,
                                          )
                                        }
                                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left ${
                                          active
                                            ? "bg-accent/15 text-accent"
                                            : "hover:bg-surface-2"
                                        }`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                            sessionBusy
                                              ? "bg-accent"
                                              : "bg-muted"
                                          }`}
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fg">
                                          {sessionPreviewLabel(s.preview || s.threadId)}
                                        </span>
                                        <span className="shrink-0 text-[9px] text-muted">
                                          {sessionAgeLabel(s.updatedAt)}
                                        </span>
                                      </button>
                                    );
                                  })
                                )}
                                {projectSessions.length > 3 ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleEnterProject(p.id)}
                                    className="w-full px-2 py-1 text-left text-[9.5px] text-accent hover:underline"
                                  >
                                    View all {projectSessions.length} sessions…
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1 bg-surface-2 p-3">
          <div className="flex items-center justify-between font-mono text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 bg-accent" /> LOCAL WORKSPACE
            </span>
            <span className="font-bold text-accent">SSD</span>
          </div>
          <div className="h-1 w-full overflow-hidden bg-surface-3">
            <div className="h-full w-4/5 bg-accent" />
          </div>
          <div className="flex items-center justify-between pt-0.5 font-mono text-[9px] text-muted">
            <span className="max-w-[70%] truncate">
              {status.workspaceRoot || "—"}
            </span>
            <span>{status.profileId || "default"}</span>
          </div>
        </div>
      </aside>
      ) : null}

      {sidebarOpen ? (
        <PanelResizeHandle
          emphasized={layoutEditing}
          onDrag={(dx) =>
            patchLayout((prev) => ({
              ...prev,
              sidebarWidth: Math.min(
                SIDEBAR_MAX,
                Math.max(SIDEBAR_MIN, prev.sidebarWidth + dx),
              ),
            }))
          }
        />
      ) : null}

      <NewProfileModal
        open={newProfileOpen}
        cloneOptions={profileIds}
        onClose={() => setNewProfileOpen(false)}
        onCreated={(id) => {
          setProfileIds((prev) =>
            prev.includes(id) ? prev : [...prev, id],
          );
          setMainView("profiles");
        }}
      />
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          void (async () => {
            await refreshProjects();
            setActiveProjectId(project.id);
            setActiveTab("projects");
            setProjectsFocusId(project.id);
            setExpandedProjectIds((prev) =>
              prev.includes(project.id) ? prev : [...prev, project.id],
            );
            const status = await window.electronAgent?.getStatus?.();
            if (status?.workspaceRoot) {
              setStatus((s) => ({ ...s, workspaceRoot: status.workspaceRoot }));
            }
            const listed = await window.electronAgent?.listSessions?.();
            if (listed?.activeThreadId) {
              stashCurrentSession();
              activeThreadIdRef.current = listed.activeThreadId;
              setActiveThreadId(listed.activeThreadId);
              setSelectedBotId("general");
              setMainView("chat");
              setItems([
                {
                  id: "welcome",
                  kind: "assistant",
                  text: `Project “${project.name}” is active. Agent file access is limited to its folders.`,
                  at: now(),
                },
              ]);
              setActivity([]);
              setLoading(false);
              setPhase("boot");
            }
            await refreshSessions({ syncBusy: true });
          })();
        }}
      />

      <LayoutsModal
        open={layoutsModalOpen}
        activeTemplate={layout.templateId}
        onSelect={(id) => applyTemplate(id)}
        onReset={() => {
          const next = resetLayoutPrefs();
          setLayout(next);
          setLayoutEditing(false);
        }}
        onDone={() => {
          setLayoutsModalOpen(false);
          setLayoutEditing(false);
        }}
      />

      {mainView === "capabilities" ? (
        <CapabilitiesView onClose={() => setMainView("chat")} />
      ) : mainView === "kanban" ? (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <KanbanView onClose={() => setMainView("chat")} />
        </div>
      ) : mainView === "messaging" ? (
        <MessagingView onClose={() => setMainView("chat")} />
      ) : mainView === "profiles" ? (
        <ProfilesView
          onClose={() => setMainView("chat")}
          onNewProfile={() => setNewProfileOpen(true)}
          onSwitched={(id) => {
            void reloadUiForProfile(id);
          }}
        />
      ) : mainView === "settings" ? (
        <SettingsView
          initialGroup={settingsFocus === "gateways" ? "gateways" : undefined}
          onClose={() => {
            setSettingsFocus(null);
            setMainView("chat");
            void refreshBots();
          }}
          onOpenCapabilities={() => setMainView("capabilities")}
          onUiSettingsSaved={(ui) => {
            setUiPrefs({
              showFooterPhase: ui.showFooterPhase !== false,
              showLearnedInFooter: ui.showLearnedInFooter !== false,
              openChatPathsInCanvas: ui.openChatPathsInCanvas !== false,
              preferStreamedAnswer: ui.preferStreamedAnswer !== false,
              compactActivity: Boolean(ui.compactActivity),
            });
            if (ui.defaultRailLayer === "files" || ui.defaultRailLayer === "canvas") {
              setRailLayer(ui.defaultRailLayer);
            }
          }}
        />
      ) : mainView === "artifacts" ? (
        <ArtifactsView
          onClose={() => setMainView("chat")}
          onOpenSession={(threadId) => {
            setMainView("chat");
            void handleOpenSession(threadId);
          }}
          onOpenArtifact={(art) => {
            if (art.category === "links" || /^https?:\/\//i.test(art.location)) {
              window.open(art.location, "_blank", "noopener,noreferrer");
              return;
            }
            const p = art.path || art.location;
            const ext = extensionOf(p);
            openCanvas(
              {
                id: normalizeCanvasKey(p) || p,
                path: p,
                basename: art.title || basenamePath(p),
                kind: inferPreviewKind(ext),
                language: languageForExt(ext),
              },
              true,
            );
            setMainView("chat");
            setRailOpen(true);
            setRailLayer("canvas");
          }}
        />
      ) : (
      <>
      <div className="flex min-h-0 min-w-0 flex-1">
      {/* Main */}
      <section
        className={`layout-panel flex min-w-0 flex-1 flex-col bg-surface-1 ${
          chatDropActive ? "chat-column-drop" : ""
        }`}
        style={{ order: layout.swapped ? 3 : 1 }}
        onDragOver={onChatColumnDragOver}
        onDragLeave={onChatColumnDragLeave}
        onDrop={onChatColumnDrop}
      >
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 bg-surface-2 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-accent">
              account_tree
            </span>
            <span className="truncate font-sans text-[15px] font-bold text-accent">
              {inBotSession && activeBot
                ? activeBot.name
                : activeThreadId || "agent:runtime"}
            </span>
            <span className="text-border-strong">|</span>
            <span className="flex items-center gap-1 truncate font-mono text-[11px] text-fg-dim">
              <span className="material-symbols-outlined text-[14px] text-tertiary">
                check_circle
              </span>
              Policy: STRICT_TDD
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              AUTONOMOUS LVL 4
            </span>
            <button
              type="button"
              data-tip={railOpen ? "Hide canvas" : "Show canvas"}
              onClick={() => setRailOpen((v) => !v)}
              className="p-1 text-fg-dim transition hover:bg-surface-4 hover:text-fg"
            >
              <span className="material-symbols-outlined text-[15px]">
                vertical_split
              </span>
            </button>
          </div>
        </div>
        <div
          ref={streamRef}
          onScroll={onStreamScroll}
          className="chat-feed flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3"
        >
          {(() => {
            const draftHidden = looksLikeTextToolCallDump(draftAnswer);
            const showWaitingCard =
              loading &&
              (!draftAnswer || draftHidden) &&
              !draftReasoning &&
              phase !== "reflecting" &&
              phase !== "done" &&
              !planApprovalPending &&
              !toolApprovalPending;
            let lastUserId: string | null = null;
            for (let i = items.length - 1; i >= 0; i -= 1) {
              if (items[i]!.kind === "user") {
                lastUserId = items[i]!.id;
                break;
              }
            }
            return buildChatSegments(items, loading).map((seg) => {
              if (seg.type === "traces") {
                return (
                  <CollapsibleTraceGroup
                    key={seg.items[0]!.id}
                    entries={seg.items.map((t) => ({
                      id: t.id,
                      event: t.event,
                      input: t.toolInput,
                      output:
                        t.event.type === "tool_end" ? t.event.output : undefined,
                    }))}
                    live={seg.live}
                  />
                );
              }
              const item = seg.item;
            if (item.kind === "user") {
              const isEditing = editingUserId === item.id;
              return (
                <React.Fragment key={item.id}>
                <div className="chat-msg group">
                  <div className="chat-msg-meta">
                    <span className="chat-msg-who">
                      <span className="chat-dot chat-dot-you" />
                      YOU (STAFF_ENGINEER)
                    </span>
                    <span className="chat-msg-time">{item.at}</span>
                  </div>
                  {isEditing ? (
                    <div className="chat-user-bubble">
                      <textarea
                        value={editDraft}
                        rows={3}
                        autoFocus
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submitEditUser(item.id);
                          }
                          if (e.key === "Escape") {
                            setEditingUserId(null);
                            setEditDraft("");
                          }
                        }}
                        className="w-full resize-y border-0 bg-[var(--chat-chip,#0e0e0e)] px-2.5 py-2 font-mono text-[12px] leading-relaxed text-[var(--chat-fg,#e5e5e6)] outline-none"
                      />
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            setEditingUserId(null);
                            setEditDraft("");
                          }}
                          className="chat-btn-ghost"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={loading || !editDraft.trim()}
                          onClick={() => submitEditUser(item.id)}
                          className="chat-btn-primary"
                        >
                          Save & send
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-user-bubble">
                      {item.text ? (
                        <div className="chat-user-text">{item.text}</div>
                      ) : null}
                      {item.attachments?.length ? (
                        <UserBubbleAttachments attachments={item.attachments} />
                      ) : null}
                      {!item.text && !item.attachments?.length ? (
                        <div className="chat-user-text text-[var(--chat-muted,#747676)]">
                          (empty)
                        </div>
                      ) : null}
                    </div>
                  )}
                  <UserBubbleActions
                    disabled={loading}
                    editing={isEditing}
                    onEdit={() => startEditUser(item.id, item.text)}
                    onRetry={() => retryUser(item.id)}
                    onCancelEdit={() => {
                      setEditingUserId(null);
                      setEditDraft("");
                    }}
                  />
                </div>
                {showWaitingCard && item.id === lastUserId ? (
                  <WaitingCard
                    phase={phase}
                    detail={phaseDetail}
                    tokensPerSec={tokensPerSec}
                  />
                ) : null}
                </React.Fragment>
              );
            }
            if (item.kind === "assistant") {
              const isWelcome = item.id === "welcome";
              const label = item.botName
                ? `${item.botName}${item.botRole ? ` · ${item.botRole}` : ""}`.toUpperCase()
                : status.model
                  ? `${status.model.toUpperCase()} ARCHITECT`
                  : "AGENT ARCHITECT";
              return (
                <div key={item.id} className="chat-msg group">
                  <div className="chat-msg-meta">
                    <span className="chat-msg-who is-agent">
                      <span className="chat-dot chat-dot-agent" />
                      {label}
                    </span>
                    <span className="chat-msg-time">{item.at}</span>
                  </div>
                  <div className="chat-assistant-body">
                    <MarkdownBody
                      text={item.text}
                      onOpenPath={
                        uiPrefs.openChatPathsInCanvas
                          ? openWorkspacePath
                          : undefined
                      }
                    />
                  </div>
                  {!isWelcome ? (
                    <AssistantBubbleActions
                      disabled={loading}
                      feedback={messageFeedback[item.id] ?? null}
                      copied={copiedId === item.id}
                      onCopy={() => void copyText(item.id, item.text)}
                      onLike={() => toggleFeedback(item.id, "up")}
                      onDislike={() => toggleFeedback(item.id, "down")}
                      onRetry={() => retryAssistant(item.id)}
                    />
                  ) : null}
                </div>
              );
            }
            if (item.kind === "file") {
              return (
                <ChatFileCard
                  key={item.id}
                  path={item.path}
                  basename={item.basename}
                  note={item.note}
                  onOpen={() => {
                    void (async () => {
                      openWorkspacePath(item.path);
                      const res =
                        await window.electronAgent?.openWorkspaceFile?.(
                          item.path,
                        );
                      if (res && !res.ok && res.error) {
                        setItems((prev) => [
                          ...prev,
                          {
                            id: `s-${Date.now()}`,
                            kind: "system",
                            text: `Could not open ${item.path}: ${res.error}`,
                            at: now(),
                          },
                        ]);
                      }
                    })();
                  }}
                  onSaveAs={() => {
                    void (async () => {
                      const res =
                        await window.electronAgent?.exportWorkspaceFile?.(
                          item.path,
                        );
                      if (res?.ok && res.savedAs) {
                        setItems((prev) => [
                          ...prev,
                          {
                            id: `s-${Date.now()}`,
                            kind: "system",
                            text: `Saved copy to ${res.savedAs}`,
                            at: now(),
                          },
                        ]);
                      } else if (res && !res.ok && res.error !== "canceled") {
                        setItems((prev) => [
                          ...prev,
                          {
                            id: `s-${Date.now()}`,
                            kind: "system",
                            text: `Save failed: ${res.error}`,
                            at: now(),
                          },
                        ]);
                      }
                    })();
                  }}
                  onReveal={() => {
                    void window.electronAgent?.revealWorkspaceFile?.(item.path);
                  }}
                />
              );
            }
            if (item.kind === "system") {
              return (
                <div key={item.id} className="chat-system">
                  {item.text}
                </div>
              );
            }
            if (item.kind === "reasoning") {
              return (
                <ReasoningBlock
                  key={item.id}
                  text={item.text}
                  at={item.at}
                  label={item.label}
                  durationSec={item.durationSec}
                />
              );
            }
            return null;
            });
          })()}

          {draftReasoning ? (
            <ReasoningBlock text={draftReasoning} live />
          ) : null}

          {draftAnswer &&
            !looksLikeTextToolCallDump(draftAnswer) &&
            (shouldRenderAsReasoning(draftAnswer) ? (
              <ReasoningBlock text={draftAnswer} live label="Model notice" />
            ) : (
              <div className="chat-msg">
                <div className="chat-msg-meta">
                  <span className="chat-msg-who is-agent">
                    <span className="chat-dot chat-dot-agent animate-pulse" />
                    AGENT · STREAMING
                    <TypingDots color="#7d98ff" />
                  </span>
                  {tokensPerSec != null && tokensPerSec > 0 ? (
                    <span className="chat-msg-time">
                      {tokensPerSec.toFixed(1)} tok/s
                    </span>
                  ) : null}
                </div>
                <div className="chat-assistant-body">
                  <MarkdownBody
                    text={draftAnswer}
                    onOpenPath={
                      uiPrefs.openChatPathsInCanvas
                        ? openWorkspacePath
                        : undefined
                    }
                  />
                  <StreamingCaret color="#7d98ff" />
                </div>
              </div>
            ))}

          {planApprovalPending ? (
            <PlanApprovalCard
              markdown={
                pendingPlanMarkdown ||
                canvasTabs.find((t) => t.id === "plan:.agent/task/board.md")
                  ?.inlineContent ||
                "_Plan is ready. Approve to continue with todos & coding._"
              }
              busy={planApprovalBusy}
              onApprove={() => {
                void resolvePlanApproval(true);
              }}
              onReject={() => {
                void resolvePlanApproval(false);
              }}
              onOpenCanvas={() => {
                setRailLayer("canvas");
                setRailOpen(true);
                setActiveCanvasId("plan:.agent/task/board.md");
              }}
            />
          ) : null}

          {toolApprovalPending && !planApprovalPending ? (
            <ToolApprovalCard
              detail={
                toolApprovalDetail ||
                "_Tool approval required._"
              }
              busy={toolApprovalBusy}
              onApprove={() => {
                void resolveToolApproval(true);
              }}
              onReject={() => {
                void resolveToolApproval(false);
              }}
            />
          ) : null}

          {continueOffer && !loading && !planApprovalPending ? (
            <ContinueTurnCard
              offer={continueOffer}
              busy={continueBusy || loading}
              currentModel={status.model}
              onContinue={(o) => {
                void handleContinueTurn(o);
              }}
              onDismiss={() => setContinueOffer(null)}
            />
          ) : null}
        </div>

        <div className="shrink-0">
          <ChatComposer
            value={input}
            disabled={loading || !status.agentReady}
            loading={loading}
            placeholder={
              !status.agentReady
                ? status.agentBooting
                  ? "Starting agent engine…"
                  : status.error || "Agent engine not ready…"
                : inBotSession && activeBot
                ? `Direct ${activeBot.name} or ask architecture instructions…`
                : "Direct terminal agent or ask architecture refactoring instructions..."
            }
            modelLabel={status.model}
            repoLabel={
              status.workspaceRoot && status.workspaceRoot !== "…"
                ? status.workspaceRoot.split(/[/\\]/).filter(Boolean).pop()
                : undefined
            }
            tokenLabel={
              tokensPerSec != null && tokensPerSec > 0
                ? `${tokensPerSec.toFixed(1)} tok/s`
                : undefined
            }
            git={gitChrome}
            mode={composerMode}
            effort={composerEffort}
            thinking={composerThinking}
            voiceMuted={voiceMuted}
            privacyMode={privacyMode}
            attachments={pendingAttachments}
            dropActive={chatDropActive}
            onDropActiveChange={setChatDropActive}
            onChange={setInput}
            onSend={() => void handleSend()}
            onModeChange={handleComposerModeChange}
            onEffortChange={setComposerEffort}
            onThinkingChange={setComposerThinking}
            onToggleVoiceMute={() => setVoiceMuted((v) => !v)}
            onTogglePrivacy={() => void applyPrivacyMode(!privacyMode)}
            onAddAttachments={appendPendingAttachments}
            onAttachError={handleAttachError}
            onRemoveAttachment={(p) => {
              setPendingAttachments((prev) => prev.filter((a) => a.path !== p));
            }}
          />
        </div>
      </section>

      {railOpen ? (
        <PanelResizeHandle
          emphasized={layoutEditing}
          style={{ order: 2 }}
          onDrag={(dx) =>
            patchLayout((prev) => ({
              ...prev,
              railWidth: Math.min(
                RAIL_MAX,
                Math.max(
                  RAIL_MIN,
                  prev.railWidth + (prev.swapped ? dx : -dx),
                ),
              ),
            }))
          }
        />
      ) : null}

      {/* Activity rail — Canvas + Files */}
      {railOpen && (
        <aside
          className={`layout-panel flex shrink-0 flex-col bg-surface-0 ${
            layout.swapped ? "" : ""
          }`}
          style={{ width: layout.railWidth, order: layout.swapped ? 1 : 3 }}
        >
          <div className="flex h-9 items-center justify-between gap-2 bg-surface-2 px-3">
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-fg">
              <span className="material-symbols-outlined text-[15px] text-accent">
                design_services
              </span>
              <span>ARTIFACT WORKSPACE</span>
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  ["canvas", "Preview", "Canvas — previews & deliverables"],
                  ["files", "Files", "Files — workspace browser"],
                ] as const
              ).map(([id, label, tip]) => (
                <button
                  key={id}
                  type="button"
                  data-tip={tip}
                  data-tip-pos="bottom"
                  onClick={() => setRailLayer(id)}
                  className={`px-2 py-0.5 font-mono text-[10px] transition ${
                    railLayer === id
                      ? "bg-surface-1 text-accent"
                      : "bg-surface-3 text-fg-dim hover:text-fg"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {railLayer === "canvas" && canvasTabs.length === 0 ? (
            <div className="flex justify-end bg-surface-2 px-3 pb-1">
              <button
                type="button"
                data-tip="Discover deliverables from recent replies"
                data-tip-pos="bottom"
                onClick={() => {
                  void openDiscoveredDeliverables({
                    texts: items
                      .filter((m) => m.kind === "assistant")
                      .slice(-3)
                      .map((m) => ("text" in m ? String(m.text) : "")),
                  });
                }}
                className="px-2 py-0.5 font-mono text-[9.5px] text-muted hover:bg-surface-3 hover:text-fg"
              >
                Discover
              </button>
            </div>
          ) : null}

          {railLayer === "files" ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <WorkspaceFilesPanel
                key={`files-${status.profileId}-${status.workspaceRoot}-${activeProjectId ?? "none"}`}
                workspaceRoot={status.workspaceRoot}
                onOpenFile={(relPath) => {
                  openWorkspacePath(relPath);
                }}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <ActivityCanvas
                tabs={canvasTabs}
                activeId={activeCanvasId}
                onSelect={setActiveCanvasId}
                onClose={(id) => {
                  setCanvasTabs((prev) => {
                    const next = prev.filter((t) => t.id !== id);
                    setActiveCanvasId((cur) =>
                      cur === id ? (next[next.length - 1]?.id ?? null) : cur,
                    );
                    return next;
                  });
                }}
                planApproval={
                  planApprovalPending
                    ? {
                        pending: true,
                        busy: planApprovalBusy,
                        onApprove: () => {
                          void resolvePlanApproval(true);
                        },
                        onReject: () => {
                          void resolvePlanApproval(false);
                        },
                      }
                    : null
                }
              />
            </div>
          )}
        </aside>
      )}
      </div>
      </>
      )}
      </div>

      <TerminalPanel
        key={`terminal-${status.profileId}-${status.workspaceRoot}-${activeProjectId ?? "none"}`}
        open={terminalOpen}
        height={layout.terminalHeight}
        ptyLog={ptyLog}
        agentLog={agentLog}
        onClearPty={() => setPtyLog("")}
        onClearLog={() => setAgentLog("")}
        onClose={() =>
          patchLayout((prev) => ({
            ...prev,
            terminalOpen: false,
            templateId: prev.railOpen ? "default" : "focus",
          }))
        }
        onResize={(dy) =>
          patchLayout((prev) => ({
            ...prev,
            terminalHeight: Math.min(
              TERMINAL_MAX,
              Math.max(TERMINAL_MIN, prev.terminalHeight + dy),
            ),
          }))
        }
      />
      </div>

      <AppFooter
        status={status.gateway}
        profileId={status.profileId}
        profiles={profileIds}
        phase={phase}
        backgroundBusyCount={backgroundBusyCount}
        statusError={status.error}
        learnedRules={learnedRules}
        showFooterPhase={uiPrefs.showFooterPhase}
        showLearnedInFooter={uiPrefs.showLearnedInFooter}
        onRefreshLearned={() => {
          if (window.electronAgent?.getLearnedRules) {
            window.electronAgent
              .getLearnedRules()
              .then((r) => r && setLearnedRules(r));
          }
        }}
        onRefreshProfiles={async () => {
          const listed = await window.electronAgent?.listProfiles?.();
          if (listed?.ok) {
            setProfileIds(listed.profiles.map((p) => p.id));
          }
        }}
        onHome={() => {
          setActiveTab("sessions");
          setMainView("chat");
        }}
        onNewProfile={() => setNewProfileOpen(true)}
        onManageProfiles={() => setMainView("profiles")}
        onSwitchProfile={(id) => handleProfileSwitch(id)}
        onManageGateways={() => {
          setSettingsFocus("gateways");
          setMainView("settings");
        }}
      />
    </div>
  );
}

