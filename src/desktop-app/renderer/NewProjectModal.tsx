import React, { useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (project: {
    id: string;
    name: string;
    folders: string[];
  }) => void;
};

const IDEA_STARTERS = [
  { label: "Habit tracker", idea: "A simple habit tracker with streaks and daily check-ins." },
  { label: "Music toy", idea: "A playful web music toy — synth pads and sequencers." },
  { label: "Novel", idea: "A long-form novel draft with chapters and character notes." },
  { label: "Budget tracker", idea: "Personal budget tracker with categories and monthly totals." },
  { label: "Recipe box", idea: "A recipe collection with ingredients, steps, and tags." },
  { label: "Puzzle maker", idea: "Generate and play word or logic puzzles." },
];

export function NewProjectModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [idea, setIdea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starterOffset, setStarterOffset] = useState(0);

  const starters = useMemo(() => {
    const n = IDEA_STARTERS.length;
    return Array.from({ length: 6 }, (_, i) => IDEA_STARTERS[(i + starterOffset) % n]!);
  }, [starterOffset]);

  if (!open) return null;

  const addFolder = async () => {
    setError(null);
    try {
      const res = await window.electronAgent?.pickProjectFolder?.();
      if (!res?.ok || !res.path) {
        if (!res?.cancelled) setError(res?.error ?? "Could not pick folder");
        return;
      }
      setFolders((prev) =>
        prev.includes(res.path!) ? prev : [...prev, res.path!],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || folders.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.electronAgent?.createProject?.({
        name: trimmed,
        folders,
        idea: idea.trim() || undefined,
        activate: true,
      });
      if (!res?.ok || !res.project) {
        setError(res?.error ?? "Failed to create project");
        return;
      }
      onCreated(res.project);
      setName("");
      setFolders([]);
      setIdea("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = name.trim().length > 0 && folders.length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">New project</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Name a workspace and add one or more folders.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Workspace name
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Skunkworks"
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
              autoFocus
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-[11px] font-medium text-fg-dim">Folders</div>
              <button
                type="button"
                onClick={() => void addFolder()}
                className="rounded px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10"
              >
                + Add folder
              </button>
            </div>
            {folders.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted">
                No folders added yet.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {folders.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-0 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
                      {f}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFolders((prev) => prev.filter((x) => x !== f))
                      }
                      className="shrink-0 text-[11px] text-muted hover:text-fg"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">Idea</div>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="What's this project about? (saved to IDEA.md)"
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {starters.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setIdea(s.idea)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[10.5px] text-muted hover:border-accent/40 hover:text-fg"
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                title="Shuffle ideas"
                onClick={() => setStarterOffset((o) => o + 3)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted hover:text-fg"
              >
                ↻
              </button>
            </div>
          </label>

          {error ? (
            <div className="rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-2 text-[11px] text-[#ffb4b0]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void submit()}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
