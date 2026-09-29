import React, { useEffect, useMemo, useState } from "react";

type BotDraft = {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
};

type SettingsSnapshot = {
  model: {
    agentModel: string;
    routerBaseUrl: string;
    routerApiKeyConfigured: boolean;
    routerApiKeyMasked: string;
    embeddingModel: string;
    visionModel: string;
    contextWindowTokens: number;
  };
  agent: {
    autoApproveDestructive: boolean;
    runMode?: "auto-review" | "allowlist" | "run-everything";
    toolAllowlist?: string[];
    requirePlanApproval: boolean;
    enableReflection: boolean;
    enableCheckpointer: boolean;
    autoSelfHeal?: boolean;
    selfHealErrorThreshold?: number;
    agentKind?: "general" | "research" | "ops";
  };
  sandbox: {
    ptyTimeoutMs: number;
    ptyPoolSize: number;
    ptyShell: string;
    allowedFolders: string[];
  };
  desktop: {
    enabled: boolean;
    apps: string[];
  };
  memory: {
    enableReflection: boolean;
    agentsMd: string;
    agentsMdPath: string;
  };
  ui: {
    defaultRailOpen: boolean;
    defaultRailLayer: "canvas" | "files" | "trace";
    compactActivity: boolean;
    showFooterPhase?: boolean;
    showLearnedInFooter?: boolean;
    openChatPathsInCanvas?: boolean;
    preferStreamedAnswer?: boolean;
  };
  bots: BotDraft[];
  toolCatalog: Array<{ name: string; category: string; description: string }>;
  paths: Record<string, string>;
  reloadRequiredHint: string;
};

type SettingsGroup =
  | "model"
  | "agent"
  | "bots"
  | "desktop"
  | "sandbox"
  | "memory"
  | "ui"
  | "paths"
  | "gateways";

const GROUPS: Array<{ id: SettingsGroup; label: string; blurb: string }> = [
  { id: "model", label: "Model & API", blurb: "Gateway, model, embeddings" },
  { id: "agent", label: "Agent Behavior", blurb: "Approvals, reflection, checkpoints" },
  { id: "bots", label: "Bots", blurb: "Specialized sessions & tool scopes" },
  { id: "gateways", label: "Gateways", blurb: "Local runtime connection" },
  { id: "desktop", label: "Desktop", blurb: "macOS automation allowlist" },
  { id: "sandbox", label: "Sandbox & PTY", blurb: "Shell pool, timeouts, folders" },
  { id: "memory", label: "Memory", blurb: "AGENTS.md, reflection & chat context" },
  { id: "ui", label: "Interface", blurb: "Footer, chat paths, activity rail" },
  { id: "paths", label: "Paths & Files", blurb: "Where config lives on disk" },
];

type Props = {
  onClose?: () => void;
  onOpenCapabilities?: () => void;
  onUiSettingsSaved?: (ui: SettingsSnapshot["ui"]) => void;
  initialGroup?: SettingsGroup;
};

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-1.5">
      <div className="text-[11px] font-medium text-fg">{children}</div>
      {hint ? <div className="mt-0.5 text-[9.5px] text-muted">{hint}</div> : null}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] text-fg outline-none focus:border-accent/50 ${
        mono ? "font-mono text-[11px]" : ""
      }`}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition hover:border-accent/30"
    >
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-fg">{label}</div>
        {hint ? <div className="mt-0.5 text-[9.5px] text-muted">{hint}</div> : null}
      </div>
      <span
        className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition ${
          checked
            ? "border-accent/50 bg-accent/30"
            : "border-border bg-surface-1"
        }`}
      >
        <span
          className={`h-3.5 w-3.5 rounded-full bg-fg transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-2/60 p-4">
      <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-accent-soft uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function SettingsView({
  onClose,
  onOpenCapabilities,
  onUiSettingsSaved,
  initialGroup,
}: Props) {
  const [group, setGroup] = useState<SettingsGroup>(initialGroup ?? "model");
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [appsText, setAppsText] = useState("");
  const [bots, setBots] = useState<BotDraft[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [agentsMd, setAgentsMd] = useState("");
  const [gatewayTest, setGatewayTest] = useState<string | null>(null);
  const [encryptSecrets] = useState(false);

  useEffect(() => {
    if (initialGroup) setGroup(initialGroup);
  }, [initialGroup]);

  // Draft fields
  const [agentModel, setAgentModel] = useState("");
  const [routerBaseUrl, setRouterBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [contextWindowTokens, setContextWindowTokens] = useState(256000);
  const [runMode, setRunMode] = useState<
    "auto-review" | "allowlist" | "run-everything"
  >("auto-review");
  const [toolAllowlistText, setToolAllowlistText] = useState("");
  const [requirePlan, setRequirePlan] = useState(true);
  const [permTerminal, setPermTerminal] = useState("");
  const [permMcp, setPermMcp] = useState("");
  const [permAllowHints, setPermAllowHints] = useState("");
  const [permBlockHints, setPermBlockHints] = useState("");
  const [permTeamOverride, setPermTeamOverride] = useState(false);
  const [permTeamEnabled, setPermTeamEnabled] = useState(false);
  const [permNote, setPermNote] = useState<string | null>(null);
  const [agentKind, setAgentKind] = useState<"general" | "research" | "ops">(
    "general",
  );
  const [enableReflection, setEnableReflection] = useState(true);
  const [enableCheckpointer, setEnableCheckpointer] = useState(true);
  const [autoSelfHeal, setAutoSelfHeal] = useState(true);
  const [selfHealErrorThreshold, setSelfHealErrorThreshold] = useState(2);
  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [ptyTimeoutMs, setPtyTimeoutMs] = useState(60000);
  const [ptyPoolSize, setPtyPoolSize] = useState(3);
  const [ptyShell, setPtyShell] = useState("");
  const [defaultRailOpen, setDefaultRailOpen] = useState(true);
  const [defaultRailLayer, setDefaultRailLayer] = useState<"canvas" | "files">(
    "canvas",
  );
  const [compactActivity, setCompactActivity] = useState(false);
  const [showFooterPhase, setShowFooterPhase] = useState(true);
  const [showLearnedInFooter, setShowLearnedInFooter] = useState(true);
  const [openChatPathsInCanvas, setOpenChatPathsInCanvas] = useState(true);
  const [preferStreamedAnswer, setPreferStreamedAnswer] = useState(true);

  const hydrate = (s: SettingsSnapshot) => {
    setSnap(s);
    setAgentModel(s.model.agentModel);
    setRouterBaseUrl(s.model.routerBaseUrl);
    setEmbeddingModel(s.model.embeddingModel);
    setVisionModel(s.model.visionModel);
    setContextWindowTokens(s.model.contextWindowTokens);
    setApiKeyDraft("");
    setRunMode(
      s.agent.runMode === "allowlist" || s.agent.runMode === "run-everything"
        ? s.agent.runMode
        : s.agent.autoApproveDestructive
          ? "run-everything"
          : "auto-review",
    );
    setToolAllowlistText((s.agent.toolAllowlist ?? []).join("\n"));
    setRequirePlan(s.agent.requirePlanApproval);
    setAgentKind(
      s.agent.agentKind === "research" || s.agent.agentKind === "ops"
        ? s.agent.agentKind
        : "general",
    );
    setEnableReflection(s.agent.enableReflection);
    setEnableCheckpointer(s.agent.enableCheckpointer);
    setAutoSelfHeal(s.agent.autoSelfHeal ?? true);
    setSelfHealErrorThreshold(s.agent.selfHealErrorThreshold ?? 2);
    setDesktopEnabled(s.desktop.enabled);
    setAppsText(s.desktop.apps.join("\n"));
    setPtyTimeoutMs(s.sandbox.ptyTimeoutMs);
    setPtyPoolSize(s.sandbox.ptyPoolSize);
    setPtyShell(s.sandbox.ptyShell);
    setBots(s.bots.map((b) => ({ ...b, tools: [...(b.tools ?? [])] })));
    setSelectedBotId((prev) => prev ?? s.bots.find((b) => b.id !== "general")?.id ?? s.bots[0]?.id ?? null);
    setAgentsMd(s.memory.agentsMd);
    setDefaultRailOpen(s.ui.defaultRailOpen);
    setDefaultRailLayer(
      s.ui.defaultRailLayer === "files" ? "files" : "canvas",
    );
    setCompactActivity(s.ui.compactActivity);
    setShowFooterPhase(s.ui.showFooterPhase !== false);
    setShowLearnedInFooter(s.ui.showLearnedInFooter !== false);
    setOpenChatPathsInCanvas(s.ui.openChatPathsInCanvas !== false);
    setPreferStreamedAnswer(s.ui.preferStreamedAnswer !== false);
  };

  const refresh = async () => {
    if (!window.electronAgent?.getSettings) {
      setError("Settings bridge missing. Rebuild desktop app.");
      return;
    }
    try {
      const res = await window.electronAgent.getSettings();
      hydrate(res);
      setError(null);
      const permsApi = (
        window as unknown as {
          electronAgent?: {
            getPermissions?: () => Promise<{
              ok: boolean;
              merged?: {
                terminalAllowlist: string[];
                mcpAllowlist: string[];
                allowInstructions: string[];
                blockInstructions: string[];
                teamOverride: boolean;
              };
              project?: {
                terminalAllowlist?: string[];
                mcpAllowlist?: string[];
                autoRun?: {
                  allow_instructions?: string[];
                  block_instructions?: string[];
                };
              } | null;
              team?: Record<string, unknown> | null;
            }>;
          };
        }
      ).electronAgent;
      if (permsApi?.getPermissions) {
        const p = await permsApi.getPermissions();
        if (p?.ok) {
          const src = p.project ?? {};
          setPermTerminal((src.terminalAllowlist ?? p.merged?.terminalAllowlist ?? []).join("\n"));
          setPermMcp((src.mcpAllowlist ?? p.merged?.mcpAllowlist ?? []).join("\n"));
          setPermAllowHints(
            (src.autoRun?.allow_instructions ?? p.merged?.allowInstructions ?? []).join("\n"),
          );
          setPermBlockHints(
            (src.autoRun?.block_instructions ?? p.merged?.blockInstructions ?? []).join("\n"),
          );
          setPermTeamOverride(Boolean(p.merged?.teamOverride));
          setPermTeamEnabled(Boolean(p.team));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const savePermissions = async () => {
    const api = (
      window as unknown as {
        electronAgent?: {
          updatePermissions?: (payload: unknown) => Promise<{ ok: boolean }>;
        };
      }
    ).electronAgent;
    if (!api?.updatePermissions) {
      setPermNote("Permissions bridge missing — rebuild desktop.");
      return;
    }
    const data = {
      terminalAllowlist: permTerminal.split("\n").map((l) => l.trim()).filter(Boolean),
      mcpAllowlist: permMcp.split("\n").map((l) => l.trim()).filter(Boolean),
      autoRun: {
        allow_instructions: permAllowHints.split("\n").map((l) => l.trim()).filter(Boolean),
        block_instructions: permBlockHints.split("\n").map((l) => l.trim()).filter(Boolean),
      },
    };
    await api.updatePermissions({ scope: "project", data });
    if (permTeamEnabled) {
      await api.updatePermissions({ scope: "team", data });
    } else {
      await api.updatePermissions({ scope: "team", data: null });
    }
    setPermNote("permissions.json saved");
    await refresh();
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) ?? null,
    [bots, selectedBotId],
  );

  const toolsByCategory = useMemo(() => {
    const map = new Map<
      string,
      Array<{ name: string; category: string; description: string }>
    >();
    for (const t of snap?.toolCatalog ?? []) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()];
  }, [snap]);

  const updateSelectedBot = (patch: Partial<BotDraft>) => {
    if (!selectedBotId) return;
    setBots((prev) =>
      prev.map((b) => (b.id === selectedBotId ? { ...b, ...patch } : b)),
    );
  };

  const toggleBotTool = (toolName: string) => {
    if (!selectedBot || selectedBot.id === "general") return;
    const current = new Set(selectedBot.tools ?? []);
    if (current.has(toolName)) current.delete(toolName);
    else current.add(toolName);
    updateSelectedBot({ tools: [...current] });
  };

  const addBot = () => {
    const id = `bot-${Date.now().toString(36)}`;
    const next: BotDraft = {
      id,
      name: "New Bot",
      description: "Describe this bot specialty",
      systemPrompt: "You are a specialized assistant. Stay within scope.",
      tools: ["read_file", "write_file"],
    };
    setBots((prev) => [...prev, next]);
    setSelectedBotId(id);
  };

  const removeSelectedBot = () => {
    if (!selectedBot || selectedBot.id === "general") return;
    setBots((prev) => prev.filter((b) => b.id !== selectedBot.id));
    setSelectedBotId("general");
  };

  const save = async () => {
    if (!window.electronAgent?.updateSettings) return;
    setSaving(true);
    setNote(null);
    setError(null);
    try {
      const modelPatch: Record<string, unknown> = {
        agentModel,
        routerBaseUrl,
        embeddingModel,
        visionModel,
        contextWindowTokens,
      };
      if (apiKeyDraft.trim()) {
        modelPatch.routerApiKey = apiKeyDraft.trim();
      }

      const payload = {
        model: modelPatch,
        agent: {
          runMode,
          toolAllowlist: toolAllowlistText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
          autoApproveDestructive: runMode === "run-everything",
          requirePlanApproval: requirePlan,
          enableReflection,
          enableCheckpointer,
          autoSelfHeal,
          selfHealErrorThreshold,
          agentKind,
        },
        sandbox: {
          ptyTimeoutMs,
          ptyPoolSize,
          ptyShell,
        },
        desktop: {
          enabled: desktopEnabled,
          apps: appsText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        },
        memory: {
          enableReflection,
          agentsMd,
        },
        ui: {
          defaultRailOpen,
          defaultRailLayer,
          compactActivity,
          showFooterPhase,
          showLearnedInFooter,
          openChatPathsInCanvas,
          preferStreamedAnswer,
        },
        bots,
      };

      const res = await window.electronAgent.updateSettings(payload);
      if (!res.ok) {
        setError(res.error ?? "Failed to save settings");
        return;
      }
      if (res.snapshot) {
        const snapUi = res.snapshot as SettingsSnapshot;
        hydrate(snapUi);
        onUiSettingsSaved?.(snapUi.ui);
      } else {
        onUiSettingsSaved?.({
          defaultRailOpen,
          defaultRailLayer,
          compactActivity,
          showFooterPhase,
          showLearnedInFooter,
          openChatPathsInCanvas,
          preferStreamedAnswer,
        });
      }
      setApiKeyDraft("");
      if (res.reloaded) setNote("Saved — agent reloaded with new settings.");
      else if (res.reloadReason) setNote(`Saved. ${res.reloadReason}`);
      else setNote("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-0">
      <header className="app-drag flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-fg">Settings</div>
          <div className="text-[9.5px] text-muted">
            Konfigurasi agent, bots, sandbox, dan memory
          </div>
        </div>
        <div className="app-no-drag flex items-center gap-2">
          {onOpenCapabilities ? (
            <button
              type="button"
              onClick={onOpenCapabilities}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[9.5px] text-fg-dim hover:border-accent/40 hover:text-fg"
            >
              Capabilities
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-accent px-3 py-1 text-[10px] font-semibold text-surface-0 hover:brightness-110 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[9.5px] text-fg-dim hover:text-fg"
            >
              Close
            </button>
          ) : null}
        </div>
      </header>

      {(error || note) && (
        <div
          className={`shrink-0 border-b px-4 py-2 text-[11px] ${
            error
              ? "border-danger/30 bg-[#2a1518] text-[#ffb4b0]"
              : "border-accent/20 bg-accent/10 text-accent-soft"
          }`}
        >
          {error ?? note}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface-1 p-3">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={`rounded-lg px-3 py-2.5 text-left transition ${
                group === g.id
                  ? "bg-accent/15 text-accent-soft"
                  : "text-fg-dim hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <div className="text-[11px] font-medium">{g.label}</div>
              <div className="mt-0.5 text-[9px] text-muted">{g.blurb}</div>
            </button>
          ))}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!snap ? (
            <div className="text-[12px] text-muted">Loading settings…</div>
          ) : group === "model" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="Model gateway">
                <div>
                  <FieldLabel hint="OpenAI-compatible base URL (9router, etc.)">
                    Router base URL
                  </FieldLabel>
                  <TextInput
                    mono
                    value={routerBaseUrl}
                    onChange={setRouterBaseUrl}
                    placeholder="https://api.9router.com/v1"
                  />
                </div>
                <div>
                  <FieldLabel
                    hint={
                      snap.model.routerApiKeyConfigured
                        ? `Configured: ${snap.model.routerApiKeyMasked}`
                        : "Belum ada API key"
                    }
                  >
                    Router API key
                  </FieldLabel>
                  <TextInput
                    mono
                    type="password"
                    value={apiKeyDraft}
                    onChange={setApiKeyDraft}
                    placeholder="Paste new key to rotate (leave blank to keep)"
                  />
                </div>
                <div>
                  <FieldLabel hint="Prefer model dengan context ≥256k">
                    Agent model
                  </FieldLabel>
                  <TextInput mono value={agentModel} onChange={setAgentModel} />
                </div>
              </SectionCard>
              <SectionCard title="Embeddings & vision">
                <div>
                  <FieldLabel hint="Untuk long-term memory semantic search">
                    Embedding model
                  </FieldLabel>
                  <TextInput
                    mono
                    value={embeddingModel}
                    onChange={setEmbeddingModel}
                  />
                </div>
                <div>
                  <FieldLabel hint="vision_analyze tool">Vision model</FieldLabel>
                  <TextInput mono value={visionModel} onChange={setVisionModel} />
                </div>
                <div>
                  <FieldLabel hint="Budget token sebelum auto-summarize">
                    Context window (tokens)
                  </FieldLabel>
                  <NumberInput
                    value={contextWindowTokens}
                    onChange={setContextWindowTokens}
                    min={8000}
                    step={1000}
                  />
                </div>
              </SectionCard>
            </div>
          ) : group === "agent" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="Top-level agent (3 presets)">
                <div>
                  <FieldLabel hint="Sama tools; beda posture. Reload agent setelah ganti.">
                    Active agent
                  </FieldLabel>
                  <select
                    className="mt-1 w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg"
                    value={agentKind}
                    onChange={(e) =>
                      setAgentKind(
                        e.target.value === "research" || e.target.value === "ops"
                          ? e.target.value
                          : "general",
                      )
                    }
                  >
                    <option value="general">General / Coding</option>
                    <option value="research">Research</option>
                    <option value="ops">Ops / Desktop</option>
                  </select>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Subagents via task: explorer, coder, reviewer, tester,
                    security, debugger, docs, architect (8).
                  </p>
                </div>
              </SectionCard>
              <SectionCard title="Safety & approvals (Run Modes)">
                <div>
                  <FieldLabel hint="Cursor-style: Auto-review (classifier), Allowlist, or Run Everything">
                    Run Mode
                  </FieldLabel>
                  <select
                    className="mt-1 w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[13px] text-fg"
                    value={runMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      const mode =
                        v === "allowlist" || v === "run-everything"
                          ? v
                          : "auto-review";
                      setRunMode(mode);
                    }}
                  >
                    <option value="auto-review">
                      Auto-review (allowlist + classifier)
                    </option>
                    <option value="allowlist">Allowlist only</option>
                    <option value="run-everything">Run Everything</option>
                  </select>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Workspace edits auto-apply (except config/secrets). Shell,
                    MCP, and desktop follow this mode. Folder grants always need
                    Approve.
                  </p>
                </div>
                <div>
                  <FieldLabel hint="One per line: tool name (execute) or shell prefix (git status)">
                    Tool / command allowlist
                  </FieldLabel>
                  <textarea
                    className="mt-1 min-h-[88px] w-full rounded-md border border-border bg-surface-0 px-3 py-2 font-mono text-[12px] text-fg"
                    value={toolAllowlistText}
                    onChange={(e) => setToolAllowlistText(e.target.value)}
                    placeholder={"git status\nnpm test\nexecute"}
                  />
                </div>
                <Toggle
                  checked={requirePlan}
                  onChange={setRequirePlan}
                  label="Require plan approval"
                  hint="Interrupt on task_todos until user Approves (Build)."
                />
              </SectionCard>
              <SectionCard title="permissions.json (Auto-review dashboard)">
                <p className="text-[11px] text-muted">
                  Cursor-style steering for Auto-review. Writes{" "}
                  <code className="font-mono text-[10px]">.agent/permissions.json</code>
                  . Enable team override to write{" "}
                  <code className="font-mono text-[10px]">team-permissions.json</code>{" "}
                  (overrides local).
                  {permTeamOverride ? (
                    <span className="ml-1 text-amber-400">
                      Team override active.
                    </span>
                  ) : null}
                </p>
                <div>
                  <FieldLabel hint="Shell prefixes / tool names (merged into allowlist)">
                    terminalAllowlist
                  </FieldLabel>
                  <textarea
                    className="mt-1 min-h-[64px] w-full rounded-md border border-border bg-surface-0 px-3 py-2 font-mono text-[12px] text-fg"
                    value={permTerminal}
                    onChange={(e) => setPermTerminal(e.target.value)}
                    placeholder={"git status\nnpm test"}
                  />
                </div>
                <div>
                  <FieldLabel hint="server:tool · server:* · *:*">
                    mcpAllowlist
                  </FieldLabel>
                  <textarea
                    className="mt-1 min-h-[48px] w-full rounded-md border border-border bg-surface-0 px-3 py-2 font-mono text-[12px] text-fg"
                    value={permMcp}
                    onChange={(e) => setPermMcp(e.target.value)}
                    placeholder={"tradingview:*\n*:*"}
                  />
                </div>
                <div>
                  <FieldLabel hint="Plain-English hints that steer Auto-review toward allow">
                    autoRun.allow_instructions
                  </FieldLabel>
                  <textarea
                    className="mt-1 min-h-[48px] w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[12px] text-fg"
                    value={permAllowHints}
                    onChange={(e) => setPermAllowHints(e.target.value)}
                    placeholder="Allow routine npm test and git status"
                  />
                </div>
                <div>
                  <FieldLabel hint="Plain-English hints that steer Auto-review toward ask/deny">
                    autoRun.block_instructions
                  </FieldLabel>
                  <textarea
                    className="mt-1 min-h-[48px] w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-[12px] text-fg"
                    value={permBlockHints}
                    onChange={(e) => setPermBlockHints(e.target.value)}
                    placeholder="Always ask before rm -rf or curl | sh"
                  />
                </div>
                <Toggle
                  checked={permTeamEnabled}
                  onChange={setPermTeamEnabled}
                  label="Team dashboard override"
                  hint="When on, saves team-permissions.json and ignores user/project files for Auto-review."
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
                    onClick={() => void savePermissions()}
                  >
                    Save permissions.json
                  </button>
                  {permNote ? (
                    <span className="text-[11px] text-muted">{permNote}</span>
                  ) : null}
                </div>
              </SectionCard>
              <SectionCard title="Self-heal">
                <Toggle
                  checked={autoSelfHeal}
                  onChange={setAutoSelfHeal}
                  label="Auto self-heal on repeated turn errors"
                  hint="Setelah N error identik, jalankan repair agent (atau ketik /self-heal)."
                />
                <div>
                  <FieldLabel hint="Jumlah error identik sebelum auto self-heal">
                    Error threshold
                  </FieldLabel>
                  <NumberInput
                    value={selfHealErrorThreshold}
                    onChange={setSelfHealErrorThreshold}
                    min={1}
                    step={1}
                  />
                </div>
              </SectionCard>
              <SectionCard title="Persistence">
                <Toggle
                  checked={enableReflection}
                  onChange={setEnableReflection}
                  label="Auto-reflection after turns"
                  hint="Simpan episode / rule ke long-term memory setelah tiap turn."
                />
                <Toggle
                  checked={enableCheckpointer}
                  onChange={setEnableCheckpointer}
                  label="LangGraph checkpointer"
                  hint="Persist graph state ke SQLite agar thread bisa di-resume."
                />
              </SectionCard>
              <p className="text-[10px] text-muted">{snap.reloadRequiredHint}</p>
            </div>
          ) : group === "bots" ? (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              <div className="flex gap-4">
                <div className="w-[220px] shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
                      Bots
                    </span>
                    <button
                      type="button"
                      onClick={addBot}
                      className="text-[10px] text-accent hover:underline"
                    >
                      + Add
                    </button>
                  </div>
                  {bots.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBotId(b.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                        b.id === selectedBotId
                          ? "border-accent/40 bg-surface-3"
                          : "border-transparent hover:bg-surface-2"
                      }`}
                    >
                      <div className="text-[11px] font-medium text-fg">{b.name}</div>
                      <div className="truncate text-[9px] text-muted">{b.id}</div>
                    </button>
                  ))}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {selectedBot ? (
                    <>
                      <SectionCard title="Bot profile">
                        <div>
                          <FieldLabel>ID</FieldLabel>
                          <TextInput
                            mono
                            value={selectedBot.id}
                            onChange={(id) =>
                              selectedBot.id === "general"
                                ? undefined
                                : updateSelectedBot({
                                    id: id.replace(/[^a-zA-Z0-9._-]/g, "-"),
                                  })
                            }
                          />
                        </div>
                        <div>
                          <FieldLabel>Name</FieldLabel>
                          <TextInput
                            value={selectedBot.name}
                            onChange={(name) => updateSelectedBot({ name })}
                          />
                        </div>
                        <div>
                          <FieldLabel>Description</FieldLabel>
                          <TextInput
                            value={selectedBot.description}
                            onChange={(description) =>
                              updateSelectedBot({ description })
                            }
                          />
                        </div>
                        <div>
                          <FieldLabel hint="Injected only in this bot's sessions">
                            System prompt
                          </FieldLabel>
                          <textarea
                            value={selectedBot.systemPrompt ?? ""}
                            disabled={selectedBot.id === "general"}
                            onChange={(e) =>
                              updateSelectedBot({ systemPrompt: e.target.value })
                            }
                            rows={5}
                            className="w-full resize-y rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] text-fg outline-none focus:border-accent/50 disabled:opacity-50"
                          />
                        </div>
                        {selectedBot.id !== "general" ? (
                          <button
                            type="button"
                            onClick={removeSelectedBot}
                            className="self-start rounded-md border border-danger/40 px-2.5 py-1 text-[10px] text-[#ffb4b0] hover:bg-[#2a1518]"
                          >
                            Delete bot
                          </button>
                        ) : (
                          <p className="text-[10px] text-muted">
                            General bot = Sessions tab (semua tools). Tidak bisa dihapus.
                          </p>
                        )}
                      </SectionCard>
                      {selectedBot.id !== "general" ? (
                        <SectionCard title="Allowed tools">
                          <p className="mb-1 text-[10px] text-muted">
                            Hanya tools tercentang yang bisa dipakai di sesi bot ini.
                          </p>
                          <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                            {toolsByCategory.map(([cat, tools]) => (
                              <div key={cat}>
                                <div className="mb-1 text-[9.5px] font-semibold tracking-wider text-muted uppercase">
                                  {cat}
                                </div>
                                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                  {tools.map((t) => {
                                    const on = (selectedBot.tools ?? []).includes(
                                      t.name,
                                    );
                                    return (
                                      <label
                                        key={t.name}
                                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 ${
                                          on
                                            ? "border-accent/30 bg-accent/10"
                                            : "border-border bg-surface-1"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={on}
                                          onChange={() => toggleBotTool(t.name)}
                                          className="mt-0.5"
                                        />
                                        <span>
                                          <span className="block font-mono text-[10px] text-fg">
                                            {t.name}
                                          </span>
                                          <span className="block text-[9px] text-muted">
                                            {t.description}
                                          </span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </SectionCard>
                      ) : null}
                    </>
                  ) : (
                    <div className="text-[12px] text-muted">Select a bot</div>
                  )}
                </div>
              </div>
            </div>
          ) : group === "desktop" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="macOS desktop automation">
                <Toggle
                  checked={desktopEnabled}
                  onChange={setDesktopEnabled}
                  label="Enable desktop automation"
                  hint="DESKTOP_AUTOMATION — osascript control untuk app allowlisted."
                />
                <div>
                  <FieldLabel hint="Satu app per baris (nama aplikasi macOS)">
                    Allowed apps
                  </FieldLabel>
                  <textarea
                    value={appsText}
                    onChange={(e) => setAppsText(e.target.value)}
                    rows={8}
                    className="w-full resize-y rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                    placeholder={"Google Chrome\nFinder"}
                  />
                </div>
              </SectionCard>
            </div>
          ) : group === "sandbox" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="PTY pool">
                <div>
                  <FieldLabel hint="Hard timeout per command (ms)">
                    PTY timeout
                  </FieldLabel>
                  <NumberInput
                    value={ptyTimeoutMs}
                    onChange={setPtyTimeoutMs}
                    min={5000}
                    step={1000}
                  />
                </div>
                <div>
                  <FieldLabel hint="Parallel shell slots (1–10)">
                    Pool size
                  </FieldLabel>
                  <NumberInput
                    value={ptyPoolSize}
                    onChange={setPtyPoolSize}
                    min={1}
                    max={10}
                  />
                </div>
                <div>
                  <FieldLabel hint="Kosongkan = default shell user">
                    Shell binary
                  </FieldLabel>
                  <TextInput
                    mono
                    value={ptyShell}
                    onChange={setPtyShell}
                    placeholder="/bin/zsh"
                  />
                </div>
              </SectionCard>
              <SectionCard title="Workspace allowlist (live)">
                <ul className="space-y-1">
                  {snap.sandbox.allowedFolders.map((f) => (
                    <li
                      key={f}
                      className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 font-mono text-[10px] text-fg-dim"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted">
                  Saat Privacy ON, folder di luar project di-grant via{" "}
                  <code className="text-accent-soft">request_folder_access</code>{" "}
                  + Approve di UI (tersimpan di{" "}
                  <code className="text-accent-soft">.agent/folder-allowlist.json</code>
                  ). Saat Privacy OFF, akses mesin penuh — tidak perlu Approve folder.
                </p>
              </SectionCard>
            </div>
          ) : group === "memory" ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <SectionCard title="Long-term memory">
                <Toggle
                  checked={enableReflection}
                  onChange={setEnableReflection}
                  label="Auto-reflection"
                  hint="Setelah tiap turn, simpan episode yang relevan."
                />
              </SectionCard>
              <SectionCard title="AGENTS.md guidelines">
                <FieldLabel hint={snap.memory.agentsMdPath}>
                  Always-on agent memory file
                </FieldLabel>
                <textarea
                  value={agentsMd}
                  onChange={(e) => setAgentsMd(e.target.value)}
                  rows={18}
                  className="w-full resize-y rounded-lg border border-border bg-surface-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg outline-none focus:border-accent/50"
                />
              </SectionCard>
            </div>
          ) : group === "ui" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="Activity rail">
                <Toggle
                  checked={defaultRailOpen}
                  onChange={setDefaultRailOpen}
                  label="Open activity rail by default"
                  hint="Right sidebar for Canvas and Files."
                />
                <FieldLabel hint="Which tab opens when the rail is shown">
                  Default rail tab
                </FieldLabel>
                <select
                  value={defaultRailLayer}
                  onChange={(e) =>
                    setDefaultRailLayer(
                      e.target.value === "files" ? "files" : "canvas",
                    )
                  }
                  className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] text-fg outline-none focus:border-accent/50"
                >
                  <option value="canvas">Canvas</option>
                  <option value="files">Files</option>
                </select>
                <Toggle
                  checked={compactActivity}
                  onChange={setCompactActivity}
                  label="Compact activity chips"
                  hint="Shorter tool/status chips in chat."
                />
              </SectionCard>
              <SectionCard title="Footer">
                <Toggle
                  checked={showFooterPhase}
                  onChange={setShowFooterPhase}
                  label="Show live phase"
                  hint="Displays phase: thinking (and other phases) in the footer."
                />
                <Toggle
                  checked={showLearnedInFooter}
                  onChange={setShowLearnedInFooter}
                  label="Show Learned memory button"
                  hint="Footer icon opens a popover of learned rules."
                />
              </SectionCard>
              <SectionCard title="Chat">
                <Toggle
                  checked={openChatPathsInCanvas}
                  onChange={setOpenChatPathsInCanvas}
                  label="Open file paths from chat in Canvas"
                  hint="Clickable `path/to/file.md` chips open the right rail."
                />
                <Toggle
                  checked={preferStreamedAnswer}
                  onChange={setPreferStreamedAnswer}
                  label="Prefer full streamed answer"
                  hint="If the final payload is shorter than what streamed, keep the longer text."
                />
              </SectionCard>
              <SectionCard title="Related">
                <p className="text-[11px] text-muted">
                  Toggle skills/tools/MCP ada di menu Capabilities.
                </p>
                {onOpenCapabilities ? (
                  <button
                    type="button"
                    onClick={onOpenCapabilities}
                    className="self-start rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[11px] text-fg hover:border-accent/40"
                  >
                    Open Capabilities →
                  </button>
                ) : null}
              </SectionCard>
            </div>
          ) : group === "gateways" ? (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="Gateway connection">
                <p className="text-[11px] leading-relaxed text-muted">
                  Local by default. Use remote when this app should drive an
                  agent backend elsewhere. Gateway connections are machine-level;
                  profiles are discovered from the gateways you connect.
                </p>
                <div className="grid gap-2">
                  {(
                    [
                      {
                        id: "local",
                        title: "Local gateway",
                        body: "Start a private agent backend in this app. This is the default and works offline.",
                        enabled: true,
                      },
                      {
                        id: "cloud",
                        title: "Cloud",
                        body: "Sign in once and pick from agents on your account — not available in this build.",
                        enabled: false,
                      },
                      {
                        id: "remote",
                        title: "Remote gateway",
                        body: "Connect this desktop shell to a remote agent backend — not available in this build.",
                        enabled: false,
                      },
                      {
                        id: "ssh",
                        title: "Connect via SSH",
                        body: "Launch the agent on a remote host over SSH and tunnel it here — not available in this build.",
                        enabled: false,
                      },
                    ] as const
                  ).map((mode) => (
                    <div
                      key={mode.id}
                      className={`rounded-lg border px-3 py-3 ${
                        mode.id === "local"
                          ? "border-accent/50 bg-accent/10"
                          : "border-border bg-surface-1 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-fg">
                          {mode.title}
                        </div>
                        {mode.id === "local" ? (
                          <span className="text-[10px] text-accent-soft">✓ Selected</span>
                        ) : (
                          <span className="text-[10px] text-muted">Unavailable</span>
                        )}
                      </div>
                      <p className="mt-1 text-[10.5px] leading-snug text-muted">
                        {mode.body}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white"
                    onClick={async () => {
                      const res = await window.electronAgent?.setGatewayMode?.(
                        "local",
                      );
                      setNote(
                        res?.ok
                          ? "Local gateway mode saved."
                          : res?.error ?? "Could not save gateway mode",
                      );
                    }}
                  >
                    Save and reconnect
                  </button>
                </div>
              </SectionCard>

              <SectionCard title="Encrypt saved secrets with the OS keychain">
                <p className="text-[11px] leading-relaxed text-muted">
                  Off by default. When on, gateway tokens and sign-in credentials
                  are encrypted with your system keychain. When off, they are
                  stored as plain files readable only by your user account.
                  Keychain encryption is not wired in this build yet.
                </p>
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
                  <span className="text-[11px] text-fg-dim">OS keychain</span>
                  <span className="text-[11px] font-semibold text-muted">
                    {encryptSecrets ? "On" : "Off"}
                  </span>
                </div>
              </SectionCard>

              <SectionCard title="Diagnostics">
                <p className="text-[11px] text-muted">
                  Reveal desktop.log in your file manager — useful when the
                  gateway fails to start.
                </p>
                <button
                  type="button"
                  className="self-start text-[11px] text-accent-soft hover:underline"
                  onClick={async () => {
                    const res = await window.electronAgent?.openGatewayLogs?.();
                    setNote(
                      res?.ok
                        ? `Opened ${res.path}`
                        : res?.error ?? "Could not open logs",
                    );
                  }}
                >
                  Open logs →
                </button>
              </SectionCard>

              <SectionCard title="Registered gateways">
                <p className="mb-2 text-[11px] leading-relaxed text-muted">
                  Manage this device and every gateway it can reach. Profiles,
                  chats, messaging, and cron jobs stay with their gateway.
                </p>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-3">
                  <div>
                    <div className="text-[12px] font-semibold text-fg">
                      This device
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold text-accent-soft">
                        Current
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] text-muted">
                        Primary
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] text-muted">
                        App-managed
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      The agent runtime managed by this app.
                      {snap.paths.profileHome
                        ? ` Profile: ${snap.paths.profileId}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-fg hover:border-accent/40"
                    onClick={async () => {
                      const res = await window.electronAgent?.testLocalGateway?.();
                      setGatewayTest(
                        res
                          ? `${res.ok ? "OK" : "FAIL"} — ${res.detail}`
                          : "No gateway bridge",
                      );
                    }}
                  >
                    Test
                  </button>
                </div>
                {gatewayTest ? (
                  <div className="text-[11px] text-fg-dim">{gatewayTest}</div>
                ) : null}
                <button
                  type="button"
                  disabled
                  className="self-start rounded-md border border-border px-3 py-1.5 text-[11px] text-muted opacity-50"
                >
                  + Add connection
                </button>
              </SectionCard>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <SectionCard title="Config files">
                {(
                  [
                    ["Workspace", snap.paths.workspaceRoot],
                    ["Profile home", snap.paths.profileHome],
                    ["SOUL.md", snap.paths.soulPath],
                    [".env", snap.paths.envPath],
                    ["settings.json", snap.paths.settingsPath],
                    ["bots.json", snap.paths.botsPath],
                    ["desktop-allowlist.json", snap.paths.desktopAllowlistPath],
                    ["capabilities-prefs.json", snap.paths.capabilitiesPrefsPath],
                  ] as const
                ).map(([label, p]) => (
                  <div key={label}>
                    <div className="text-[10px] text-muted">{label}</div>
                    <div className="mt-0.5 break-all font-mono text-[10.5px] text-fg-dim">
                      {p}
                    </div>
                  </div>
                ))}
              </SectionCard>
              <p className="text-[10px] text-muted">
                Secrets disimpan di <code>.env</code> (profile). Preferensi
                agent/UI di profile <code>.agent/settings.json</code>. Jangan
                commit file berisi API key.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
