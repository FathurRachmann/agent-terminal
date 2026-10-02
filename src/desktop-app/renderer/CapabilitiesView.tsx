import React, { useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody.js";

export type CapabilityKind = "skills" | "tools" | "mcp";

export type CapabilityItem = {
  id: string;
  kind: CapabilityKind;
  name: string;
  category: string;
  description: string;
  badge?: string;
  enabled: boolean;
  detailMarkdown: string;
  authStatus?: "none" | "required" | "connected" | "expired";
  authMode?: "none" | "oauth" | "bearer" | "env";
  authEnvKeys?: string[];
  canOAuth?: boolean;
  canBearer?: boolean;
  canEnv?: boolean;
};

type CapsPayload = {
  skills: CapabilityItem[];
  tools: CapabilityItem[];
  mcp: CapabilityItem[];
  counts: { skills: number; tools: number; mcp: number };
};

type Props = {
  onClose?: () => void;
};

function applyCapsResult(
  res: CapsPayload & {
    ok?: boolean;
    error?: string;
    reloaded?: boolean;
    reloadReason?: string;
  },
  counts: CapsPayload["counts"],
): CapsPayload | null {
  if (!res.skills) return null;
  return {
    skills: res.skills,
    tools: res.tools ?? [],
    mcp: res.mcp ?? [],
    counts: res.counts ?? counts,
  };
}

export function CapabilitiesView({ onClose }: Props) {
  const [tab, setTab] = useState<CapabilityKind>("skills");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "category">("name");
  const [data, setData] = useState<CapsPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [bearerDraft, setBearerDraft] = useState("");
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const [authBusy, setAuthBusy] = useState(false);
  const [showBearer, setShowBearer] = useState(false);

  const refresh = async () => {
    if (!window.electronAgent?.listCapabilities) {
      setError("Capabilities bridge missing. Run npm run desktop:start.");
      return;
    }
    try {
      const res = await window.electronAgent.listCapabilities();
      setData(res);
      setError(null);
      setSelectedId((prev) => {
        if (prev) return prev;
        const first = res.skills[0] ?? res.tools[0] ?? res.mcp[0];
        return first?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const list =
      tab === "skills" ? data.skills : tab === "tools" ? data.tools : data.mcp;
    const q = query.trim().toLowerCase();
    let filtered = list;
    if (q) {
      filtered = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q) ||
          (i.badge ?? "").toLowerCase().includes(q),
      );
    }
    return [...filtered].sort((a, b) => {
      if (sort === "category") {
        const c = a.category.localeCompare(b.category);
        return c !== 0 ? c : a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [data, tab, query, sort]);

  const selected = useMemo(() => {
    if (!data || !selectedId) return null;
    return (
      [...data.skills, ...data.tools, ...data.mcp].find(
        (i) => i.id === selectedId,
      ) ?? null
    );
  }, [data, selectedId]);

  useEffect(() => {
    if (!selected || selected.kind !== "mcp") {
      setEnvDraft({});
      setBearerDraft("");
      setShowBearer(false);
      return;
    }
    const keys = selected.authEnvKeys ?? [];
    const next: Record<string, string> = {};
    for (const k of keys) next[k] = "";
    setEnvDraft(next);
    setBearerDraft("");
    setShowBearer(false);
  }, [selected?.id]);

  const counts = data?.counts ?? { skills: 0, tools: 0, mcp: 0 };

  const noteReload = (res: {
    reloaded?: boolean;
    reloadReason?: string;
  }) => {
    if (res.reloaded) {
      setStatusNote("Agent reloaded — MCP auth active now.");
    } else if (res.reloadReason) {
      setStatusNote(res.reloadReason);
    } else {
      setStatusNote("Credentials saved.");
    }
  };

  const toggle = async (item: CapabilityItem) => {
    if (!window.electronAgent?.setCapabilityEnabled) return;
    setBusyId(item.id);
    try {
      const res = await window.electronAgent.setCapabilityEnabled(
        item.id,
        !item.enabled,
      );
      if (res.ok && res.skills) {
        const next = applyCapsResult(res as CapsPayload, counts);
        if (next) setData(next);
        if (res.reloaded) {
          setStatusNote("Agent reloaded — filter active now.");
        } else if (res.reloadReason) {
          setStatusNote(res.reloadReason);
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const runAuth = async (
    action: () => Promise<{
      ok: boolean;
      error?: string;
      skills?: CapabilityItem[];
      tools?: CapabilityItem[];
      mcp?: CapabilityItem[];
      counts?: CapsPayload["counts"];
      reloaded?: boolean;
      reloadReason?: string;
    }>,
  ) => {
    setAuthBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error || "MCP auth failed");
        return;
      }
      const next = applyCapsResult(res as CapsPayload, counts);
      if (next) setData(next);
      noteReload(res);
      setShowBearer(false);
      setBearerDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const badgeClass = (badge?: string) => {
    if (badge === "connected") {
      return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
    }
    if (badge === "needs login" || badge === "expired") {
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    }
    if (badge === "learned") {
      return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
    }
    return "bg-accent/15 text-accent-soft";
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r border-border">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <div className="text-[11px] font-semibold text-fg">Capabilities</div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[9.5px] text-fg-dim hover:text-fg"
            >
              Back to chat
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted">
              ⌕
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Try "github" or "execute"'
              className="w-full rounded-lg border border-border bg-surface-2 py-2 pr-3 pl-8 text-[11px] text-fg outline-none placeholder:text-muted focus:border-accent/50"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "name" | "category")}
            className="rounded-lg border border-border bg-surface-2 px-2 py-2 text-[10.5px] text-fg-dim outline-none"
          >
            <option value="name">↓ Name</option>
            <option value="category">↓ Category</option>
          </select>
        </div>

        <div className="flex gap-4 border-b border-border px-4">
          {(
            [
              ["skills", "Skills", counts.skills],
              ["tools", "Tools", counts.tools],
              ["mcp", "MCP", counts.mcp],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setSelectedId(null);
              }}
              className={`border-b-2 py-2.5 text-[11px] font-medium ${
                tab === key
                  ? "border-accent text-white"
                  : "border-transparent text-muted hover:text-fg-dim"
              }`}
            >
              {label}{" "}
              <span className={tab === key ? "text-fg-dim" : "text-muted"}>
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-2 text-[10.5px] text-danger">
              {error}
            </div>
          )}
          {!error && items.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-muted">
              {tab === "mcp"
                ? "No MCP servers configured. Add `.agent/mcp.json` with an `mcpServers` map."
                : "Nothing matched."}
            </div>
          )}
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition ${
                  active ? "bg-surface-3" : "hover:bg-surface-2/80"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[12px] font-semibold text-fg">
                      {item.name}
                    </span>
                    {item.badge && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase ${badgeClass(item.badge)}`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] text-muted">
                    {item.category}
                    <span className="text-border-strong"> · </span>
                    {item.description}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  aria-label={item.enabled ? "Disable" : "Enable"}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggle(item);
                  }}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    item.enabled ? "bg-accent" : "bg-border-strong"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition ${
                      item.enabled ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="flex w-[360px] shrink-0 flex-col bg-surface-1">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <MarkdownBody text={selected.detailMarkdown} />
              </div>

              {selected.kind === "mcp" && selected.authStatus !== "none" && (
                <div className="rounded-xl border border-border bg-surface-2 p-4">
                  <div className="text-[11px] font-semibold text-fg">
                    MCP login
                  </div>
                  <p className="mt-1 text-[10.5px] text-muted">
                    Status:{" "}
                    <span className="text-fg-dim">{selected.authStatus}</span>
                    {selected.authMode ? ` · ${selected.authMode}` : ""}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.canOAuth && (
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() =>
                          void runAuth(() =>
                            window.electronAgent!.mcpConnectOAuth!(
                              selected.name,
                            ),
                          )
                        }
                        className="rounded-md border border-accent/40 bg-accent/20 px-2.5 py-1.5 text-[10.5px] font-medium text-accent-soft hover:bg-accent/30 disabled:opacity-50"
                      >
                        {authBusy ? "Waiting…" : "Connect (OAuth)"}
                      </button>
                    )}
                    {selected.canBearer && (
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() => setShowBearer((v) => !v)}
                        className="rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-[10.5px] text-fg-dim hover:text-fg disabled:opacity-50"
                      >
                        Paste token
                      </button>
                    )}
                    {selected.authStatus === "connected" && (
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() =>
                          void runAuth(() =>
                            window.electronAgent!.mcpDisconnect!(selected.name),
                          )
                        }
                        className="rounded-md border border-danger/30 bg-[#2a1518] px-2.5 py-1.5 text-[10.5px] text-danger hover:border-danger/50 disabled:opacity-50"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>

                  {showBearer && selected.canBearer && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="password"
                        value={bearerDraft}
                        onChange={(e) => setBearerDraft(e.target.value)}
                        placeholder="Bearer / access token"
                        className="w-full rounded-lg border border-border bg-surface-3 px-3 py-2 text-[11px] text-fg outline-none focus:border-accent/50"
                      />
                      <button
                        type="button"
                        disabled={authBusy || !bearerDraft.trim()}
                        onClick={() =>
                          void runAuth(() =>
                            window.electronAgent!.mcpSaveBearer!(
                              selected.name,
                              bearerDraft,
                            ),
                          )
                        }
                        className="rounded-md border border-accent/40 bg-accent/20 px-2.5 py-1.5 text-[10.5px] font-medium text-accent-soft disabled:opacity-50"
                      >
                        Save token
                      </button>
                    </div>
                  )}

                  {selected.canEnv && (
                    <div className="mt-3 space-y-2">
                      {(selected.authEnvKeys?.length
                        ? selected.authEnvKeys
                        : Object.keys(envDraft)
                      ).map((key) => (
                        <label key={key} className="block">
                          <span className="text-[10px] text-muted">{key}</span>
                          <input
                            type="password"
                            value={envDraft[key] ?? ""}
                            onChange={(e) =>
                              setEnvDraft((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                            className="mt-0.5 w-full rounded-lg border border-border bg-surface-3 px-3 py-2 text-[11px] text-fg outline-none focus:border-accent/50"
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        disabled={
                          authBusy ||
                          !(selected.authEnvKeys ?? []).every((k) =>
                            (envDraft[k] ?? "").trim(),
                          )
                        }
                        onClick={() =>
                          void runAuth(() =>
                            window.electronAgent!.mcpSaveEnv!(
                              selected.name,
                              envDraft,
                            ),
                          )
                        }
                        className="rounded-md border border-accent/40 bg-accent/20 px-2.5 py-1.5 text-[10.5px] font-medium text-accent-soft disabled:opacity-50"
                      >
                        Save env credentials
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selected.kind === "mcp" && selected.authStatus === "none" && (
                <div className="rounded-xl border border-dashed border-border bg-surface-2/60 px-3 py-2 text-[10.5px] text-muted">
                  This MCP server does not require login.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/50 px-4 py-10 text-center text-[11px] text-muted">
              Select a capability to inspect details.
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 text-right text-[9.5px] text-muted">
          {statusNote ??
            "Toggles save to `.agent/capabilities-prefs.json`. MCP login tokens are encrypted in `.agent/mcp-auth.enc`."}
        </div>
      </aside>
    </div>
  );
}
