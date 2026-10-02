import { ipcMain, type BrowserWindow } from "electron";

export function registerSystemIpcHandlers(): void {
  ipcMain.handle("system:ping", async () => {
    return { status: "ok", timestamp: Date.now() };
  });
}

export function registerWorkspaceIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("workspace:get-current", async () => {
    return { cwd: process.cwd() };
  });
}
