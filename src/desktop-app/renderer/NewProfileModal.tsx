import React, { useMemo, useState } from "react";

type Props = {
  open: boolean;
  cloneOptions: string[];
  onClose: () => void;
  onCreated: (profileId: string) => void;
};

const ID_HINT =
  "Lowercase letters, digits, hyphens, and underscores. Must start with a letter or digit.";

export function NewProfileModal({
  open,
  cloneOptions,
  onClose,
  onCreated,
}: Props) {
  const [id, setId] = useState("");
  const [cloneFrom, setCloneFrom] = useState(cloneOptions[0] ?? "default");
  const [soul, setSoul] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = useMemo(
    () => /^[a-z0-9][a-z0-9_-]*$/.test(id.trim()) && id.trim().length <= 64,
    [id],
  );

  if (!open) return null;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.electronAgent?.createProfile?.({
        id: id.trim(),
        cloneFrom,
        soul: soul.trim() || undefined,
      });
      if (!res?.ok || !res.profile) {
        setError(res?.error ?? "Failed to create profile");
        return;
      }
      onCreated(res.profile.id);
      setId("");
      setSoul("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">New profile</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Profiles are independent agent environments: separate config,
              skills, and SOUL.md.
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
            <div className="mb-1 text-[11px] font-medium text-fg-dim">Name</div>
            <input
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              placeholder="my-profile"
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-sm text-fg outline-none focus:border-accent/50"
            />
            <div className="mt-1 text-[10px] text-muted">{ID_HINT}</div>
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Clone from
            </div>
            <select
              value={cloneFrom}
              onChange={(e) => setCloneFrom(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-sm text-fg outline-none focus:border-accent/50"
            >
              {(cloneOptions.length ? cloneOptions : ["default"]).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <div className="mt-1 text-[10px] text-muted">
              Copies config, skills, and SOUL.md from the selected source
              profile.
            </div>
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              SOUL.md (optional)
            </div>
            <textarea
              value={soul}
              onChange={(e) => setSoul(e.target.value)}
              rows={5}
              placeholder="The system prompt / persona for this profile. Leave blank to keep the cloned default."
              className="w-full resize-y rounded-lg border border-border bg-surface-0 px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent/50"
            />
          </label>

          {error ? (
            <div className="rounded-md border border-danger/40 bg-[#2a1518] px-3 py-2 text-[11px] text-danger">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void submit()}
            className="rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
