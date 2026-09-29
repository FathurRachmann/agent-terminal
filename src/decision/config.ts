import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Env/config for the Laya decision layer (on by default when project .venv has laya). */

export type DecisionConfig = {
  enabled: boolean;
  preferLaya: boolean;
  bridgeScript: string;
  pythonBin: string;
  httpUrl: string | null;
  timeoutMs: number;
  minConfidence: number;
  /**
   * Spawn `scripts/laya_bridge.py` via project venv when HTTP sidecar is missing
   * or fails. Default true when `.venv/bin/python` exists.
   */
  useProcessBridge: boolean;
};

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function falsy(v: string | undefined): boolean {
  if (!v) return false;
  return ["0", "false", "no", "off"].includes(v.trim().toLowerCase());
}

function projectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}

function defaultBridgeScript(): string {
  return path.resolve(projectRoot(), "scripts/laya_bridge.py");
}

/** Prefer project `.venv` interpreter when present. */
export function resolveLayaPythonBin(
  env: NodeJS.ProcessEnv = process.env,
  root: string = projectRoot(),
): string {
  const fromEnv = env.LAYA_PYTHON?.trim() || env.PYTHON?.trim();
  if (fromEnv) return fromEnv;
  for (const rel of [".venv/bin/python", ".venv/bin/python3"]) {
    const candidate = path.join(root, rel);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "python3";
}

export function projectVenvPythonExists(root: string = projectRoot()): boolean {
  return (
    fs.existsSync(path.join(root, ".venv/bin/python")) ||
    fs.existsSync(path.join(root, ".venv/bin/python3"))
  );
}

/**
 * Laya is ON by default.
 * Opt out: LAYA_ENABLED=0 / DECISION_ENGINE=0.
 * Explicit LAYA_ENABLED=1 still wins.
 */
export function loadDecisionConfig(
  env: NodeJS.ProcessEnv = process.env,
): DecisionConfig {
  const raw = env.LAYA_ENABLED ?? env.DECISION_ENGINE;
  const enabled = falsy(raw) ? false : raw === undefined || raw === "" ? true : truthy(raw);

  const pythonBin = resolveLayaPythonBin(env);
  // Process bridge is OPT-IN (`LAYA_FORCE_PROCESS=1`). Cold-spawning
  // `laya_bridge.py` each turn can hang 30–60s while HF/torch loads, which
  // freezes the UI on "Thinking". Prefer HTTP sidecar or heuristics.
  const forceRaw = env.LAYA_FORCE_PROCESS;
  const useProcessBridge = falsy(forceRaw) ? false : truthy(forceRaw);

  return {
    enabled,
    preferLaya: !truthy(env.LAYA_HEURISTIC_ONLY),
    bridgeScript: env.LAYA_BRIDGE?.trim() || defaultBridgeScript(),
    pythonBin,
    httpUrl: env.LAYA_URL?.trim() || null,
    timeoutMs: Math.max(
      500,
      Number.parseInt(env.LAYA_TIMEOUT_MS || "2000", 10) || 2000,
    ),
    minConfidence: Math.min(
      1,
      Math.max(0, Number.parseFloat(env.LAYA_MIN_CONFIDENCE || "0.55") || 0.55),
    ),
    useProcessBridge,
  };
}
