import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GatewayStatusSnapshot } from "./GatewayStatusBar.js";
import { phaseColor, type AgentPhase } from "./ActivityChips.js";

type LearnedRule = {
  id: string;
  kind: string;
  title: string;
  content: string;
  updatedAt: string;
  tags: string[];
};

type Props = {
  status: GatewayStatusSnapshot | null;
  profileId: string;
  profiles?: string[];
  phase: AgentPhase;
  backgroundBusyCount?: number;
  statusError?: string | null;
  learnedRules?: LearnedRule[];
  showFooterPhase?: boolean;
  showLearnedInFooter?: boolean;
  onRefreshLearned?: () => void;
  onRefreshProfiles?: () => void | Promise<void>;
  onHome?: () => void;
  onNewProfile?: () => void;
  onManageProfiles?: () => void;
  onSwitchProfile?: (id: string) => void | Promise<void>;
  onManageGateways?: () => void;
};

/** Bottom app chrome: profile + live phase + local gateway status. */
export function AppFooter({
  status,
  profileId,
  profiles = [],
  phase,
  backgroundBusyCount = 0,
  statusError = null,
  learnedRules = [],
  showFooterPhase = true,
  showLearnedInFooter = true,
  onRefreshLearned,
  onRefreshProfiles,
  onHome,
  onNewProfile,
  onManageProfiles,
  onSwitchProfile,
  onManageGateways,
}: Props) {
  const [menu, setMenu] = useState<
    "none" | "more" | "activity" | "learned" | "profiles"
  >("none");
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const label = status?.label ?? "Gateway stopped";
  const ready = status?.phase === "ready";
  const processColor = phaseColor(phase);
  const phaseTip = [
    `Live phase: ${phase}`,
    backgroundBusyCount > 0
      ? backgroundBusyCount === 1
        ? "1 background turn still running"
        : `${backgroundBusyCount} background turns still running`
      : null,
    statusError,
  ]
    .filter(Boolean)
    .join(" · ");

  const profileList = useMemo(() => {
    const ids = profiles.length > 0 ? profiles : [profileId || "default"];
    const uniq = Array.from(new Set(ids.map((id) => id || "default")));
    if (!uniq.includes(profileId || "default")) {
      uniq.unshift(profileId || "default");
    }
    return uniq;
  }, [profiles, profileId]);

  useEffect(() => {
    if (menu === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu("none");
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && rootRef.current?.contains(t)) return;
      setMenu("none");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menu]);

  const handleSwitch = async (id: string) => {
    if (id === (profileId || "default") || switching) {
      setMenu("none");
      return;
    }
    setSwitching(true);
    try {
      await onSwitchProfile?.(id);
      setMenu("none");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <footer
      ref={rootRef}
      className="relative flex h-9 shrink-0 items-center gap-2 border-t border-border bg-surface-1 px-3"
    >
      <div className="relative">
        <button
          type="button"
          data-tip="Switch profile"
          aria-label="Switch profile"
          aria-expanded={menu === "profiles"}
          aria-haspopup="listbox"
          disabled={switching}
          onClick={() =>
            setMenu((m) => {
              const next = m === "profiles" ? "none" : "profiles";
              if (next === "profiles") void onRefreshProfiles?.();
              return next;
            })
          }
          className="rounded bg-fg/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-surface-0 transition hover:bg-fg disabled:opacity-60"
        >
          {profileId || "default"}
        </button>

        {menu === "profiles" ? (
          <div
            role="listbox"
            aria-label="Profiles"
            className="absolute bottom-full left-0 z-30 mb-1 min-w-[160px] max-w-[240px] overflow-hidden rounded-md border border-border bg-surface-2 py-1 shadow-xl"
          >
            <div className="px-2.5 py-1 text-[9px] font-semibold tracking-wider text-muted uppercase">
              Profiles
            </div>
            {profileList.map((id) => {
              const active = id === (profileId || "default");
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={switching}
                  onClick={() => void handleSwitch(id)}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition hover:bg-surface-3 ${
                    active ? "text-accent-soft" : "text-fg"
                  }`}
                >
                  <span className="min-w-0 truncate">{id}</span>
                  {active ? (
                    <span className="shrink-0 text-[9px] text-muted">active</span>
                  ) : null}
                </button>
              );
            })}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              className="block w-full px-2.5 py-1.5 text-left text-[11px] text-fg-dim transition hover:bg-surface-3 hover:text-fg"
              onClick={() => {
                setMenu("none");
                onNewProfile?.();
              }}
            >
              New profile…
            </button>
            <button
              type="button"
              className="block w-full px-2.5 py-1.5 text-left text-[11px] text-fg-dim transition hover:bg-surface-3 hover:text-fg"
              onClick={() => {
                setMenu("none");
                onManageProfiles?.();
              }}
            >
              Manage profiles…
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative flex items-center gap-0.5">
        <FootBtn tip="Home" onClick={onHome}>
          <HomeIcon />
        </FootBtn>
        <FootBtn tip="New profile" onClick={onNewProfile}>
          <PlusIcon />
        </FootBtn>
        <FootBtn tip="Cloud (unavailable)" disabled>
          <CloudIcon />
        </FootBtn>
        {showLearnedInFooter ? (
          <FootBtn
            tip="Learned memory & rules"
            active={menu === "learned"}
            onClick={() => {
              setMenu((m) => {
                const next = m === "learned" ? "none" : "learned";
                if (next === "learned") onRefreshLearned?.();
                return next;
              });
            }}
          >
            <LearnedIcon />
          </FootBtn>
        ) : null}

        {showLearnedInFooter && menu === "learned" ? (
          <div className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-[360px] overflow-auto rounded-lg border border-border bg-surface-2 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] text-fg">
                Learned memory & rules
                <span className="ml-1.5 text-muted">
                  ({learnedRules.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRefreshLearned?.()}
                className="rounded px-1.5 py-0.5 text-[9.5px] text-accent hover:bg-accent/10"
              >
                ↻ Refresh
              </button>
            </div>
            <div className="mb-1 text-[9px] tracking-wider text-muted uppercase">
              Recent learned
            </div>
            {learnedRules.length === 0 ? (
              <div className="text-[10px] text-muted">
                Belum ada aturan yang dipelajari.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {learnedRules.slice(0, 12).map((r) => (
                  <li key={r.id} className="text-[10px] leading-snug">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-semibold text-emerald-400">
                        LEARNED
                      </span>
                      <span className="truncate text-muted">
                        {r.kind || "rule"}
                      </span>
                    </div>
                    <div className="font-medium text-fg">
                      {r.title || "Learned Behavior"}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap text-fg-dim">
                      {r.content}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {showFooterPhase ? (
        <div
          className="ml-1 flex min-w-0 items-center gap-1.5 font-mono text-[10.5px]"
          data-tip={phaseTip}
          role="status"
          aria-live="polite"
          aria-label={`phase: ${phase}`}
        >
          <span className="text-muted">phase:</span>
          <span
            className="inline-flex min-w-0 truncate"
            style={{ color: processColor }}
          >
            {phase.replace(/_/g, " ")}
          </span>
          {backgroundBusyCount > 0 ? (
            <span className="truncate text-[9.5px] text-amber-300/90">
              · bg {backgroundBusyCount}
            </span>
          ) : null}
          {statusError ? (
            <span className="truncate text-[9.5px] text-danger">· error</span>
          ) : null}
        </div>
      ) : null}

      <div className="relative ml-auto flex items-center gap-1">
        <FootBtn
          tip="More"
          onClick={() => setMenu((m) => (m === "more" ? "none" : "more"))}
        >
          <DotsIcon />
        </FootBtn>
        <FootBtn tip="Manage gateways" onClick={onManageGateways}>
          <PlugIcon />
        </FootBtn>
        <button
          type="button"
          data-tip="Gateway activity"
          onClick={() =>
            setMenu((m) => (m === "activity" ? "none" : "activity"))
          }
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] text-muted transition hover:bg-surface-2 hover:text-fg-dim"
        >
          <span className="opacity-70">⌘</span>
          <PulseIcon ready={ready} />
          <span>{label}</span>
        </button>

        {menu === "more" ? (
          <div className="absolute bottom-full right-8 z-30 mb-1 min-w-[150px] rounded-md border border-border bg-fg px-2 py-1.5 text-[11px] font-medium text-surface-0 shadow-lg">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => {
                setMenu("none");
                onManageProfiles?.();
              }}
            >
              Manage profiles…
            </button>
          </div>
        ) : null}

        {menu === "activity" && status ? (
          <div className="absolute bottom-full right-0 z-30 mb-2 max-h-64 w-[360px] overflow-auto rounded-lg border border-border bg-surface-2 p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <Dot on={status.connected} /> Connected
              </span>
              <span className="flex items-center gap-1.5">
                <Dot on={status.inferenceReady} /> Inference ready
              </span>
            </div>
            <div className="mb-1 text-[9px] tracking-wider text-muted uppercase">
              Recent activity
            </div>
            {status.recentActivity.length === 0 ? (
              <div className="text-[10px] text-muted">No recent gateway logs.</div>
            ) : (
              <ul className="space-y-2">
                {status.recentActivity.slice(0, 8).map((row, i) => (
                  <li key={`${row.at}-${i}`} className="text-[10px] leading-snug">
                    <span
                      className={
                        row.level === "ERROR"
                          ? "text-danger"
                          : row.level === "WARNING"
                            ? "text-amber-300"
                            : "text-accent-soft"
                      }
                    >
                      {row.level}
                    </span>{" "}
                    <span className="text-muted">{row.source}</span>
                    <div className="text-fg-dim">{row.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </footer>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${
        on ? "bg-accent" : "bg-muted"
      }`}
    />
  );
}

function FootBtn({
  children,
  tip,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  tip: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      data-tip={tip}
      aria-label={tip}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active || undefined}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-accent/20 text-accent"
          : "text-fg-dim hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function HomeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CloudIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.5A3.5 3.5 0 0 0 7 18z" />
      <path d="M12 11v5M12 16l-2-2M12 16l2-2" />
    </svg>
  );
}
function LearnedIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </svg>
  );
}
function PlugIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 7v4M15 7v4M8 11h8v2a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4v-2zM12 17v3" />
    </svg>
  );
}
function PulseIcon({ ready }: { ready: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke={ready ? "currentColor" : "#6b7280"}
      strokeWidth="1.8"
      className={ready ? "text-accent-soft" : ""}
    >
      <path d="M3 12h3l2-5 3 10 2-5h8" />
    </svg>
  );
}
