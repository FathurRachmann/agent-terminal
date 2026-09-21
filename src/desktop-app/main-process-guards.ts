/**
 * Electron main-process crash guards.
 *
 * Node/undici often surfaces aborted or dropped TLS fetches as
 * `TypeError: terminated`. Without handlers, Electron shows a scary
 * "JavaScript error occurred in the main process" dialog even when the
 * agent turn already failed/retried elsewhere.
 */

import { dialog } from "electron";
import { isBenignNetworkTermination } from "./network-abort.js";

export { isBenignNetworkTermination } from "./network-abort.js";

let installed = false;

export function installMainProcessCrashGuards(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err) => {
    if (isBenignNetworkTermination(err)) {
      console.warn(
        "[main] benign network abort (uncaughtException):",
        err instanceof Error ? err.message : err,
      );
      return;
    }
    console.error("[main] uncaughtException:", err);
    try {
      dialog.showErrorBox(
        "Unexpected error",
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err),
      );
    } catch {
      /* dialog may fail during early boot / quit */
    }
  });

  process.on("unhandledRejection", (reason) => {
    if (isBenignNetworkTermination(reason)) {
      console.warn(
        "[main] benign network abort (unhandledRejection):",
        reason instanceof Error ? reason.message : reason,
      );
      return;
    }
    console.error("[main] unhandledRejection:", reason);
  });
}
