/**
 * Decision engine singleton: Laya when enabled+available, else heuristic, else disabled.
 */
import { loadDecisionConfig, type DecisionConfig } from "./config.js";
import { createHeuristicDecisionEngine } from "./heuristics.js";
import { createLayaDecisionEngine } from "./laya-client.js";
import type { DecisionEngine, DecisionResult } from "./types.js";

let cached: { configKey: string; engine: DecisionEngine } | null = null;

function configKey(c: DecisionConfig): string {
  return [
    c.enabled,
    c.preferLaya,
    c.httpUrl ?? "",
    c.bridgeScript,
    c.pythonBin,
    c.minConfidence,
    c.useProcessBridge,
  ].join("|");
}

export function getDecisionEngine(
  env: NodeJS.ProcessEnv = process.env,
): DecisionEngine {
  const config = loadDecisionConfig(env);
  const key = configKey(config);
  if (cached?.configKey === key) return cached.engine;

  let engine: DecisionEngine;
  if (!config.enabled) {
    engine = {
      kind: "disabled",
      async predict() {
        return null;
      },
    };
  } else if (config.preferLaya) {
    const laya = createLayaDecisionEngine(config);
    const heuristic = createHeuristicDecisionEngine();
    engine = {
      kind: "laya",
      async predict(state, questions) {
        // Heuristic is instant — kick it in parallel so we never serialize
        // a slow Laya cold-start in front of it.
        const heuristicPromise = heuristic.predict(state, questions);
        const fromLaya = await laya.predict(state, questions);
        const fromHeuristic = await heuristicPromise;
        if (!fromLaya || !Object.keys(fromLaya.answers).length) {
          return fromHeuristic;
        }
        // Merge: Laya wins per-key; heuristic fills missing keys (partial payloads).
        const merged = {
          ...fromHeuristic!.answers,
          ...fromLaya.answers,
        };
        // Drop empty/invalid choice answers so heuristic can refill
        for (const [id, q] of Object.entries(questions)) {
          const a = merged[id];
          if (!a) continue;
          if (q.type === "choice" && a.type === "choice" && !a.choice) {
            delete merged[id];
          }
        }
        for (const id of Object.keys(questions)) {
          if (!merged[id] && fromHeuristic?.answers[id]) {
            merged[id] = fromHeuristic.answers[id]!;
          }
        }
        return {
          answers: merged,
          routing: fromLaya.routing,
          source: "laya",
        };
      },
    };
  } else {
    engine = createHeuristicDecisionEngine();
  }

  cached = { configKey: key, engine };
  return engine;
}

/** Test helper — clear singleton. */
export function resetDecisionEngineCache(): void {
  cached = null;
}

export function decisionMinConfidence(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return loadDecisionConfig(env).minConfidence;
}

export function isDecisionEngineEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return loadDecisionConfig(env).enabled;
}

export function choiceOf(
  result: DecisionResult | null,
  id: string,
): string | null {
  const a = result?.answers[id];
  if (!a || a.type !== "choice") return null;
  return a.choice;
}

export function noulOf(
  result: DecisionResult | null,
  id: string,
): number | null {
  const a = result?.answers[id];
  if (!a || a.type !== "noul") return null;
  return a.noul;
}

export function scoreOf(
  result: DecisionResult | null,
  id: string,
): number | null {
  const a = result?.answers[id];
  if (!a || a.type !== "score") return null;
  return a.score;
}

export function confidenceOf(
  result: DecisionResult | null,
  id: string,
): number {
  const a = result?.answers[id];
  if (!a) return 0;
  if (typeof a.confidence === "number") return a.confidence;
  if (a.type === "choice") return a.probabilities[a.choice] ?? 0;
  if (a.type === "noul") return Math.max(a.noul, 1 - a.noul);
  return 0.5;
}
