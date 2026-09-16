import React, { useEffect, useState } from "react";

export type GatewayStatusSnapshot = {
  mode: "local";
  phase: "starting" | "ready" | "error" | "stopped";
  label: string;
  connected: boolean;
  inferenceReady: boolean;
  error: string | null;
  profileId: string | null;
  recentActivity: Array<{
    level: "INFO" | "WARNING" | "ERROR";
    source: string;
    message: string;
    at: string;
  }>;
};

type Props = {
  status: GatewayStatusSnapshot | null;
  profileId: string;
  onHome?: () => void;
  onNewProfile?: () => void;
  onManageProfiles?: () => void;
  onManageGateways?: () => void;
  onOpenGatewayPopover?: () => void;
};

export function GatewayStatusBar({
  status,
  profileId,
  onHome,
  onNewProfile,
  onManageProfiles,
  onManageGateways,
  onOpenGatewayPopover,
}: Props) {
  const [menu, setMenu] = useState<"none" | "more" | "activity">("none");
  const label = status?.label ?? "Gateway stopped";
  const ready = status?.phase === "ready";

  useEffect(() => {
    if (menu === "none") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className="relative shrink-0 border-t border-border bg-surface-1 px-2 pb-2 pt-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className="rounded bg-fg/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-surface-0">
          {profileId || "default"}
        </span>
      </div>

      <div className="mb-1.5 flex items-center gap-1 px-0.5">
        <IconBtn title="Home" onClick={onHome}>
          <HomeIcon />
        </IconBtn>
        <IconBtn title="New profile" onClick={onNewProfile}>
          <PlusIcon />
        </IconBtn>
        <IconBtn title="Cloud (unavailable)" disabled>
          <CloudIcon />
        </IconBtn>
        <div className="relative ml-auto flex items-center gap-1">
          <IconBtn
            title="More"
            onClick={() => setMenu((m) => (m === "more" ? "none" : "more"))}
          >
            <DotsIcon />
          </IconBtn>
          <IconBtn title="Manage gateways" onClick={onManageGateways}>
            <PlugIcon />
          </IconBtn>
          {menu === "more" ? (
            <div className="absolute bottom-full right-0 z-20 mb-1 min-w-[150px] rounded-md border border-border bg-fg px-2 py-1.5 text-[11px] font-medium text-surface-0 shadow-lg">
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
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          setMenu((m) => (m === "activity" ? "none" : "activity"));
          onOpenGatewayPopover?.();
        }}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10.5px] text-muted transition hover:bg-surface-2 hover:text-fg-dim"
      >
        <span className="opacity-70">⌘</span>
        <PulseIcon ready={ready} />
        <span>{label}</span>
      </button>

      {menu === "activity" && status ? (
        <div className="absolute bottom-full left-2 right-2 z-30 mb-2 max-h-64 overflow-auto rounded-lg border border-border bg-surface-2 p-3 shadow-xl">
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

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-dim transition hover:border-accent/40 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function CloudIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.7 1.5A3.5 3.5 0 0 0 7 18z" />
      <path d="M12 11v5M12 16l-2-2M12 16l2-2" />
    </svg>
  );
}
function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}
function PlugIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 7v4M15 7v4M8 11h8v2a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4v-2zM12 17v3" />
    </svg>
  );
}
function PulseIcon({ ready }: { ready: boolean }) {
  return (
    <svg
      width="14"
      height="14"
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
