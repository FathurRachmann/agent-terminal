export type SelfHealPhase =
  | "idle"
  | "diagnosing"
  | "repairing"
  | "verifying"
  | "done"
  | "failed";

export type SelfHealTrigger = "manual" | "auto";

export type ErrorRecord = {
  at: number;
  source: string;
  message: string;
  fingerprint: string;
};

export type SelfHealStatus = {
  phase: SelfHealPhase;
  trigger: SelfHealTrigger | null;
  startedAt: number | null;
  lastError: string | null;
  iteration: number;
  maxIterations: number;
  running: boolean;
};
