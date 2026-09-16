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

export function WaitingCard({ phase }: { phase: AgentPhase }) {
  const color = phaseColor(phase);
  const label = phaseLabel[phase] ?? phase;
  return (
    <div
      className="max-w-[86%] min-w-[200px] self-start"
      role="status"
      aria-live="polite"
      aria-label={`${label}, please wait`}
    >
      <div className="mb-1 text-xs text-muted">Agent · {label.toLowerCase()}</div>
      <div
        className="rounded-[10px] border bg-surface-3 px-3.5 py-3"
        style={{
          borderColor: `${color}55`,
          boxShadow: `0 0 0 1px ${color}18`,
        }}
      >
        <div
          className="flex items-center gap-2.5 font-mono text-[11px]"
          style={{ color }}
        >
          <span className="agent-pulse-ring" style={{ borderColor: color }} />
          <span>{label}</span>
          <TypingDots color={color} />
        </div>
        <ShimmerLine color={color} />
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
      {phase}
    </span>
  );
}
