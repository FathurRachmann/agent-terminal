const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAgent", {
  sendPrompt: (prompt, attachments) =>
    ipcRenderer.invoke(
      "agent:sendPrompt",
      attachments?.length
        ? { prompt, attachments }
        : prompt,
    ),
  pickAttachments: (options) =>
    ipcRenderer.invoke("agent:pickAttachments", options || {}),
  importAttachmentPaths: (paths) =>
    ipcRenderer.invoke("agent:importAttachmentPaths", { paths }),
  importAttachmentBuffer: (payload) =>
    ipcRenderer.invoke("agent:importAttachmentBuffer", payload || {}),
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile?.(file) || file?.path || "";
    } catch {
      return file?.path || "";
    }
  },

  selfHeal: (payload) => ipcRenderer.invoke("agent:selfHeal", payload || {}),
  selfHealStatus: () => ipcRenderer.invoke("agent:selfHealStatus"),
  getStatus: () => ipcRenderer.invoke("agent:getStatus"),
  getGitSummary: () => ipcRenderer.invoke("agent:getGitSummary"),
  listGitBranches: () => ipcRenderer.invoke("agent:listGitBranches"),
  checkoutGitBranch: (branch) =>
    ipcRenderer.invoke("agent:checkoutGitBranch", { branch }),
  getBots: () => ipcRenderer.invoke("agent:getBots"),
  setActiveBot: (botId) => ipcRenderer.invoke("agent:setActiveBot", botId),
  getLearnedRules: () => ipcRenderer.invoke("agent:getLearnedRules"),
  getSettings: () => ipcRenderer.invoke("agent:getSettings"),
  updateSettings: (payload) =>
    ipcRenderer.invoke("agent:updateSettings", payload || {}),
  listSessions: () => ipcRenderer.invoke("agent:listSessions"),
  newSession: () => ipcRenderer.invoke("agent:newSession"),
  openSession: (threadId) => ipcRenderer.invoke("agent:openSession", threadId),
  clearSession: (threadId) => ipcRenderer.invoke("agent:clearSession", threadId),
  deleteSession: (threadId) =>
    ipcRenderer.invoke("agent:deleteSession", threadId),
  moveSessionToProject: (threadId, projectId) =>
    ipcRenderer.invoke("agent:moveSessionToProject", { threadId, projectId }),
  listProcesses: () => ipcRenderer.invoke("agent:listProcesses"),
  pollProcess: (pid) => ipcRenderer.invoke("agent:pollProcess", pid),
  killProcess: (pid) => ipcRenderer.invoke("agent:killProcess", pid),
  terminalCreate: (opts) => ipcRenderer.invoke("terminal:create", opts || {}),
  terminalWrite: (id, data) =>
    ipcRenderer.invoke("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) =>
    ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  terminalKill: (id) => ipcRenderer.invoke("terminal:kill", id),
  terminalList: () => ipcRenderer.invoke("terminal:list"),
  onTerminalData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
  listCapabilities: () => ipcRenderer.invoke("agent:listCapabilities"),
  listArtifacts: () => ipcRenderer.invoke("agent:listArtifacts"),
  setCapabilityEnabled: (id, enabled) =>
    ipcRenderer.invoke("agent:setCapabilityEnabled", { id, enabled }),
  readWorkspacePreview: (filePath) =>
    ipcRenderer.invoke("agent:readWorkspacePreview", { path: filePath }),
  listWorkspaceDir: (dirPath) =>
    ipcRenderer.invoke("agent:listWorkspaceDir", { path: dirPath || "" }),
  listWorkspaceChanges: () => ipcRenderer.invoke("agent:listWorkspaceChanges"),
  discoverDeliverables: (payload) =>
    ipcRenderer.invoke("agent:discoverDeliverables", payload || {}),
  exportWorkspaceFile: (filePath) =>
    ipcRenderer.invoke("agent:exportWorkspaceFile", { path: filePath }),
  revealWorkspaceFile: (filePath) =>
    ipcRenderer.invoke("agent:revealWorkspaceFile", { path: filePath }),
  openWorkspaceFile: (filePath) =>
    ipcRenderer.invoke("agent:openWorkspaceFile", { path: filePath }),
  resolveApproval: (approve, threadId) =>
    ipcRenderer.invoke("agent:resolveApproval", {
      approve: Boolean(approve),
      threadId: threadId || undefined,
    }),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  getMessagingConfig: () => ipcRenderer.invoke("messaging:getConfig"),
  saveMessagingConfig: (payload) =>
    ipcRenderer.invoke("messaging:saveConfig", payload || {}),
  whatsappStatus: () => ipcRenderer.invoke("messaging:whatsappStatus"),
  whatsappStart: () => ipcRenderer.invoke("messaging:whatsappStart"),
  whatsappStop: () => ipcRenderer.invoke("messaging:whatsappStop"),
  whatsappLogout: () => ipcRenderer.invoke("messaging:whatsappLogout"),
  onMessagingEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("messaging:event", listener);
    return () => ipcRenderer.removeListener("messaging:event", listener);
  },
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  getProfile: (id) => ipcRenderer.invoke("profiles:get", id),
  createProfile: (payload) => ipcRenderer.invoke("profiles:create", payload || {}),
  updateProfileSoul: (payload) =>
    ipcRenderer.invoke("profiles:updateSoul", payload || {}),
  setDefaultProfile: (id) => ipcRenderer.invoke("profiles:setDefault", id),
  switchProfile: (id) => ipcRenderer.invoke("profiles:switch", id),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (payload) =>
    ipcRenderer.invoke("projects:create", payload || {}),
  updateProject: (payload) =>
    ipcRenderer.invoke("projects:update", payload || {}),
  deleteProject: (id) => ipcRenderer.invoke("projects:delete", id),
  setActiveProject: (id, opts) =>
    ipcRenderer.invoke("projects:setActive", {
      id: id ?? null,
      force: Boolean(opts && opts.force),
    }),
  pickProjectFolder: () => ipcRenderer.invoke("projects:pickFolder"),

  // Workspaces (divisions)
  listWorkspaces: () => ipcRenderer.invoke("workspaces:list"),
  createWorkspace: (payload) =>
    ipcRenderer.invoke("workspaces:create", payload || {}),
  updateWorkspace: (payload) =>
    ipcRenderer.invoke("workspaces:update", payload || {}),
  deleteWorkspace: (id) => ipcRenderer.invoke("workspaces:delete", id),
  getWorkspace: (id) => ipcRenderer.invoke("workspaces:get", id),
  assignWorkspaceProject: (payload) =>
    ipcRenderer.invoke("workspaces:assignProject", payload || {}),
  unassignWorkspaceProject: (payload) =>
    ipcRenderer.invoke("workspaces:unassignProject", payload || {}),
  setWorkspaceActiveProject: (payload) =>
    ipcRenderer.invoke("workspaces:setActiveProject", payload || {}),
  listWorkspaceBots: (workspaceId) =>
    ipcRenderer.invoke("workspaces:listBots", workspaceId),
  createWorkspaceBot: (payload) =>
    ipcRenderer.invoke("workspaces:createBot", payload || {}),
  updateWorkspaceBot: (payload) =>
    ipcRenderer.invoke("workspaces:updateBot", payload || {}),
  deleteWorkspaceBot: (payload) =>
    ipcRenderer.invoke("workspaces:deleteBot", payload || {}),
  listWorkspaceChats: (workspaceId) =>
    ipcRenderer.invoke("workspaces:listChats", workspaceId),
  createWorkspaceChat: (payload) =>
    ipcRenderer.invoke("workspaces:createChat", payload || {}),
  updateWorkspaceChat: (payload) =>
    ipcRenderer.invoke("workspaces:updateChat", payload || {}),
  deleteWorkspaceChat: (payload) =>
    ipcRenderer.invoke("workspaces:deleteChat", payload || {}),
  openWorkspaceChat: (payload) =>
    ipcRenderer.invoke("workspaces:openChat", payload || {}),
  sendWorkspaceGroupPrompt: (payload) =>
    ipcRenderer.invoke("workspaces:sendGroupPrompt", payload || {}),
  openWorkspacesWindow: () => ipcRenderer.invoke("workspaces:openWindow"),

  getGatewayStatus: () => ipcRenderer.invoke("gateway:getStatus"),
  testLocalGateway: () => ipcRenderer.invoke("gateway:testLocal"),
  setGatewayMode: (mode) => ipcRenderer.invoke("gateway:setMode", { mode }),
  openGatewayLogs: () => ipcRenderer.invoke("gateway:openLogs"),

  // Kanban
  kanbanBoardsList: () => ipcRenderer.invoke("kanban:boards:list"),
  kanbanBoardsCreate: (payload) =>
    ipcRenderer.invoke("kanban:boards:create", payload || {}),
  kanbanBoardsSwitch: (slug) => ipcRenderer.invoke("kanban:boards:switch", slug),
  kanbanBoardsRename: (payload) =>
    ipcRenderer.invoke("kanban:boards:rename", payload || {}),
  kanbanBoardsUpdate: (payload) =>
    ipcRenderer.invoke("kanban:boards:update", payload || {}),
  kanbanBoardsArchive: (slug) => ipcRenderer.invoke("kanban:boards:archive", slug),
  kanbanBoardsCurrent: () => ipcRenderer.invoke("kanban:boards:current"),
  kanbanList: (payload) => ipcRenderer.invoke("kanban:list", payload || {}),
  kanbanGet: (payload) => ipcRenderer.invoke("kanban:get", payload || {}),
  kanbanCreate: (payload) => ipcRenderer.invoke("kanban:create", payload || {}),
  kanbanUpdate: (payload) => ipcRenderer.invoke("kanban:update", payload || {}),
  kanbanMove: (payload) => ipcRenderer.invoke("kanban:move", payload || {}),
  kanbanDelete: (payload) => ipcRenderer.invoke("kanban:delete", payload || {}),
  kanbanComment: (payload) => ipcRenderer.invoke("kanban:comment", payload || {}),
  kanbanGetSettings: (payload) =>
    ipcRenderer.invoke("kanban:getSettings", payload || {}),
  kanbanSetSettings: (payload) =>
    ipcRenderer.invoke("kanban:setSettings", payload || {}),
  kanbanDispatchNow: (payload) =>
    ipcRenderer.invoke("kanban:dispatchNow", payload || {}),
  kanbanRequestReview: (payload) =>
    ipcRenderer.invoke("kanban:requestReview", payload || {}),
  kanbanSwarm: (payload) => ipcRenderer.invoke("kanban:swarm", payload || {}),
  kanbanSchedule: (payload) =>
    ipcRenderer.invoke("kanban:schedule", payload || {}),
  kanbanComplete: (payload) =>
    ipcRenderer.invoke("kanban:complete", payload || {}),
  kanbanBlock: (payload) => ipcRenderer.invoke("kanban:block", payload || {}),
  kanbanUnblock: (payload) =>
    ipcRenderer.invoke("kanban:unblock", payload || {}),
  onKanbanChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("kanban:changed", listener);
    return () => ipcRenderer.removeListener("kanban:changed", listener);
  },
  cronList: () => ipcRenderer.invoke("cron:list"),
  cronCreate: (payload) => ipcRenderer.invoke("cron:create", payload || {}),
  cronUpdate: (payload) => ipcRenderer.invoke("cron:update", payload || {}),
  cronRemove: (id) => ipcRenderer.invoke("cron:remove", id),
  cronTickNow: () => ipcRenderer.invoke("cron:tickNow"),
  onCronChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("cron:changed", listener);
    return () => ipcRenderer.removeListener("cron:changed", listener);
  },
});
