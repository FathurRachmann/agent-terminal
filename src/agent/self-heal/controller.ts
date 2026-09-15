import { ErrorBuffer, isSelfHealEligibleError } from "./error-buffer.js";
import type { SelfHealPhase, SelfHealStatus, SelfHealTrigger } from "./types.js";

export type SelfHealControllerOptions = {
  maxIterations?: number;
  /** Identical error count required for auto-trigger. */
  errorThreshold?: number;
  cooldownMs?: number;
};

/**
 * Serializes self-heal runs and decides when auto-trigger is allowed.
 */
export class SelfHealController {
  readonly errors = new ErrorBuffer();
  private phase: SelfHealPhase = "idle";
  private trigger: SelfHealTrigger | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private iteration = 0;
  private running = false;
  private lastFinishedAt = 0;
  readonly maxIterations: number;
  readonly errorThreshold: number;
  readonly cooldownMs: number;

  constructor(opts: SelfHealControllerOptions = {}) {
    this.maxIterations = opts.maxIterations ?? 3;
    this.errorThreshold = opts.errorThreshold ?? 2;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
  }

  getStatus(): SelfHealStatus {
    return {
      phase: this.phase,
      trigger: this.trigger,
      startedAt: this.startedAt,
      lastError: this.lastError,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      running: this.running,
    };
  }

  recordTurnError(message: string, source = "turn"): void {
    if (!isSelfHealEligibleError(message)) return;
    this.errors.push(message, source);
    this.lastError = message;
  }

  shouldAutoTrigger(autoEnabled: boolean, threshold?: number): boolean {
    if (!autoEnabled || this.running) return false;
    if (Date.now() - this.lastFinishedAt < this.cooldownMs) return false;
    const latest = this.errors.latest();
    if (!latest || !isSelfHealEligibleError(latest.message)) return false;
    const need = Math.max(1, threshold ?? this.errorThreshold);
    return this.errors.countRecent(latest.fingerprint) >= need;
  }

  /** Acquire lock for a heal run. Returns false if already running / cooling down (manual bypasses cooldown). */
  begin(trigger: SelfHealTrigger): { ok: true } | { ok: false; reason: string } {
    if (this.running) {
      return { ok: false, reason: "Self-heal is already running." };
    }
    if (
      trigger === "auto" &&
      Date.now() - this.lastFinishedAt < this.cooldownMs
    ) {
      return {
        ok: false,
        reason: "Self-heal cooldown active — wait before auto-retry.",
      };
    }
    this.running = true;
    this.trigger = trigger;
    this.phase = "diagnosing";
    this.startedAt = Date.now();
    this.iteration = 1;
    return { ok: true };
  }

  setPhase(phase: SelfHealPhase): void {
    this.phase = phase;
  }

  end(phase: "done" | "failed", lastError?: string): void {
    this.phase = phase;
    this.running = false;
    this.lastFinishedAt = Date.now();
    if (lastError) this.lastError = lastError;
  }
}
