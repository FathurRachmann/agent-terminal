/**
 * Gate desktop fast-path: skip full agent turn only when the prompt is a
 * simple open-url / open-app action (high confidence).
 */
import {
  confidenceOf,
  decisionMinConfidence,
  getDecisionEngine,
  isDecisionEngineEnabled,
  noulOf,
} from "./engine.js";

export type DesktopGateResult = {
  /** true → run desktop fast-path; false → force full agent turn */
  allowFastPath: boolean;
  source: "laya" | "heuristic" | "bypass";
  reason: string;
};

/**
 * When decision engine is off, allowFastPath=true (legacy behavior).
 * When on, require evidence the request is desktop-shaped.
 */
export async function gateDesktopFastPath(options: {
  prompt: string;
  hasParsedIntent: boolean;
  hasFollowUp: boolean;
}): Promise<DesktopGateResult> {
  if (!options.hasParsedIntent) {
    return {
      allowFastPath: false,
      source: "bypass",
      reason: "no desktop intent",
    };
  }
  if (!isDecisionEngineEnabled()) {
    return {
      allowFastPath: true,
      source: "bypass",
      reason: "decision engine disabled",
    };
  }

  const engine = getDecisionEngine();
  const result = await engine.predict(
    {
      prompt: options.prompt.slice(0, 1500),
      has_follow_up: options.hasFollowUp,
    },
    {
      desktop_only: {
        type: "noul",
        instructions:
          "Is this primarily a request to open a browser, URL, or desktop app (possibly with a short UI follow-up like play/search)?",
      },
      needs_full_agent: {
        type: "noul",
        instructions:
          "Does this also require coding, file edits, research, PDF/reports, or multi-step planning that a full agent should handle instead of a desktop shortcut?",
      },
    },
  );

  const desktopOnly = noulOf(result, "desktop_only") ?? 0;
  const needsAgent = noulOf(result, "needs_full_agent") ?? 0;
  const conf = confidenceOf(result, "desktop_only");
  const min = decisionMinConfidence();
  const source = result?.source === "laya" ? "laya" : "heuristic";

  // Intent regex already matched — only veto when the engine is confident
  // this also needs a full coding/research agent.
  if (needsAgent >= min && needsAgent > desktopOnly + 0.05) {
    return {
      allowFastPath: false,
      source,
      reason: `needs_full_agent=${needsAgent.toFixed(2)} > desktop_only=${desktopOnly.toFixed(2)}`,
    };
  }

  if (desktopOnly >= min * 0.7 || options.hasFollowUp || conf >= min) {
    return {
      allowFastPath: true,
      source,
      reason: `desktop_only=${desktopOnly.toFixed(2)} followUp=${options.hasFollowUp}`,
    };
  }

  // Parsed intent present → fail open to fast-path (legacy behavior).
  return {
    allowFastPath: true,
    source,
    reason: `intent-parsed fallback desktop_only=${desktopOnly.toFixed(2)}`,
  };
}
