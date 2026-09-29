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

function Ms({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size }}
      aria-hidden
    >
      {name}
    </span>
  );
}

/** Bottom status strip — TERMINAL.SYS footer chrome. */
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
      className="relative z-50 flex h-7 shrink-0 items-center justify-between bg-surface-0 px-3 shadow-[0_-1px_6px_rgba(0,0,0,0.4)]"
    >
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          data-tip="Gateway activity"
          onClick={() =>
            setMenu((m) => (m === "activity" ? "none" : "activity"))
          }
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase transition hover:bg-surface-3"
        >
          <span
            className={`h-1.5 w-1.5 ${ready ? "bg-tertiary" : "bg-muted"}`}
          />
          <span className="text-fg-dim">GATEWAY:</span>
          <span
            className={`font-bold ${ready ? "text-tertiary" : "text-muted"}`}
          >
            {ready ? "CONNECTED" : "OFFLINE"}
          </span>
        </button>

        {showFooterPhase ? (
          <div
            className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase"
            data-tip={phaseTip}
            role="status"
            aria-live="polite"
          >
            <span className="text-fg-dim">PHASE:</span>
            <span
              className="truncate font-bold"
              style={{ color: processColor }}
            >
              {phase.replace(/_/g, "_").toUpperCase()}
            </span>
            {backgroundBusyCount > 0 ? (
              <span className="text-warn">· BG {backgroundBusyCount}</span>
            ) : null}
            {statusError ? (
              <span className="text-danger">· ERROR</span>
            ) : null}
          </div>
        ) : null}

        {showLearnedInFooter ? (
          <button
            type="button"
            data-tip="Learned memory & rules"
            onClick={() => {
              setMenu((m) => {
                const next = m === "learned" ? "none" : "learned";
                if (next === "learned") onRefreshLearned?.();
                return next;
              });
            }}
            className="flex items-center gap-1 bg-surface-4 px-1.5 py-0.5 font-mono text-[10px] font-bold text-tertiary transition hover:bg-surface-3"
          >
            <Ms name="psychology" size={12} />
            <span>{learnedRules.length} LEARNED RULES</span>
          </button>
        ) : null}

        <div className="hidden items-center gap-0.5 sm:flex">
          <FootBtn tip="Home" onClick={onHome}>
            <Ms name="home" size={13} />
          </FootBtn>
          <FootBtn tip="New profile" onClick={onNewProfile}>
            <Ms name="person_add" size={13} />
          </FootBtn>
          <FootBtn tip="Manage gateways" onClick={onManageGateways}>
            <Ms name="hub" size={13} />
          </FootBtn>
        </div>
      </div>

      <div className="relative flex items-center gap-3">
        <div className="hidden items-center gap-1 font-mono text-[10px] md:flex">
          <span className="tracking-wider text-fg-dim uppercase">MEM:</span>
          <span className="text-fg">512MB / 4096MB</span>
        </div>

        <button
          type="button"
          data-tip="Switch profile"
          aria-expanded={menu === "profiles"}
          disabled={switching}
          onClick={() =>
            setMenu((m) => {
              const next = m === "profiles" ? "none" : "profiles";
              if (next === "profiles") void onRefreshProfiles?.();
              return next;
            })
          }
          className="flex items-center gap-1 px-1 font-mono text-[10px] text-accent transition hover:bg-surface-3 disabled:opacity-60"
        >
          <Ms name="account_tree" size={14} />
          <span className="font-bold tracking-wider uppercase">
            PROFILE: {profileId || "default"}
          </span>
          <Ms name="unfold_more" size={12} />
        </button>

        <button
          type="button"
          data-tip={label}
          onClick={() =>
            setMenu((m) => (m === "activity" ? "none" : "activity"))
          }
          className="flex items-center gap-1 font-mono text-[10px] text-fg-dim transition hover:text-fg"
        >
          <PulseIcon ready={ready} />
        </button>

        {menu === "profiles" ? (
          <div
            role="listbox"
            aria-label="Profiles"
            className="absolute bottom-full right-0 z-30 mb-1 min-w-[160px] max-w-[240px] overflow-hidden border border-border bg-surface-3 py-1 shadow-xl"
          >
            <div className="px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-muted uppercase">
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
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition hover:bg-surface-4 ${
                    active ? "text-accent" : "text-fg"
                  }`}
                >
                  <span className="min-w-0 truncate">{id}</span>
                  {active ? (
                    <span className="shrink-0 text-[9px] text-muted">
                      active
                    </span>
                  ) : null}
                </button>
              );
            })}
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              className="block w-full px-2.5 py-1.5 text-left font-mono text-[11px] text-fg-dim transition hover:bg-surface-4 hover:text-fg"
              onClick={() => {
                setMenu("none");
                onNewProfile?.();
              }}
            >
              New profile…
            </button>
            <button
              type="button"
              className="block w-full px-2.5 py-1.5 text-left font-mono text-[11px] text-fg-dim transition hover:bg-surface-4 hover:text-fg"
              onClick={() => {
                setMenu("none");
                onManageProfiles?.();
              }}
            >
              Manage profiles…
            </button>
          </div>
        ) : null}

        {showLearnedInFooter && menu === "learned" ? (
          <div className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-[360px] overflow-auto border border-border bg-surface-3 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-mono text-[11px] text-fg">
                Learned memory & rules
                <span className="ml-1.5 text-muted">
                  ({learnedRules.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRefreshLearned?.()}
                className="px-1.5 py-0.5 font-mono text-[9.5px] text-accent hover:bg-accent/10"
              >
                ↻ Refresh
              </button>
            </div>
            {learnedRules.length === 0 ? (
              <div className="font-mono text-[10px] text-muted">
                Belum ada aturan yang dipelajari.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {learnedRules.slice(0, 12).map((r) => (
                  <li key={r.id} className="font-mono text-[10px] leading-snug">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="font-bold text-tertiary">LEARNED</span>
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

        {menu === "activity" && status ? (
          <div className="absolute bottom-full right-0 z-30 mb-2 max-h-64 w-[360px] overflow-auto border border-border bg-surface-3 p-3 shadow-xl">
            <div className="mb-2 flex items-center gap-3 font-mono text-[11px]">
              <span className="flex items-center gap-1.5">
                <Dot on={status.connected} /> Connected
              </span>
              <span className="flex items-center gap-1.5">
                <Dot on={status.inferenceReady} /> Inference ready
              </span>
            </div>
            <div className="mb-1 font-mono text-[9px] tracking-wider text-muted uppercase">
              Recent activity
            </div>
            {status.recentActivity.length === 0 ? (
              <div className="font-mono text-[10px] text-muted">
                No recent gateway logs.
              </div>
            ) : (
              <ul className="space-y-2">
                {status.recentActivity.slice(0, 8).map((row, i) => (
                  <li
                    key={`${row.at}-${i}`}
                    className="font-mono text-[10px] leading-snug"
                  >
                    <span
                      className={
                        row.level === "ERROR"
                          ? "text-danger"
                          : row.level === "WARNING"
                            ? "text-warn"
                            : "text-accent"
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
      className={`inline-block h-1.5 w-1.5 ${on ? "bg-accent" : "bg-muted"}`}
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
      className={`inline-flex h-5 w-5 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-accent/20 text-accent"
          : "text-fg-dim hover:bg-surface-3 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function PulseIcon({ ready }: { ready: boolean }) {
  return (
    <span
      className={`material-symbols-outlined text-[14px] ${
        ready ? "text-accent" : "text-muted"
      }`}
      aria-hidden
    >
      monitor_heart
    </span>
  );
}
