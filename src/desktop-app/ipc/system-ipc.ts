import { ipcMain } from "electron";

export function registerSystemIpcHandlers(): void {
  ipcMain.handle("system:ping", async () => {
    return { status: "ok", timestamp: Date.now() };
  });
}
