/**
 * Talk to Laya via HTTP sidecar or `scripts/laya_bridge.py`.
 * Returns null on any failure (callers fall back).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { DecisionConfig } from "./config.js";
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
  DecisionResult,
} from "./types.js";

function normalizeAnswers(
  raw: Record<string, unknown>,
): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.choice === "string") {
      out[id] = {
        type: "choice",
        choice: v.choice,
        probabilities:
          v.probabilities && typeof v.probabilities === "object"
            ? (v.probabilities as Record<string, number>)
            : { [v.choice]: 1 },
        confidence:
          typeof v.confidence === "number" ? v.confidence : undefined,
      };
      continue;
    }
    if (typeof v.score === "number") {
      out[id] = {
        type: "score",
        score: v.score,
        confidence:
          typeof v.confidence === "number" ? v.confidence : undefined,
      };
      continue;
    }
    if (typeof v.noul === "number") {
      out[id] = {
        type: "noul",
        noul: v.noul,
        confidence:
          typeof v.confidence === "number" ? v.confidence : undefined,
      };
    }
  }
  return out;
}

async function predictHttp(
  url: string,
  state: unknown,
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number,
): Promise<DecisionResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, questions }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      answers?: Record<string, unknown>;
      routing?: { model?: string };
    };
    if (!body.answers) return null;
    return {
      answers: normalizeAnswers(body.answers),
      routing: body.routing,
      source: "laya",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function predictProcess(
  config: DecisionConfig,
  state: unknown,
  questions: Record<string, DecisionQuestion>,
): Promise<DecisionResult | null> {
  const script = config.bridgeScript;
  if (!fs.existsSync(script)) return null;

  return new Promise((resolve) => {
    const child = spawn(config.pythonBin, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let settled = false;
    const finish = (value: DecisionResult | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish(null);
    }, config.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const body = JSON.parse(stdout) as {
          ok?: boolean;
          answers?: Record<string, unknown>;
          routing?: { model?: string };
        };
        if (!body.ok || !body.answers) {
          finish(null);
          return;
        }
        finish({
          answers: normalizeAnswers(body.answers),
          routing: body.routing,
          source: "laya",
        });
      } catch {
        finish(null);
      }
    });

    try {
      child.stdin.write(JSON.stringify({ state, questions }));
      child.stdin.end();
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

export function createLayaDecisionEngine(
  config: DecisionConfig,
): DecisionEngine {
  return {
    kind: "laya",
    async predict(state, questions) {
      if (config.httpUrl) {
        const viaHttp = await predictHttp(
          config.httpUrl,
          state,
          questions,
          config.timeoutMs,
        );
        if (viaHttp) return viaHttp;
      }
      if (!config.useProcessBridge) return null;
      return predictProcess(config, state, questions);
    },
  };
}
