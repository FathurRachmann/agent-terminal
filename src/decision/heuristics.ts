/**
 * Keyword/heuristic System One stand-in when Laya weights are unavailable.
 * Same question schema so wiring can be tested without PyTorch.
 */
import type {
  ChoiceAnswer,
  DecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
  DecisionResult,
  NoulAnswer,
  ScoreAnswer,
} from "./types.js";

function flattenState(state: unknown): string {
  if (state == null) return "";
  if (typeof state === "string") return state.toLowerCase();
  try {
    return JSON.stringify(state).toLowerCase();
  } catch {
    return String(state).toLowerCase();
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f]+/i)
    .filter((t) => t.length > 1);
}

function overlapScore(hay: string, needle: string): number {
  const tokens = tokenize(needle);
  if (!tokens.length) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hit += 1;
  }
  return hit / tokens.length;
}

function answerChoice(
  stateText: string,
  q: Extract<DecisionQuestion, { type: "choice" }>,
): ChoiceAnswer {
  const scores: Record<string, number> = {};
  let best = "";
  let bestScore = -1;
  for (const [key, criteria] of Object.entries(q.criteria)) {
    const s =
      overlapScore(stateText, `${key} ${criteria} ${q.instructions}`) +
      overlapScore(stateText, key) * 0.5;
    scores[key] = s;
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  const keys = Object.keys(scores);
  if (!best && keys.length) best = keys[0]!;
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) {
    probabilities[k] = v / total;
  }
  // Softmax-ish floor so unused options aren't zero
  const n = keys.length || 1;
  for (const k of keys) {
    probabilities[k] = (probabilities[k] ?? 0) * 0.85 + 0.15 / n;
  }
  const conf = probabilities[best] ?? 1 / n;
  return {
    type: "choice",
    choice: best,
    probabilities,
    confidence: conf,
  };
}

function answerScore(
  stateText: string,
  q: Extract<DecisionQuestion, { type: "score" }>,
): ScoreAnswer {
  const levels = q.criteria;
  if (!levels.length) return { type: "score", score: 0, confidence: 0.5 };
  let bestIdx = 0;
  let best = -1;
  levels.forEach((label, i) => {
    const s = overlapScore(stateText, `${label} ${q.instructions}`);
    if (s > best) {
      best = s;
      bestIdx = i;
    }
  });
  const score = levels.length <= 1 ? 0 : bestIdx / (levels.length - 1);
  return {
    type: "score",
    score,
    confidence: Math.max(0.4, best || 0.45),
  };
}

function answerNoul(
  stateText: string,
  q: Extract<DecisionQuestion, { type: "noul" }>,
): NoulAnswer {
  const instr = q.instructions.toLowerCase();
  let noul = overlapScore(stateText, q.instructions) * 0.65;

  // Domain boosts so gates work without Laya weights.
  if (/desktop|browser|chrome|url|open a browser|open a|buka/.test(instr)) {
    if (
      /\b(buka|open|chrome|browser|https?:\/\/|youtube|gmail)\b/.test(stateText)
    ) {
      noul += 0.35;
    }
  }
  if (/full agent|coding|file edits|research|pdf|planning/.test(instr)) {
    if (
      /\b(refactor|code|test|implement|bug|file|pdf|laporan|api|database)\b/.test(
        stateText,
      )
    ) {
      noul += 0.4;
    }
  }
  if (/web search|internet|fetching pages/.test(instr)) {
    if (/\b(cari|search|google|berita|latest|http)\b/.test(stateText)) {
      noul += 0.4;
    }
  }
  if (/fanout|split|multiple child|specialists/.test(instr)) {
    if (
      /\b(and|dan|frontend|backend|api|react|team|across)\b/.test(stateText)
    ) {
      noul += 0.25;
    }
  }

  const boost =
    /\b(ya|yes|true|perlu|butuh|minta|tolong|please|harus|wajib)\b/i.test(
      stateText,
    )
      ? 0.1
      : 0;
  noul = Math.min(1, Math.max(0, noul + boost + 0.15));
  return { type: "noul", noul, confidence: Math.max(0.45, noul) };
}

export function createHeuristicDecisionEngine(): DecisionEngine {
  return {
    kind: "heuristic",
    async predict(state, questions) {
      const stateText = flattenState(state);
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, q] of Object.entries(questions)) {
        if (q.type === "choice") answers[id] = answerChoice(stateText, q);
        else if (q.type === "score") answers[id] = answerScore(stateText, q);
        else answers[id] = answerNoul(stateText, q);
      }
      return { answers, source: "heuristic" };
    },
  };
}
