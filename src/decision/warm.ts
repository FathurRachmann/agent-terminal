/**
 * Fire-and-forget Laya warmup so the first real turn does not pay cold-start
 * (HF download + torch load). Failures are ignored — heuristics still work.
 */
import { loadDecisionConfig } from "./config.js";
import { getDecisionEngine, isDecisionEngineEnabled } from "./engine.js";

let warmed = false;

export function warmLayaInBackground(): void {
  if (warmed) return;
  if (!isDecisionEngineEnabled()) return;
  const cfg = loadDecisionConfig();
  if (!cfg.preferLaya || !cfg.useProcessBridge) return;
  warmed = true;
  const engine = getDecisionEngine();
  void engine
    .predict(
      { message: "laya warmup" },
      {
        ping: {
          type: "choice",
          instructions: "warmup ping",
          criteria: { a: "alpha", b: "beta" },
        },
      },
    )
    .then((res) => {
      if (res?.source === "laya") {
        console.log("[laya] warmup ok");
      } else {
        console.log("[laya] warmup fell back to heuristic (model still loading?)");
      }
    })
    .catch((err) => {
      console.warn(
        "[laya] warmup failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
}
