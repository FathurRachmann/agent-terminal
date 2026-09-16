import React from "react";

type Props = {
  layoutEditing: boolean;
  sidebarOpen: boolean;
  railOpen: boolean;
  swapped: boolean;
  terminalOpen?: boolean;
  onOpenSettings: () => void;
  /** Regular click opens layouts modal; ⌘/Ctrl-click resets layout. */
  onLayoutEditorClick: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
  onToggleRail: () => void;
  onSwapPanels: () => void;
  onToggleTerminal?: () => void;
};

function IconBtn({
  tip,
  active,
  onClick,
  children,
}: {
  tip: string;
  active?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-tip-pos="bottom"
      aria-label={tip}
      aria-pressed={active}
      onClick={onClick}
      className={`app-no-drag relative inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-dim transition hover:bg-surface-3 hover:text-fg ${
        active ? "bg-surface-3 text-fg" : ""
      }`}
    >
      {children}
    </button>
  );
}

export function LayoutToolbar({
  layoutEditing,
  sidebarOpen,
  railOpen,
  swapped,
  terminalOpen,
  onOpenSettings,
  onLayoutEditorClick,
  onToggleSidebar,
  onToggleRail,
  onSwapPanels,
  onToggleTerminal,
}: Props) {
  return (
    <div className="app-no-drag flex items-center gap-0.5">
      <IconBtn tip="Settings" onClick={onOpenSettings}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </IconBtn>

      <IconBtn
        tip="Layouts — ⌘-click resets"
        active={layoutEditing}
        onClick={onLayoutEditorClick}
      >
        <span className="relative inline-flex">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="7" height="16" rx="1.2" />
            <rect x="13" y="4" width="8" height="7" rx="1.2" />
            <rect x="13" y="13" width="8" height="7" rx="1.2" />
          </svg>
          <span className="absolute -right-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-surface-2 text-[7px] text-fg-dim ring-1 ring-border">
            <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M1 4v6h6" />
              <path d="M3.5 15a9 9 0 1 0 2-8.5L1 10" />
            </svg>
          </span>
        </span>
      </IconBtn>

      <IconBtn
        tip={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        active={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
          <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
        </svg>
      </IconBtn>

      <IconBtn
        tip={swapped ? "Restore panel order" : "Swap chat & activity"}
        active={swapped}
        onClick={onSwapPanels}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 7H3m0 0 3-3M3 7l3 3" />
          <path d="M16 17h5m0 0-3-3m3 3-3 3" />
          <path d="M3 12h18" />
        </svg>
      </IconBtn>

      <IconBtn
        tip={railOpen ? "Hide activity rail" : "Show activity rail"}
        active={railOpen}
        onClick={onToggleRail}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M15 4v16" />
        </svg>
      </IconBtn>

      {onToggleTerminal ? (
        <IconBtn
          tip={terminalOpen ? "Hide terminal" : "Show terminal"}
          active={Boolean(terminalOpen)}
          onClick={onToggleTerminal}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="1.5" />
            <path d="M3 14h18" />
            <path d="M7 9h.01M10 9h4" />
          </svg>
        </IconBtn>
      ) : null}
    </div>
  );
}

export function PanelResizeHandle({
  active = true,
  emphasized = false,
  onDrag,
  style,
}: {
  /** When false, handle is not rendered. Default true so sidebars always resize. */
  active?: boolean;
  /** Stronger accent line (layout-edit mode). */
  emphasized?: boolean;
  onDrag: (deltaX: number) => void;
  style?: React.CSSProperties;
}) {
  const dragging = React.useRef(false);
  const lastX = React.useRef(0);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(dx);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onDrag]);

  if (!active) return null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      style={style}
      className="layout-resize-handle group relative z-20 w-1.5 shrink-0 cursor-col-resize self-stretch"
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
    >
      <div
        className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition ${
          emphasized
            ? "bg-accent/50 group-hover:bg-accent group-hover:shadow-[0_0_0_1px_rgba(107,159,255,0.35)]"
            : "bg-transparent group-hover:bg-border-strong"
        }`}
      />
    </div>
  );
}

/** Horizontal (row) resize handle — drag vertically; onDrag receives deltaY. */
export function PanelRowResizeHandle({
  active,
  onDrag,
}: {
  active: boolean;
  onDrag: (deltaY: number) => void;
}) {
  const dragging = React.useRef(false);
  const lastY = React.useRef(0);

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dy = e.clientY - lastY.current;
      lastY.current = e.clientY;
      onDrag(dy);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onDrag]);

  if (!active) return null;

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize"
      className="layout-resize-handle group relative z-20 h-1.5 w-full shrink-0 cursor-row-resize"
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastY.current = e.clientY;
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-accent/50 transition group-hover:bg-accent" />
    </div>
  );
}
