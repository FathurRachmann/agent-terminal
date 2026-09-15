const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAgent", {
  sendPrompt: (prompt) => ipcRenderer.invoke("agent:sendPrompt", prompt),
  selfHeal: (payload) => ipcRenderer.invoke("agent:selfHeal", payload || {}),
  selfHealStatus: () => ipcRenderer.invoke("agent:selfHealStatus"),
  getStatus: () => ipcRenderer.invoke("agent:getStatus"),
  getBots: () => ipcRenderer.invoke("agent:getBots"),
  setActiveBot: (botId) => ipcRenderer.invoke("agent:setActiveBot", botId),
  getLearnedRules: () => ipcRenderer.invoke("agent:getLearnedRules"),
  getSettings: () => ipcRenderer.invoke("agent:getSettings"),
  updateSettings: (payload) =>
    ipcRenderer.invoke("agent:updateSettings", payload || {}),
  listSessions: () => ipcRenderer.invoke("agent:listSessions"),
  newSession: () => ipcRenderer.invoke("agent:newSession"),
  openSession: (threadId) => ipcRenderer.invoke("agent:openSession", threadId),
  listProcesses: () => ipcRenderer.invoke("agent:listProcesses"),
  pollProcess: (pid) => ipcRenderer.invoke("agent:pollProcess", pid),
  killProcess: (pid) => ipcRenderer.invoke("agent:killProcess", pid),
  listCapabilities: () => ipcRenderer.invoke("agent:listCapabilities"),
  listArtifacts: () => ipcRenderer.invoke("agent:listArtifacts"),
  setCapabilityEnabled: (id, enabled) =>
    ipcRenderer.invoke("agent:setCapabilityEnabled", { id, enabled }),
  readWorkspacePreview: (filePath) =>
    ipcRenderer.invoke("agent:readWorkspacePreview", { path: filePath }),
  discoverDeliverables: (payload) =>
    ipcRenderer.invoke("agent:discoverDeliverables", payload || {}),
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
});
