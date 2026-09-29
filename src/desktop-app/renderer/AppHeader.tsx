import React from "react";
import monogramUrl from "./assets/terminal-sys-monogram.png";

export type AppHeaderProps = {
  title: string;
  subtitle?: string;
  layoutActive?: boolean;
  sidebarOpen: boolean;
  railOpen: boolean;
  swapped: boolean;
  terminalOpen: boolean;
  theme: "dark" | "light";
  settingsActive?: boolean;
  profilesActive?: boolean;
  gatewayReady?: boolean;
  modelLabel?: string;
  latencyMs?: number | null;
  onToggleTheme: () => void;
  onLayoutClick: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
  onSwapPanels: () => void;
  onToggleRail: () => void;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenProfiles: () => void;
};

function Ms({
  name,
  size = 14,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, fontVariationSettings: "'wght' 400" }}
      aria-hidden
    >
      {name}
    </span>
  );
}

/**
 * Header — pixel-sliced from Figma node 2:713 (TERMINAL.SYS).
 * Functions preserved: sidebar, rail, terminal, profiles, layout (⌘-click brand).
 */
export function AppHeader({
  title,
  layoutActive,
  railOpen,
  terminalOpen,
  gatewayReady,
  modelLabel,
  latencyMs = 12,
  onLayoutClick,
  onToggleSidebar,
  onToggleRail,
  onToggleTerminal,
  onOpenProfiles,
}: AppHeaderProps) {
  const shortTitle =
    title.length > 42 ? `${title.slice(0, 40)}…` : title || "agent:runtime-loop";

  const latencyLabel =
    typeof latencyMs === "number" && Number.isFinite(latencyMs)
      ? `LATENCY ${Math.round(latencyMs)}ms`
      : modelLabel
        ? modelLabel.slice(0, 18)
        : "LATENCY —";

  return (
    <header
      className="app-drag relative z-50 flex h-10 w-full shrink-0 items-center justify-between overflow-visible bg-black px-2 shadow-[0_1px_8px_rgba(0,0,0,0.4)]"
      data-layout-active={layoutActive || undefined}
    >
      {/* Left — brand (Figma 2:714). macOS traffic lights occupy the pad. */}
      <div className="app-no-drag flex h-8 items-center gap-2 pl-[70px]">
        <span className="h-4 w-px bg-[#464849]/30" aria-hidden />
        <button
          type="button"
          onClick={onLayoutClick}
          data-tip="Layouts — ⌘-click resets"
          data-tip-pos="bottom"
          className="flex items-center gap-0.5"
        >
          <img
            src={monogramUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            draggable={false}
          />
          <span
            className="font-mono text-[10px] font-bold uppercase text-[#aaabab]"
            style={{ letterSpacing: "0.5px", lineHeight: "14px" }}
          >
            TERMINAL.SYS
          </span>
        </button>
      </div>

      {/* Center — runner / session / online (Figma 2:725) */}
      <div className="app-no-drag flex h-5 items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          data-tip="Toggle sessions"
          data-tip-pos="bottom"
          className="inline-flex h-[18px] items-center gap-0.5 bg-[#181a1a] px-2 py-0.5 transition hover:bg-[#222424]"
        >
          <Ms name="dns" size={11} className="text-[#c8c6c5]" />
          <span
            className="font-mono text-[10px] font-bold text-[#c8c6c5]"
            style={{ letterSpacing: "0.6px", lineHeight: "14px" }}
          >
            PROD-RUNNER-01
          </span>
          <Ms name="unfold_more" size={11} className="text-[#aaabab]" />
        </button>

        <span
          className="font-mono text-[13px] text-[#464849]"
          style={{ lineHeight: "20px" }}
          aria-hidden
        >
          /
        </span>

        <div className="flex h-[18px] min-w-0 items-center gap-0.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 ${
              gatewayReady ? "bg-[#7d98ff]" : "bg-[#464849]"
            }`}
          />
          <span
            className="truncate font-mono text-[12px] font-bold text-[#e5e5e6]"
            style={{ lineHeight: "18px" }}
          >
            {shortTitle}
          </span>
        </div>

        <div className="flex h-3.5 items-center gap-0.5 bg-[#121314] px-1">
          <span
            className={`font-mono text-[10px] font-bold ${
              gatewayReady ? "text-[#7d98ff]" : "text-[#aaabab]"
            }`}
            style={{ letterSpacing: "0.6px", lineHeight: "14px" }}
          >
            {gatewayReady ? "ONLINE" : "OFFLINE"}
          </span>
          <span
            className="font-mono text-[10px] font-bold text-[#464849]"
            style={{ letterSpacing: "0.6px" }}
          >
            |
          </span>
          <span
            className="font-mono text-[10px] font-bold text-[#aaabab]"
            style={{ letterSpacing: "0.6px", lineHeight: "14px" }}
          >
            {latencyLabel}
          </span>
        </div>
      </div>

      {/* Right — monitoring / terminal / avatar (Figma 2:746) */}
      <div className="app-no-drag flex h-8 items-center gap-1">
        <button
          type="button"
          data-tip={railOpen ? "Hide telemetry" : "Toggle Telemetry & Activity"}
          data-tip-pos="bottom"
          aria-pressed={railOpen}
          onClick={onToggleRail}
          className="inline-flex items-center justify-center bg-[#181a1a] p-0.5 text-[#aaabab] transition hover:text-[#e5e5e6]"
        >
          <Ms name="monitoring" size={12} />
        </button>
        <button
          type="button"
          data-tip={
            terminalOpen ? "Hide terminal" : "Toggle Integrated Terminal"
          }
          data-tip-pos="bottom"
          aria-pressed={terminalOpen}
          onClick={onToggleTerminal}
          className={`inline-flex items-center justify-center bg-[#181a1a] p-0.5 transition ${
            terminalOpen ? "text-[#c8c6c5]" : "text-[#aaabab] hover:text-[#e5e5e6]"
          }`}
        >
          <Ms name="terminal" size={13} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-[#464849]/30" aria-hidden />
        <button
          type="button"
          data-tip="Profiles"
          data-tip-pos="bottom"
          onClick={onOpenProfiles}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c8c6c5] text-[#404040] transition hover:brightness-95"
        >
          <Ms name="person" size={18} />
        </button>
      </div>
    </header>
  );
}
