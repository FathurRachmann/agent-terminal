/**
 * Per-turn tool category gating via decision engine.
 * Heavy tool groups are hidden unless the prompt needs them.
 */
import {
  decisionMinConfidence,
  getDecisionEngine,
  isDecisionEngineEnabled,
  noulOf,
} from "./engine.js";

export const TOOL_CATEGORY_MAP: Record<string, string[]> = {
  web: ["web_search", "web_extract"],
  desktop: [
    "desktop_automate",
    "request_desktop_app_access",
    "show_desktop_apps",
    "computer_screenshot",
    "computer_click",
    "computer_type",
    "computer_key",
  ],
  browser: [
    "browser_open",
    "browser_click",
    "browser_type",
    "browser_eval",
    "browser_screenshot",
    "browser_close",
  ],
  office: ["read_document"],
  vision: ["vision_analyze"],
  speech: ["speech_transcribe"],
  vault: ["vault_store", "vault_list", "vault_get", "vault_delete"],
};

export type ToolFilterDecision = {
  disabledExtra: Set<string>;
  source: "laya" | "heuristic" | "bypass";
  reason: string;
};

export async function decideExtraDisabledTools(options: {
  prompt: string;
  /** Tools already disabled by user prefs — never re-enabled here. */
  alreadyDisabled: Set<string>;
}): Promise<ToolFilterDecision> {
  if (!isDecisionEngineEnabled()) {
    return {
      disabledExtra: new Set(),
      source: "bypass",
      reason: "decision engine disabled",
    };
  }

  const engine = getDecisionEngine();
  const result = await engine.predict(
    { prompt: options.prompt.slice(0, 2000) },
    {
      needs_web: {
        type: "noul",
        instructions:
          "Does the user need live web search or fetching pages from the internet?",
      },
      needs_desktop: {
        type: "noul",
        instructions:
          "Does the user need macOS desktop automation (Chrome, apps, keystrokes)?",
      },
      needs_browser: {
        type: "noul",
        instructions:
          "Does the user need a headless browser for scraping or JS-heavy pages?",
      },
      needs_office: {
        type: "noul",
        instructions:
          "Does the user need to read Word/Excel documents or similar Office files?",
      },
      needs_vision: {
        type: "noul",
        instructions:
          "Does the user need image/screenshot visual analysis?",
      },
      needs_speech: {
        type: "noul",
        instructions:
          "Does the user need speech-to-text / audio transcription of a voice memo or recording?",
      },
      needs_vault: {
        type: "noul",
        instructions:
          "Does the user need to store or retrieve secrets from the vault?",
      },
    },
  );

  const min = decisionMinConfidence();
  const disabledExtra = new Set<string>();
  const flags: Array<[keyof typeof TOOL_CATEGORY_MAP, string]> = [
    ["web", "needs_web"],
    ["desktop", "needs_desktop"],
    ["browser", "needs_browser"],
    ["office", "needs_office"],
    ["vision", "needs_vision"],
    ["speech", "needs_speech"],
    ["vault", "needs_vault"],
  ];

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const [cat, qid] of flags) {
    const p = noulOf(result, qid);
    // Missing answer → keep tools (don't strip on partial payloads).
    if (p == null) {
      kept.push(`${cat}:?`);
      continue;
    }
    if (p < min) {
      for (const tool of TOOL_CATEGORY_MAP[cat] ?? []) {
        if (!options.alreadyDisabled.has(tool)) disabledExtra.add(tool);
      }
      dropped.push(`${cat}:${p.toFixed(2)}`);
    } else {
      kept.push(`${cat}:${p.toFixed(2)}`);
    }
  }

  return {
    disabledExtra,
    source: result?.source === "laya" ? "laya" : "heuristic",
    reason: `keep=[${kept.join(",")}] drop=[${dropped.join(",")}]`,
  };
}
