import React from "react";
import { phaseColor, type AgentPhase } from "./ActivityChips.js";

const phaseLabel: Record<AgentPhase, string> = {
  boot: "Starting",
  thinking: "Thinking",
  reasoning: "Reasoning",
  tool: "Running tools",
  pty: "Running shell",
  waiting_approval: "Waiting for approval",
  reflecting: "Reflecting",
  done: "Done",
  error: "Error",
};

const phaseDetailFallback: Record<AgentPhase, string> = {
  boot: "booting runtime…",
  thinking: "planning next steps…",
  reasoning: "working through the problem…",
  tool: "executing tools…",
  pty: "running shell command…",
  waiting_approval: "awaiting your approval…",
  reflecting: "storing session learnings…",
  done: "turn complete",
  error: "something went wrong",
};

export function TypingDots({ color = "#8b98a8" }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-3.5 items-center gap-1 align-middle"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="agent-dot inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color, animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

export function StreamingCaret({ color = "#9fd0ff" }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="agent-caret ml-1 inline-block h-[1.05em] w-1.5 rounded-sm align-text-bottom"
      style={{ background: color }}
    />
  );
}

export function ShimmerLine({ color = "#35507a" }: { color?: string }) {
  return (
    <div
      aria-hidden
      className="agent-shimmer mt-2.5 h-0.5 rounded-full"
      style={{
        background: `linear-gradient(90deg, transparent, ${color}88, transparent)`,
        backgroundSize: "200% 100%",
      }}
    />
  );
}

type WaitingCardProps = {
  phase: AgentPhase;
  detail?: string | null;
  /** Estimated tokens per second from the live stream (chars/4). */
  tokensPerSec?: number | null;
};

const phaseTitleLabel: Record<AgentPhase, string> = {
  boot: "Starting:",
  thinking: "Thinking:",
  reasoning: "Reasoning:",
  tool: "Tool pipeline:",
  pty: "Shell pipeline:",
  waiting_approval: "Awaiting sign-off:",
  reflecting: "Self-Heal check:",
  done: "Done:",
  error: "Error:",
};

export function WaitingCard({
  phase,
  detail,
  tokensPerSec = null,
}: WaitingCardProps) {
  const detailText =
    (detail && detail.trim()) || phaseDetailFallback[phase] || "working…";
  const rate =
    tokensPerSec != null && Number.isFinite(tokensPerSec) && tokensPerSec > 0
      ? tokensPerSec.toFixed(1)
      : null;
  const phaseTitle = phaseTitleLabel[phase] ?? `${phaseLabel[phase] ?? phase}:`;

  return (
    <div
      className="chat-wait"
      role="status"
      aria-live="polite"
      aria-label={`${phaseTitle} ${detailText}${rate ? `, ${rate} tokens per second` : ""}`}
    >
      <div className="chat-wait-main">
        <span className="chat-wait-dot" aria-hidden />
        <div className="chat-wait-stack">
          <span className="chat-wait-phase">{phaseTitle}</span>
          <span className="chat-wait-detail">{detailText}</span>
        </div>
      </div>
      <div className="chat-wait-rate">
        <div className="chat-wait-rate-copy">
          <span className="chat-wait-rate-label">Tokens/sec</span>
          <span className="chat-wait-rate-value">{rate ?? "—"}</span>
        </div>
        <span className="chat-wait-rate-bar" aria-hidden />
      </div>
    </div>
  );
}

export function PhasePill({
  phase,
  busy,
}: {
  phase: AgentPhase;
  busy: boolean;
}) {
  const color = phaseColor(phase);
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider uppercase ${busy ? "agent-phase-busy" : ""}`}
      style={{ color }}
    >
      {busy && <TypingDots color={color} />}
      {phaseLabel[phase] ?? phase}
    </span>
  );
}
