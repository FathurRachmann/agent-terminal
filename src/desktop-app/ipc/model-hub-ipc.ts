import { ipcMain } from "electron";

export function registerModelHubIpcHandlers(): void {
  ipcMain.handle("model-hub:ping", async () => {
    return { status: "ready", models: [] };
  });
}
