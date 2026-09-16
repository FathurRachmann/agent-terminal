import React from "react";

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
  onToggleTheme: () => void;
  onLayoutClick: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
  onSwapPanels: () => void;
  onToggleRail: () => void;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenProfiles: () => void;
};

function IconBtn({
  tip,
  tipPos = "bottom",
  active,
  onClick,
  children,
}: {
  tip: string;
  tipPos?: "top" | "bottom";
  active?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-tip-pos={tipPos}
      aria-label={tip}
      aria-pressed={active}
      onClick={onClick}
      className={`app-no-drag relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-dim transition hover:bg-surface-3 hover:text-fg ${
        active ? "bg-surface-3 text-fg ring-1 ring-border" : ""
      }`}
    >
      {children}
    </button>
  );
}

/** Top app chrome: drag region + layout/theme controls (Hermes-style icon row). */
export function AppHeader({
  title,
  subtitle,
  layoutActive,
  sidebarOpen,
  railOpen,
  swapped,
  terminalOpen,
  theme,
  settingsActive,
  profilesActive,
  onToggleTheme,
  onLayoutClick,
  onToggleSidebar,
  onSwapPanels,
  onToggleRail,
  onToggleTerminal,
  onOpenSettings,
  onOpenProfiles,
}: AppHeaderProps) {
  return (
    <header className="app-drag relative flex h-12 shrink-0 items-center border-b border-border bg-surface-1 pl-[78px] pr-3">
      {/* Left of traffic lights: sidebar toggle */}
      <div className="app-no-drag z-10 flex shrink-0 items-center">
        <IconBtn
          tip={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          active={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <LeftSidebarIcon />
        </IconBtn>
      </div>

      {/* Thread title — centered in the header */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-40">
        <div className="min-w-0 max-w-md text-center">
          <div className="truncate text-[12px] font-semibold text-fg">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-[10px] text-muted">{subtitle}</div>
          ) : null}
        </div>
      </div>

      <div className="app-no-drag z-10 ml-auto flex items-center gap-0.5">
        <IconBtn
          tip={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </IconBtn>

        <IconBtn
          tip="Layouts — ⌘-click resets"
          active={layoutActive}
          onClick={onLayoutClick}
        >
          <span className="relative inline-flex">
            <LayoutIcon />
            <span className="absolute -right-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-surface-2 text-fg-dim ring-1 ring-border">
              <ResetBadgeIcon />
            </span>
          </span>
        </IconBtn>

        <IconBtn
          tip={swapped ? "Restore panel order" : "Swap chat & activity"}
          active={swapped}
          onClick={onSwapPanels}
        >
          <SwapIcon />
        </IconBtn>

        <IconBtn
          tip={railOpen ? "Hide activity rail" : "Show activity rail"}
          active={railOpen}
          onClick={onToggleRail}
        >
          <RightPanelIcon />
        </IconBtn>

        <IconBtn
          tip={terminalOpen ? "Hide terminal" : "Show terminal"}
          active={terminalOpen}
          onClick={onToggleTerminal}
        >
          <BottomPanelIcon />
        </IconBtn>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        <IconBtn
          tip="Profiles"
          active={profilesActive}
          onClick={onOpenProfiles}
        >
          <ProfilesIcon />
        </IconBtn>

        <IconBtn
          tip="Settings"
          active={settingsActive}
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </IconBtn>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="7" height="16" rx="1.2" />
      <rect x="13" y="4" width="8" height="7" rx="1.2" />
      <rect x="13" y="13" width="8" height="7" rx="1.2" />
    </svg>
  );
}

function ResetBadgeIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M1 4v6h6" />
      <path d="M3.5 15a9 9 0 1 0 2-8.5L1 10" />
    </svg>
  );
}

function LeftSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 4v16" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8H7M7 8l3-3M7 8l3 3" />
      <path d="M3 16h14M17 16l-3-3M17 16l-3 3" />
    </svg>
  );
}

function RightPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M15 4v16" />
    </svg>
  );
}

function BottomPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 14h18" />
    </svg>
  );
}

function ProfilesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Proper gear / cog for Settings (was accidentally a sun). */
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
