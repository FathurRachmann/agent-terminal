import { ipcMain } from "electron";

export function registerSessionIpcHandlers(): void {
  ipcMain.handle("session:ping", async () => {
    return { active: true, timestamp: Date.now() };
  });
}
