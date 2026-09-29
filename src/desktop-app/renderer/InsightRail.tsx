import React from "react";

export type InsightArtifact = {
  id: string;
  title: string;
  subtitle?: string;
  onOpen?: () => void;
};

export type InsightAgent = {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting";
};

export type InsightLogLine = {
  id: string;
  kind: "ok" | "run" | "info";
  text: string;
};

export type InsightRailProps = {
  artifacts: InsightArtifact[];
  agents: InsightAgent[];
  logs: InsightLogLine[];
  onOpenCanvas?: () => void;
  onOpenFiles?: () => void;
  onOpenKanban?: () => void;
};

/** Right column: Latest Artifacts · Active Agents · Console (Aether-style). */
export function InsightRail({
  artifacts,
  agents,
  logs,
  onOpenCanvas,
  onOpenFiles,
  onOpenKanban,
}: InsightRailProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
      <Section
        title="Latest Artifacts"
        actionLabel="Open"
        onAction={onOpenCanvas}
      >
        {artifacts.length === 0 ? (
          <EmptyHint text="No artifacts yet — deliverables appear here." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {artifacts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={a.onOpen}
                  className="group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 text-left transition hover:border-border hover:bg-surface-2"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-soft">
                    <FileGlyph />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-fg">
                      {a.title}
                    </span>
                    {a.subtitle ? (
                      <span className="block truncate text-[10px] text-muted">
                        {a.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted opacity-0 transition group-hover:opacity-100">
                    ↗
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Active Agents"
        actionLabel="Board"
        onAction={onOpenKanban}
      >
        {agents.length === 0 ? (
          <EmptyHint text="Idle — agents show up when a turn is running." />
        ) : (
          <ul className="flex flex-col gap-2">
            {agents.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-xl bg-surface-2/80 px-2.5 py-2"
              >
                <span className="truncate text-[11.5px] font-medium text-fg">
                  {a.name}
                </span>
                <StatusPill status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Console"
        actionLabel="Files"
        onAction={onOpenFiles}
        grow
      >
        <div className="insight-console min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-[#0a0812] px-2.5 py-2 font-mono text-[10.5px] leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-muted">Waiting for tool activity…</div>
          ) : (
            logs.slice(-40).map((l) => (
              <div key={l.id} className="flex gap-2 py-0.5">
                <span
                  className={
                    l.kind === "ok"
                      ? "text-success"
                      : l.kind === "run"
                        ? "text-accent-soft"
                        : "text-muted"
                  }
                >
                  {l.kind === "ok" ? "✓" : l.kind === "run" ? "⚡" : "·"}
                </span>
                <span className="min-w-0 flex-1 break-all text-fg-dim">
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  actionLabel,
  onAction,
  children,
  grow,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  grow?: boolean;
}) {
  return (
    <section
      className={`flex flex-col border-b border-border px-3 py-3 ${
        grow ? "min-h-0 flex-1" : "shrink-0"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">
          {title}
        </h3>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-[10px] font-medium text-accent-soft hover:text-accent"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: InsightAgent["status"] }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-2 py-0.5 text-[9.5px] font-semibold text-accent-soft">
        <span className="insight-pulse h-1.5 w-1.5 rounded-full bg-accent" />
        Running
      </span>
    );
  }
  if (status === "waiting") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2 py-0.5 text-[9.5px] font-semibold text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        Waiting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2 py-0.5 text-[9.5px] font-semibold text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" />
      Idle
    </span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-1 text-[10.5px] leading-snug text-muted">{text}</p>;
}

function FileGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3.5h7l4 4V20.5H7V3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
