import React, { useMemo, useState } from "react";
import { WORKSPACE_DIVISION_OPTIONS } from "../../agent/workspaces/division-options.js";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (workspace: {
    id: string;
    name: string;
    description?: string;
  }) => void;
};

export function NewWorkspaceModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [division, setDivision] = useState<string>("it");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => WORKSPACE_DIVISION_OPTIONS.filter((o) => o.id !== "engineering"),
    [],
  );

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.electronAgent?.createWorkspace?.({
        name: trimmed,
        description: description.trim() || undefined,
        division,
        seedItRoles: division === "it",
      });
      if (!res?.ok || !res.workspace) {
        setError(res?.error ?? "Failed to create workspace");
        return;
      }
      onCreated(res.workspace);
      setName("");
      setDescription("");
      setDivision("it");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = name.trim().length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">New workspace</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Pilih divisi — roster bot dari agency-agents (264 agent / 18
              divisi).
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Divisi IT"
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Description
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>

          <fieldset className="block">
            <legend className="mb-1.5 text-[11px] font-medium text-fg-dim">
              Division roster
            </legend>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {options.map((d) => (
                <label
                  key={d.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] ${
                    division === d.id
                      ? "border-accent/50 bg-accent/10 text-fg"
                      : "border-border bg-surface-0 text-fg-dim hover:border-border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="workspace-division"
                    className="mt-0.5"
                    checked={division === d.id}
                    onChange={() => setDivision(d.id)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{d.label}</span>
                    <span className="mt-0.5 block text-[10.5px] text-muted">
                      {d.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
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
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-surface-0 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
