/**
 * Bot routing via decision engine (Laya / heuristic).
 * Returns null when engine disabled or confidence too low → caller keeps LLM/heuristic.
 */
import type { WorkspaceBot } from "../agent/workspaces/bots.js";
import {
  choiceOf,
  confidenceOf,
  decisionMinConfidence,
  getDecisionEngine,
  isDecisionEngineEnabled,
  noulOf,
} from "./engine.js";

export type LayaRouteResult = {
  botIds: string[];
  source: "laya" | "heuristic";
  reason: string;
};

export async function routeBotsWithDecisionEngine(options: {
  message: string;
  bots: WorkspaceBot[];
  maxResponders: number;
}): Promise<LayaRouteResult | null> {
  if (!isDecisionEngineEnabled()) return null;
  const { message, bots, maxResponders } = options;
  if (bots.length === 0) return null;

  const engine = getDecisionEngine();
  const criteria: Record<string, string> = {};
  for (const b of bots.slice(0, 20)) {
    const skills = (b.skills ?? []).slice(0, 6).join(",");
    const tools = (b.tools ?? []).slice(0, 8).join(",");
    criteria[b.id] =
      `${b.name}; role=${b.role ?? ""}; ${b.description}; skills=${skills}; tools=${tools}`.slice(
        0,
        160,
      );
  }

  const result = await engine.predict(
    { message: message.slice(0, 2000) },
    {
      primary: {
        type: "choice",
        instructions:
          "Which teammate bot best matches this message by role, skills, and tools?",
        criteria,
      },
      needs_multiple: {
        type: "noul",
        instructions:
          "Does this message clearly need more than one specialist bot (different skills) to reply?",
      },
    },
  );

  const primary = choiceOf(result, "primary");
  const conf = confidenceOf(result, "primary");
  const min = decisionMinConfidence();
  if (!primary || !bots.some((b) => b.id === primary) || conf < min) {
    return null;
  }

  const ids = [primary];
  const multi = noulOf(result, "needs_multiple") ?? 0;
  if (multi >= min && maxResponders > 1 && result) {
    const probs =
      result.answers.primary?.type === "choice"
        ? result.answers.primary.probabilities
        : {};
    const ranked = Object.entries(probs)
      .filter(([id]) => id !== primary && bots.some((b) => b.id === id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    for (const id of ranked) {
      if (ids.length >= maxResponders) break;
      ids.push(id);
    }
  }

  return {
    botIds: ids,
    source: result?.source === "laya" ? "laya" : "heuristic",
    reason: `Decision engine (${result?.source ?? "none"}) → ${ids.join(", ")} (conf=${conf.toFixed(2)})`,
  };
}
