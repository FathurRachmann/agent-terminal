import React from "react";

export type NavRailId =
  | "chat"
  | "history"
  | "files"
  | "artifacts"
  | "kanban"
  | "messaging"
  | "hub-live"
  | "workspaces"
  | "settings"
  | "profiles";

export type NavIconRailProps = {
  active: NavRailId;
  onSelect: (id: NavRailId) => void;
  onOpenWorkspaces?: () => void;
};

function Ms({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined text-[20px]" aria-hidden>
      {name}
    </span>
  );
}

function RailBtn({
  tip,
  active,
  onClick,
  children,
}: {
  tip: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={tip}
      data-tip-pos="right"
      aria-label={tip}
      aria-pressed={active}
      onClick={onClick}
      className={`relative inline-flex h-10 w-10 items-center justify-center transition-colors ${
        active
          ? "bg-accent text-surface-0 font-bold"
          : "text-fg-dim hover:bg-surface-4 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/** Narrow TERMINAL.SYS icon rail (left of sessions sidebar). */
export function NavIconRail({
  active,
  onSelect,
  onOpenWorkspaces,
}: NavIconRailProps) {
  return (
    <aside className="app-no-drag z-40 flex w-16 shrink-0 flex-col items-center justify-between overflow-visible bg-surface-0 py-3 shadow-[1px_0_8px_rgba(0,0,0,0.3)]">
      <nav className="flex w-full flex-col items-center gap-1 overflow-visible px-1">
        <RailBtn
          tip="Agent Chat"
          active={active === "chat"}
          onClick={() => onSelect("chat")}
        >
          <Ms name="chat" />
        </RailBtn>
        <RailBtn
          tip="Execution Sessions"
          active={active === "history"}
          onClick={() => onSelect("history")}
        >
          <Ms name="play_circle" />
        </RailBtn>
        <RailBtn
          tip="Workspace Files"
          active={active === "files"}
          onClick={() => onSelect("files")}
        >
          <Ms name="folder" />
        </RailBtn>
        <RailBtn
          tip="Build Artifacts"
          active={active === "artifacts"}
          onClick={() => onSelect("artifacts")}
        >
          <Ms name="deployed_code" />
        </RailBtn>
        <RailBtn
          tip="Task Kanban"
          active={active === "kanban"}
          onClick={() => onSelect("kanban")}
        >
          <Ms name="view_kanban" />
        </RailBtn>
        <RailBtn
          tip="Inter-Agent Messaging"
          active={active === "messaging"}
          onClick={() => onSelect("messaging")}
        >
          <Ms name="forum" />
        </RailBtn>
        <RailBtn
          tip="Model Hub Live"
          active={active === "hub-live"}
          onClick={() => onSelect("hub-live")}
        >
          <Ms name="hub" />
        </RailBtn>
        <RailBtn
          tip="Workspaces Directory"
          active={active === "workspaces"}
          onClick={() => {
            onOpenWorkspaces?.();
            onSelect("workspaces");
          }}
        >
          <Ms name="account_tree" />
        </RailBtn>
      </nav>

      <div className="flex w-full flex-col items-center gap-1 px-1">
        <RailBtn
          tip="Agent Profiles"
          active={active === "profiles"}
          onClick={() => onSelect("profiles")}
        >
          <Ms name="smart_toy" />
        </RailBtn>
        <RailBtn
          tip="System Settings"
          active={active === "settings"}
          onClick={() => onSelect("settings")}
        >
          <Ms name="settings" />
        </RailBtn>
      </div>
    </aside>
  );
}
