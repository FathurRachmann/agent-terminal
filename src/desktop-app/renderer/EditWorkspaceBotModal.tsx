import React, { useEffect, useMemo, useState } from "react";
import { BotAvatar } from "./BotAvatar.js";

export type EditableWorkspaceBot = {
  id: string;
  name: string;
  role?: string;
  description: string;
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
  active?: boolean;
};

type SkillOption = { id: string; name: string };

type Props = {
  open: boolean;
  bot: EditableWorkspaceBot | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (draft: {
    name: string;
    role: string;
    description: string;
    tools: string;
    skills: string;
    systemPrompt: string;
  }) => void | Promise<void>;
};

function parseCsv(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function EditWorkspaceBotModal({
  open,
  bot,
  busy = false,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [tools, setTools] = useState("");
  const [skills, setSkills] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [skillCatalog, setSkillCatalog] = useState<SkillOption[]>([]);
  const [skillQuery, setSkillQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bot) return;
    setName(bot.name);
    setRole(bot.role ?? "");
    setDescription(bot.description ?? "");
    setTools((bot.tools || []).join(", "));
    setSkills((bot.skills || []).join(", "));
    setSystemPrompt(bot.systemPrompt ?? "");
    setSkillQuery("");
    setError(null);
  }, [open, bot]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.electronAgent?.listCapabilities?.();
        if (cancelled || !res || !Array.isArray(res.skills)) return;
        const opts: SkillOption[] = res.skills
          .map((s: { id?: string; name?: string }) => {
            const id = String(s.id || "")
              .replace(/^skill:/, "")
              .trim();
            const name = String(s.name || id).trim();
            return id ? { id, name } : null;
          })
          .filter((x: SkillOption | null): x is SkillOption => Boolean(x));
        setSkillCatalog(opts);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedSkills = useMemo(() => parseCsv(skills), [skills]);

  const filteredCatalog = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    const selected = new Set(selectedSkills.map((s) => s.toLowerCase()));
    return skillCatalog
      .filter((s) => !selected.has(s.id.toLowerCase()))
      .filter(
        (s) =>
          !q ||
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [skillCatalog, skillQuery, selectedSkills]);

  const toggleSkill = (id: string) => {
    const set = new Set(selectedSkills);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setSkills([...set].join(", "));
  };

  if (!open || !bot) return null;

  const submit = async () => {
    if (!name.trim() || busy) return;
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        role: role.trim(),
        description: description.trim(),
        tools,
        skills,
        systemPrompt,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface-1 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-bot-title"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <BotAvatar name={bot.name} id={bot.id} size={36} />
            <div className="min-w-0">
              <h2
                id="edit-bot-title"
                className="text-base font-semibold text-fg"
              >
                Edit member
              </h2>
              <p className="mt-0.5 truncate text-[12px] text-muted">@{bot.id}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
              autoFocus
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">Role</div>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Product Manager"
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Description
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Tools (comma-separated)
            </div>
            <input
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="read_file, web_search, ls"
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>

          <div>
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              Skills
            </div>
            <p className="mb-1.5 text-[10px] text-muted">
              Bot will read{" "}
              <code className="text-fg-dim">/skills/&lt;id&gt;/SKILL.md</code>{" "}
              when relevant.
            </p>
            {selectedSkills.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {selectedSkills.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSkill(id)}
                    className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] text-accent-soft hover:bg-red-500/15 hover:text-red-300"
                    title="Remove skill"
                  >
                    {id} ×
                  </button>
                ))}
              </div>
            ) : (
              <div className="mb-2 text-[10px] text-muted">No skills yet</div>
            )}
            <input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder="Search skills to add…"
              className="mb-1 w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
            {filteredCatalog.length > 0 ? (
              <ul className="max-h-28 overflow-y-auto rounded-lg border border-border bg-surface-0">
                {filteredCatalog.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        toggleSkill(s.id);
                        setSkillQuery("");
                      }}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-surface-2"
                    >
                      <span className="text-fg">{s.name}</span>
                      <span className="text-[9px] text-muted">{s.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : skillQuery.trim() ? (
              <button
                type="button"
                onClick={() => {
                  const id = skillQuery.trim();
                  if (!id) return;
                  toggleSkill(id);
                  setSkillQuery("");
                }}
                className="mt-1 text-[10px] text-accent hover:underline"
              >
                Add “{skillQuery.trim()}” as custom skill id
              </button>
            ) : null}
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="or type ids: frontend-patterns, code-review"
              className="mt-2 w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-fg outline-none focus:border-accent"
            />
          </div>

          <label className="block">
            <div className="mb-1 text-[11px] font-medium text-fg-dim">
              System prompt
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
            />
          </label>
          {error ? (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
