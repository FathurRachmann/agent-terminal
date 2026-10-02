/**
 * Shared Model Hub settings chrome — 9Router-inspired layout, project colors.
 */
import React from "react";

export function HubPageHeader({
  title,
  subtitle,
  search,
  onSearch,
  searchPlaceholder,
  actions,
}: {
  title: string;
  subtitle: string;
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold tracking-tight text-fg">{title}</h2>
        <p className="mt-0.5 text-[11px] text-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onSearch ? (
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder ?? "Search…"}
            className="w-[200px] rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-fg outline-none placeholder:text-muted focus:border-accent/50"
          />
        ) : null}
        {actions}
      </div>
    </div>
  );
}

export function HubSection({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-fg">{title}</h3>
          {hint ? <p className="mt-0.5 text-[10.5px] text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function HubBtn({
  children,
  onClick,
  disabled,
  variant = "ghost",
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "danger" | "soft";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-50";
  const variants: Record<string, string> = {
    ghost: "border border-border bg-surface-2 text-fg-dim hover:text-fg",
    primary: "bg-accent text-[#062028] hover:brightness-110",
    soft: "border border-accent/30 bg-accent/15 text-accent-soft hover:bg-accent/25",
    danger: "border border-danger/30 bg-[#2a1518] text-danger hover:border-danger/50",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function StatusDot({
  tone = "muted",
}: {
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  const c =
    tone === "ok"
      ? "bg-success"
      : tone === "warn"
        ? "bg-warn"
        : tone === "danger"
          ? "bg-danger"
          : "bg-muted";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "danger" | "muted" | "accent";
}) {
  const c =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-200 border-amber-500/30"
        : tone === "danger"
          ? "bg-[#2a1518] text-danger border-danger/30"
          : tone === "accent"
            ? "bg-accent/15 text-accent-soft border-accent/30"
            : "bg-surface-2 text-muted border-border";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${c}`}
    >
      {children}
    </span>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
        on ? "bg-accent" : "bg-border-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition ${
          on ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function ProgressBar({
  pct,
  tone = "ok",
}: {
  pct: number;
  tone?: "ok" | "warn" | "danger";
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill =
    tone === "danger"
      ? "bg-danger"
      : tone === "warn"
        ? "bg-warn"
        : "bg-success";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function EmptyDash({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-1/40 px-4 py-8 text-center text-[11px] text-muted">
      {children}
    </div>
  );
}
