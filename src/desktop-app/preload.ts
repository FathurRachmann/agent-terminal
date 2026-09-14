import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAgent", {
  sendPrompt: (prompt: string) => ipcRenderer.invoke("agent:sendPrompt", prompt),
  onAgentChunk: (callback: (chunk: string) => void) => {
    const listener = (_: unknown, chunk: string) => callback(chunk);
    ipcRenderer.on("agent:chunk", listener);
    return () => ipcRenderer.removeListener("agent:chunk", listener);
  },
  onToolCall: (callback: (data: { name: string; args: unknown }) => void) => {
    const listener = (_: unknown, data: { name: string; args: unknown }) => callback(data);
    ipcRenderer.on("agent:toolCall", listener);
    return () => ipcRenderer.removeListener("agent:toolCall", listener);
  },
});
