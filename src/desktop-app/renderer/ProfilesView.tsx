import React, { useCallback, useEffect, useMemo, useState } from "react";

type ProfileSummary = {
  id: string;
  name?: string;
  home: string;
  isActive: boolean;
  isDefault: boolean;
  hasEnv: boolean;
  soulPreview: string;
  skillsCount: number;
  model?: string;
};

type Props = {
  onClose?: () => void;
  onSwitched?: (profileId: string) => void;
  onNewProfile?: () => void;
};

export function ProfilesView({ onClose, onSwitched, onNewProfile }: Props) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soul, setSoul] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await window.electronAgent?.listProfiles?.();
    if (!res?.ok) return;
    setProfiles(res.profiles);
    const active = res.activeProfileId || res.profiles[0]?.id || null;
    setSelectedId((prev) => prev ?? active);
  }, []);

  const loadSoul = useCallback(async (id: string) => {
    const res = await window.electronAgent?.getProfile?.(id);
    if (res?.ok && res.profile) {
      setSoul(res.soul ?? "");
      setSelectedId(res.profile.id);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) void loadSoul(selectedId);
  }, [selectedId, loadSoul]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.id.includes(q) ||
        (p.name ?? "").toLowerCase().includes(q) ||
        p.home.toLowerCase().includes(q),
    );
  }, [profiles, query]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const saveSoul = async () => {
    if (!selectedId) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await window.electronAgent?.updateProfileSoul?.({
        id: selectedId,
        soul,
      });
      if (!res?.ok) {
        setStatus(res?.error ?? "Save failed");
        return;
      }
      setStatus(res.reloaded ? "Saved & reloaded engine." : "Saved SOUL.md.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (id: string) => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await window.electronAgent?.switchProfile?.(id);
      if (!res?.ok) {
        setStatus(res?.error ?? "Switch failed");
        return;
      }
      setStatus(`Switched to ${id}`);
      await refresh();
      onSwitched?.(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-fg">Profiles</div>
          <div className="text-[11px] text-muted">
            Isolated agent environments (SOUL.md, config, skills, sessions)
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-muted hover:bg-surface-2"
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-surface-1">
          <div className="border-b border-border px-3 py-2 text-[10px] tracking-wider text-muted uppercase">
            Profiles ({profiles.length})
          </div>
          <div className="p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search profiles…"
              className="w-full rounded-md border border-border bg-surface-0 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-accent/40"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`mb-1 w-full rounded-md px-2 py-2 text-left text-[12px] ${
                  selectedId === p.id
                    ? "bg-accent/15 text-accent-soft"
                    : "text-fg-dim hover:bg-surface-2"
                }`}
              >
                <div className="font-medium">{p.name || p.id}</div>
                {p.isActive ? (
                  <div className="text-[9px] text-accent-soft">Active</div>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onNewProfile}
            className="m-2 rounded-md border border-border bg-surface-2 py-2 text-center text-[14px] text-fg hover:border-accent/40"
            title="New profile"
          >
            +
          </button>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!selected ? (
            <div className="text-sm text-muted">Select a profile</div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-fg">{selected.id}</h1>
                {selected.isDefault ? (
                  <Badge tone="accent">Default</Badge>
                ) : null}
                {selected.hasEnv ? <Badge>.Env</Badge> : null}
                {selected.isActive ? <Badge tone="accent">Active</Badge> : null}
              </div>

              <dl className="mb-5 grid gap-2 text-[12px] text-fg-dim">
                <div>
                  <dt className="text-muted">Path</dt>
                  <dd className="font-mono text-[11px] text-fg">{selected.home}</dd>
                </div>
                <div>
                  <dt className="text-muted">Model</dt>
                  <dd>{selected.model || "(from env / settings)"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Skills</dt>
                  <dd>{selected.skillsCount}</dd>
                </div>
              </dl>

              <div className="mb-3 flex gap-2">
                {!selected.isActive ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void switchTo(selected.id)}
                    className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-[11px] font-semibold text-accent-soft disabled:opacity-40"
                  >
                    Switch to this profile
                  </button>
                ) : null}
                {!selected.isDefault ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      await window.electronAgent?.setDefaultProfile?.(selected.id);
                      await refresh();
                    }}
                    className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-fg-dim"
                  >
                    Make default
                  </button>
                ) : null}
              </div>

              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">
                SOUL.md
              </div>
              <p className="mb-2 text-[11px] text-muted">
                The system prompt and persona instructions baked into this
                profile.
              </p>
              <textarea
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                rows={16}
                className="mb-3 w-full resize-y rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-[12px] leading-relaxed text-fg outline-none focus:border-accent/40"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] text-muted">{status}</div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveSoul()}
                  className="rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                >
                  Save SOUL.md
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "accent";
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${
        tone === "accent"
          ? "bg-accent/20 text-accent-soft"
          : "bg-surface-2 text-muted"
      }`}
    >
      {children}
    </span>
  );
}
