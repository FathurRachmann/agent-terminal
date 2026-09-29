/**
 * Decision-engine types (System One / Laya-compatible).
 * choice | score | noul — never free-form text generation.
 */

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type NoulQuestion = {
  type: "noul";
  instructions: string;
};

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  confidence?: number;
};

export type NoulAnswer = {
  type: "noul";
  noul: number;
  confidence?: number;
};

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export type DecisionResult = {
  answers: Record<string, DecisionAnswer>;
  routing?: { model?: string };
  source: "laya" | "heuristic" | "none";
};

export type DecisionEngine = {
  readonly kind: "laya" | "heuristic" | "disabled";
  predict(
    state: unknown,
    questions: Record<string, DecisionQuestion>,
  ): Promise<DecisionResult | null>;
};
