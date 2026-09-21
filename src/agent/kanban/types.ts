export const KANBAN_STATUSES = [
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "archived",
] as const;

export type KanbanStatus = (typeof KANBAN_STATUSES)[number];

export const UI_COLUMNS: KanbanStatus[] = [
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
];

export type WorkspaceKind = "scratch" | "dir" | "worktree" | "project";

export type BoardMeta = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  createdAt: string;
  archived: boolean;
};

export type BoardSettings = {
  orchestratorProfile: string;
  defaultAssignee: string;
  autoDecompose: boolean;
  autoDecomposePerTick: number;
  autoPromoteChildren: boolean;
  maxInProgress: number | null;
  maxInProgressPerProfile: number | null;
  failureLimit: number;
  defaultWorkdir: string;
  allowSelfReview: boolean;
  dispatchStaleTimeoutSeconds: number;
  blockRecurrenceLimit: number;
  /** JSON map profileId → routing description for decomposer */
  profileDescriptionsJson: string;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  orchestratorProfile: "",
  defaultAssignee: "",
  autoDecompose: true,
  autoDecomposePerTick: 3,
  autoPromoteChildren: true,
  maxInProgress: 2,
  maxInProgressPerProfile: null,
  failureLimit: 2,
  defaultWorkdir: "",
  allowSelfReview: false,
  dispatchStaleTimeoutSeconds: 4 * 60 * 60,
  blockRecurrenceLimit: 2,
  profileDescriptionsJson: "{}",
};

export type KanbanTask = {
  id: string;
  title: string;
  body: string;
  status: KanbanStatus;
  assignee: string | null;
  tenant: string | null;
  priority: number;
  /** Desktop project registry id — worker CWD = project primary folder. */
  projectId: string | null;
  workspaceKind: WorkspaceKind;
  workspacePath: string | null;
  branch: string | null;
  result: string | null;
  scheduledAt: string | null;
  goalMode: boolean;
  goalMaxTurns: number;
  idempotencyKey: string | null;
  maxRuntimeSeconds: number | null;
  maxRetries: number | null;
  consecutiveFailures: number;
  blockRecurrences: number;
  lastBlockReason: string | null;
  currentRunId: string | null;
  claimLock: string | null;
  claimExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  modelOverride: string | null;
  providerOverride: string | null;
  skillsJson: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskLink = {
  parentId: string;
  childId: string;
};

export type TaskComment = {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type TaskEvent = {
  id: number;
  taskId: string;
  runId: string | null;
  kind: string;
  payloadJson: string;
  createdAt: string;
};

export type TaskRun = {
  id: string;
  taskId: string;
  profile: string;
  outcome: string | null;
  summary: string | null;
  metadataJson: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type TaskAttachment = {
  id: string;
  taskId: string;
  name: string;
  absPath: string;
  sizeBytes: number;
  createdAt: string;
};

export type CreateTaskInput = {
  title: string;
  body?: string;
  status?: KanbanStatus;
  assignee?: string | null;
  tenant?: string | null;
  priority?: number;
  parents?: string[];
  /** Bind task to a desktop project (simkopdes, …). Implies project-scoped CWD. */
  projectId?: string | null;
  workspaceKind?: WorkspaceKind;
  workspacePath?: string | null;
  branch?: string | null;
  scheduledAt?: string | null;
  goalMode?: boolean;
  goalMaxTurns?: number;
  idempotencyKey?: string | null;
  maxRuntimeSeconds?: number | null;
  maxRetries?: number | null;
  skills?: string[];
  modelOverride?: string | null;
  providerOverride?: string | null;
  triage?: boolean;
};

export type SwarmSpec = {
  title: string;
  body?: string;
  workers: string[];
  verifier: string;
  synthesizer: string;
  tenant?: string | null;
  projectId?: string | null;
};

export type TaskDetail = {
  task: KanbanTask;
  comments: TaskComment[];
  events: TaskEvent[];
  runs: TaskRun[];
  parents: string[];
  children: string[];
  attachments: TaskAttachment[];
};
