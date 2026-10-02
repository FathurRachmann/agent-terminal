/**
 * Model Hub Settings — Providers / Combos / Usage / Quota
 * Native React (no embed). Layout inspired by 9Router; colors = project tokens.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmptyDash,
  HubBtn,
  HubPageHeader,
  HubSection,
  Pill,
  ProgressBar,
  StatusDot,
  Toggle,
} from "./model-hub-ui.js";

export type ModelHubPage = "providers" | "combos" | "usage" | "quota";

type HubModel = {
  id: string;
  owned_by?: string;
  context_length?: number;
  name?: string;
};

type CatalogProvider = {
  id: string;
  name: string;
  kind: string;
  hasOAuth?: boolean;
  flowType?: string | null;
  color?: string | null;
  deprecated?: boolean;
  noAuth?: boolean;
};

type Connection = {
  id?: string;
  provider?: string;
  email?: string;
  name?: string;
  displayName?: string;
  testStatus?: string;
  lastError?: string | null;
  lastErrorAt?: string | null;
  enabled?: boolean;
  isActive?: boolean;
  authType?: string;
};

type CapacityCap = {
  enabled: boolean;
  roundRobin: boolean;
  models: string[];
};

type CapacityAdapter = {
  vision: CapacityCap;
  audioInput: CapacityCap;
  pdf: CapacityCap;
  videoInput: CapacityCap;
};

const DEFAULT_CAPACITY: CapacityAdapter = {
  vision: { enabled: true, roundRobin: false, models: [] },
  audioInput: { enabled: true, roundRobin: false, models: [] },
  pdf: { enabled: false, roundRobin: false, models: [] },
  videoInput: { enabled: false, roundRobin: false, models: [] },
};

function normalizeCapacity(raw: unknown): CapacityAdapter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    Partial<CapacityCap> | undefined
  >;
  const one = (key: keyof CapacityAdapter): CapacityCap => {
    const e = r[key];
    return {
      enabled: e?.enabled !== false,
      roundRobin: Boolean(e?.roundRobin),
      models: Array.isArray(e?.models) ? e.models.filter(Boolean) : [],
    };
  };
  return {
    vision: one("vision"),
    audioInput: one("audioInput"),
    pdf: { ...one("pdf"), enabled: r.pdf?.enabled === true },
    videoInput: { ...one("videoInput"), enabled: r.videoInput?.enabled === true },
  };
}

type ConnTestState = {
  status: "idle" | "testing" | "ok" | "error";
  latencyMs?: number;
  error?: string | null;
  testedAt?: string;
};

type ModelTestState = {
  status: "idle" | "testing" | "ok" | "error";
  latencyMs?: number;
  error?: string | null;
  preview?: string | null;
  httpStatus?: number;
  testedAt?: string;
};

type Combo = {
  id?: string;
  name?: string;
  models?: string[];
  kind?: string | null;
};

type OAuthSession = {
  provider: string;
  flowType: string;
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  interval?: number;
  authUrl?: string;
};

type ModelHubApi = {
  modelHubStatus?: () => Promise<{
    ready?: boolean;
    online?: boolean;
    baseUrl?: string | null;
    port?: number | null;
    error?: string | null;
    pages?: Record<string, { title: string; blurb: string }>;
  }>;
  modelHubEnsureSession?: () => Promise<{ ok?: boolean }>;
  modelHubFetchProviders?: () => Promise<{ ok?: boolean; data?: unknown; error?: string }>;
  modelHubFetchCombos?: () => Promise<{ ok?: boolean; data?: unknown; error?: string }>;
  modelHubFetchUsage?: (period?: string) => Promise<{ ok?: boolean; data?: unknown; error?: string }>;
  modelHubFetchUsageChart?: (period?: string) => Promise<{
    ok?: boolean;
    data?: Array<{ label: string; tokens: number; cost: number }>;
    error?: string;
  }>;
  modelHubFetchModels?: () => Promise<{ ok?: boolean; data?: { data?: HubModel[] }; error?: string }>;
  modelHubCatalog?: () => Promise<{ ok?: boolean; data?: { providers?: CatalogProvider[] }; error?: string }>;
  modelHubCreateCombo?: (p: {
    name: string;
    models: string[];
    kind?: string | null;
  }) => Promise<{ ok?: boolean; error?: string }>;
  modelHubDeleteCombo?: (id: string) => Promise<{ ok?: boolean; error?: string }>;
  modelHubUpdateCombo?: (p: {
    id: string;
    name?: string;
    models?: string[];
    kind?: string | null;
  }) => Promise<{ ok?: boolean; error?: string }>;
  modelHubFetchSettings?: () => Promise<{
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: string;
  }>;
  modelHubPatchSettings?: (
    patch: Record<string, unknown>,
  ) => Promise<{ ok?: boolean; data?: Record<string, unknown>; error?: string }>;
  modelHubConnectionQuota?: (id: string) => Promise<{ ok?: boolean; data?: unknown; error?: string }>;
  modelHubDeleteConnection?: (id: string) => Promise<{ ok?: boolean; error?: string }>;
  modelHubUpdateConnection?: (p: {
    id: string;
    isActive?: boolean;
    name?: string;
  }) => Promise<{ ok?: boolean; error?: string }>;
  modelHubFetchDisabledModels?: () => Promise<{
    ok?: boolean;
    disabled?: Record<string, string[]>;
    error?: string;
  }>;
  modelHubSetModelEnabled?: (p: {
    alias: string;
    modelIds: string[];
    enabled: boolean;
  }) => Promise<{ ok?: boolean; error?: string }>;
  modelHubTestConnection?: (id: string) => Promise<{
    ok?: boolean;
    valid?: boolean;
    error?: string | null;
    latencyMs?: number;
    testedAt?: string;
  }>;
  modelHubTestModel?: (modelId: string) => Promise<{
    ok?: boolean;
    modelId?: string;
    latencyMs?: number;
    status?: number;
    error?: string | null;
    preview?: string | null;
    testedAt?: string;
  }>;
  modelHubTestProviderBatch?: (providerId: string) => Promise<{
    ok?: boolean;
    error?: string;
    summary?: { total: number; passed: number; failed: number };
  }>;
  modelHubOAuthStart?: (provider: string) => Promise<Record<string, unknown> & { ok?: boolean; error?: string }>;
  modelHubOAuthPollCallback?: (state: string) => Promise<{ status?: string; code?: string; error?: string }>;
  modelHubOAuthExchange?: (p: Record<string, string | undefined>) => Promise<{ ok?: boolean; error?: string }>;
  modelHubOAuthPollDevice?: (p: {
    provider: string;
    deviceCode: string;
    codeVerifier?: string;
  }) => Promise<{ status?: string; error?: string }>;
};

function hubApi(): ModelHubApi {
  return (window.electronAgent ?? {}) as ModelHubApi;
}

function extractCodeFromPaste(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  try {
    if (text.includes("://")) {
      const u = new URL(text);
      return u.searchParams.get("code") || u.searchParams.get("token") || text;
    }
  } catch {
    /* raw */
  }
  return text;
}

function fmt(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function fmtCost(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "~$0.00";
  return `~$${n.toFixed(2)}`;
}

function connLabel(c: Connection): string {
  return c.email || c.displayName || c.name || c.id || "—";
}

type Props = { page: ModelHubPage };

export function ModelHubSettingsPanel({ page }: Props) {
  const [status, setStatus] = useState<Awaited<
    ReturnType<NonNullable<ModelHubApi["modelHubStatus"]>>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [models, setModels] = useState<HubModel[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [usageChart, setUsageChart] = useState<
    Array<{ label: string; tokens: number; cost: number }>
  >([]);
  const [usagePeriod, setUsagePeriod] = useState("today");
  const [usageTab, setUsageTab] = useState<"overview" | "details">("overview");
  const [quotas, setQuotas] = useState<
    Array<{ connection: Connection; data?: unknown; error?: string }>
  >([]);
  const [oauth, setOauth] = useState<OAuthSession | null>(null);
  const [paste, setPaste] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [comboName, setComboName] = useState("");
  const [comboKind, setComboKind] = useState<"fallback" | "round-robin" | "fusion">(
    "round-robin",
  );
  const [comboPicks, setComboPicks] = useState<string[]>([]);
  const [showCreateCombo, setShowCreateCombo] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<CapacityAdapter>(DEFAULT_CAPACITY);
  const [disabledLocal, setDisabledLocal] = useState<Record<string, boolean>>({});
  const pollRef = useRef<number | null>(null);

  const stopPoll = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refreshStatus = useCallback(async () => {
    const s = await hubApi().modelHubStatus?.();
    setStatus(s ?? null);
    if (s?.ready === false) setErr(s.error || "Model Hub belum siap");
    else setErr(null);
  }, []);

  const loadPage = useCallback(async () => {
    const api = hubApi();
    await api.modelHubEnsureSession?.();
    try {
      if (page === "providers") {
        const [conn, cat, mods] = await Promise.all([
          api.modelHubFetchProviders?.(),
          api.modelHubCatalog?.(),
          api.modelHubFetchModels?.(),
        ]);
        if (conn?.ok) {
          const raw = conn.data as { connections?: Connection[] } | Connection[];
          setConnections(Array.isArray(raw) ? raw : raw?.connections || []);
        } else if (conn?.error) setErr(conn.error);
        if (cat?.ok) setCatalog(cat.data?.providers || []);
        if (mods?.ok) setModels(mods.data?.data || []);
      } else if (page === "combos") {
        const [c, mods, settings] = await Promise.all([
          api.modelHubFetchCombos?.(),
          api.modelHubFetchModels?.(),
          api.modelHubFetchSettings?.(),
        ]);
        if (c?.ok) {
          const raw = c.data as { combos?: Combo[] } | Combo[];
          setCombos(Array.isArray(raw) ? raw : raw?.combos || []);
        } else if (c?.error) setErr(c.error);
        if (mods?.ok) setModels(mods.data?.data || []);
        if (settings?.ok) {
          setCapacity(normalizeCapacity(settings.data?.capacityAdapter));
        }
      } else if (page === "usage") {
        const [r, chart, conn] = await Promise.all([
          api.modelHubFetchUsage?.(usagePeriod),
          api.modelHubFetchUsageChart?.(usagePeriod),
          api.modelHubFetchProviders?.(),
        ]);
        if (r?.ok) setUsage((r.data as Record<string, unknown>) || null);
        else setErr(r?.error || null);
        if (chart?.ok && Array.isArray(chart.data)) setUsageChart(chart.data);
        else setUsageChart([]);
        if (conn?.ok) {
          const raw = conn.data as { connections?: Connection[] } | Connection[];
          setConnections(Array.isArray(raw) ? raw : raw?.connections || []);
        }
      } else if (page === "quota") {
        const conn = await api.modelHubFetchProviders?.();
        const list: Connection[] = conn?.ok
          ? (() => {
              const raw = conn.data as { connections?: Connection[] } | Connection[];
              return Array.isArray(raw) ? raw : raw?.connections || [];
            })()
          : [];
        setConnections(list);
        const rows = await Promise.all(
          list.map(async (c) => {
            if (!c.id) return { connection: c, error: "no id" };
            const q = await api.modelHubConnectionQuota?.(c.id);
            if (!q?.ok) return { connection: c, error: q?.error || "quota failed" };
            return { connection: c, data: q.data };
          }),
        );
        setQuotas(rows);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [page, usagePeriod]);

  useEffect(() => {
    setSelectedProvider(null);
    setShowCreateCombo(false);
    void refreshStatus().then(() => loadPage());
    return () => stopPoll();
  }, [refreshStatus, loadPage]);

  const connectionsByProvider = useMemo(() => {
    const map = new Map<string, Connection[]>();
    for (const c of connections) {
      const id = c.provider || "unknown";
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(c);
    }
    return map;
  }, [connections]);

  const filteredCatalog = useMemo(() => {
    const q = providerQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q),
    );
  }, [catalog, providerQuery]);

  const sectionProviders = useMemo(() => {
    const oauth = filteredCatalog.filter((p) => p.kind === "oauth");
    const free = filteredCatalog.filter(
      (p) => p.kind === "free" || p.kind === "freeTier",
    );
    const apikey = filteredCatalog.filter((p) => p.kind === "apikey");
    return { oauth, free, apikey };
  }, [filteredCatalog]);

  const finishSuccess = async (label: string) => {
    stopPoll();
    setOauth(null);
    setPaste("");
    setNote(`${label} terhubung.`);
    setBusy(false);
    await loadPage();
  };

  const startConnect = async (providerId: string) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    stopPoll();
    const res = await hubApi().modelHubOAuthStart?.(providerId);
    if (!res?.ok) {
      setErr(String(res?.error || "Gagal mulai OAuth"));
      setBusy(false);
      return;
    }
    if (res.flowType === "device_code") {
      setOauth({
        provider: providerId,
        flowType: "device_code",
        deviceCode: String(res.deviceCode || ""),
        userCode: String(res.userCode || ""),
        verificationUri: res.verificationUri
          ? String(res.verificationUri)
          : undefined,
        codeVerifier: res.codeVerifier ? String(res.codeVerifier) : undefined,
        interval: Number(res.interval || 5),
      });
      setNote(res.userCode ? `Kode: ${res.userCode}` : "Device login…");
      const ms = Math.max(3, Number(res.interval || 5)) * 1000;
      pollRef.current = window.setInterval(() => {
        void (async () => {
          const poll = await hubApi().modelHubOAuthPollDevice?.({
            provider: providerId,
            deviceCode: String(res.deviceCode),
            codeVerifier: res.codeVerifier
              ? String(res.codeVerifier)
              : undefined,
          });
          if (poll?.status === "done") await finishSuccess(providerId);
          else if (poll?.status === "error") {
            stopPoll();
            setErr(poll.error || "Device poll gagal");
            setBusy(false);
          }
        })();
      }, ms);
      return;
    }
    setOauth({
      provider: providerId,
      flowType: String(res.flowType || "authorization_code"),
      state: res.state ? String(res.state) : undefined,
      codeVerifier: res.codeVerifier ? String(res.codeVerifier) : undefined,
      redirectUri: res.redirectUri ? String(res.redirectUri) : undefined,
      authUrl: res.authUrl ? String(res.authUrl) : undefined,
    });
    setNote("Browser dibuka — tunggu callback atau paste URL/code.");
    if (res.state) {
      pollRef.current = window.setInterval(() => {
        void (async () => {
          const poll = await hubApi().modelHubOAuthPollCallback?.(
            String(res.state),
          );
          if (poll?.status === "done" && poll.code) {
            const ex = await hubApi().modelHubOAuthExchange?.({
              provider: providerId,
              code: poll.code,
              redirectUri: res.redirectUri
                ? String(res.redirectUri)
                : undefined,
              codeVerifier: res.codeVerifier
                ? String(res.codeVerifier)
                : undefined,
              state: String(res.state),
            });
            if (ex?.ok) await finishSuccess(providerId);
            else {
              stopPoll();
              setErr(ex?.error || "Exchange gagal");
              setBusy(false);
            }
          } else if (poll?.status === "error") {
            stopPoll();
            setErr(poll.error || "OAuth error");
            setBusy(false);
          }
        })();
      }, 1500);
    } else setBusy(false);
  };

  const submitPaste = async () => {
    if (!oauth || oauth.flowType === "device_code") return;
    const code = extractCodeFromPaste(paste);
    if (!code) {
      setErr("Paste URL callback atau code");
      return;
    }
    setBusy(true);
    const ex = await hubApi().modelHubOAuthExchange?.({
      provider: oauth.provider,
      code,
      redirectUri: oauth.redirectUri,
      codeVerifier: oauth.codeVerifier,
      state: oauth.state,
    });
    if (ex?.ok) await finishSuccess(oauth.provider);
    else {
      setErr(ex?.error || "Exchange gagal");
      setBusy(false);
    }
  };

  const openCreateCombo = () => {
    setEditingComboId(null);
    setComboName("");
    setComboPicks([]);
    setComboKind("round-robin");
    setShowCreateCombo(true);
  };

  const openEditCombo = (c: Combo) => {
    if (!c.id) return;
    setEditingComboId(c.id);
    setComboName(c.name || "");
    setComboPicks([...(c.models || [])]);
    const k = c.kind;
    setComboKind(
      k === "fallback" || k === "fusion" || k === "round-robin"
        ? k
        : "round-robin",
    );
    setShowCreateCombo(true);
  };

  const saveCombo = async () => {
    setBusy(true);
    setErr(null);
    const name = comboName.trim();
    if (editingComboId) {
      const r = await hubApi().modelHubUpdateCombo?.({
        id: editingComboId,
        name,
        models: comboPicks,
        kind: comboKind,
      });
      setBusy(false);
      if (!r?.ok) {
        setErr(r?.error || "Gagal update combo");
        return;
      }
      setNote(`Combo “${name}” diupdate.`);
    } else {
      const r = await hubApi().modelHubCreateCombo?.({
        name,
        models: comboPicks,
        kind: comboKind,
      });
      setBusy(false);
      if (!r?.ok) {
        setErr(r?.error || "Gagal buat combo");
        return;
      }
      setNote(`Combo “${name}” dibuat (${comboKind}).`);
    }
    setComboName("");
    setComboPicks([]);
    setEditingComboId(null);
    setShowCreateCombo(false);
    await loadPage();
  };

  const patchCapacity = async (next: CapacityAdapter) => {
    setCapacity(next);
    setBusy(true);
    const r = await hubApi().modelHubPatchSettings?.({
      capacityAdapter: next,
    });
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || "Gagal simpan Vision Adapter");
      await loadPage();
      return;
    }
    setNote("Vision Adapter tersimpan.");
  };

  const selectedMeta = catalog.find((p) => p.id === selectedProvider);
  const selectedConns = selectedProvider
    ? connectionsByProvider.get(selectedProvider) || []
    : [];
  const selectedModels = models.filter(
    (m) =>
      (m.owned_by || "").toLowerCase() === (selectedProvider || "").toLowerCase() ||
      m.id.toLowerCase().startsWith(`${selectedProvider}/`) ||
      m.id.toLowerCase().includes(`/${selectedProvider}`) ||
      (selectedProvider === "antigravity" && m.id.startsWith("ag/")),
  );

  return (
    <div className="flex flex-col gap-3">
      {(err || note) && (
        <div
          className={`rounded-lg border px-3 py-2 text-[11px] ${
            err
              ? "border-danger/30 bg-[#2a1518] text-danger"
              : "border-accent/20 bg-accent/10 text-accent-soft"
          }`}
        >
          {err ?? note}
        </div>
      )}

      {!status?.ready ? (
        <EmptyDash>
          Model Hub {status?.error ? `error: ${status.error}` : "starting…"}
          <div className="mt-2">
            <HubBtn onClick={() => void refreshStatus().then(() => loadPage())}>
              Retry
            </HubBtn>
          </div>
        </EmptyDash>
      ) : null}

      {status?.ready && page === "providers" ? (
        selectedProvider ? (
          <ProviderDetail
            providerId={selectedProvider}
            meta={selectedMeta}
            connections={selectedConns}
            models={selectedModels.length ? selectedModels : models.filter((m) =>
              (m.owned_by || "").toLowerCase().includes((selectedProvider || "").slice(0, 4)),
            )}
            busy={busy}
            onBack={() => setSelectedProvider(null)}
            onConnect={() => void startConnect(selectedProvider)}
            onDelete={async (id) => {
              setBusy(true);
              await hubApi().modelHubDeleteConnection?.(id);
              setBusy(false);
              await loadPage();
            }}
            onRefresh={() => void loadPage()}
            onToggleConnection={async (id, isActive) => {
              setBusy(true);
              const r = await hubApi().modelHubUpdateConnection?.({ id, isActive });
              setBusy(false);
              if (!r?.ok) {
                setErr(r?.error || "Gagal update akun");
                return;
              }
              await loadPage();
            }}
          />
        ) : (
          <ProvidersHome
            query={providerQuery}
            onQuery={setProviderQuery}
            sections={sectionProviders}
            connectionsByProvider={connectionsByProvider}
            disabledLocal={disabledLocal}
            setDisabledLocal={setDisabledLocal}
            busy={busy}
            onOpen={(id) => setSelectedProvider(id)}
            onConnect={(id) => void startConnect(id)}
            onRefresh={() => void refreshStatus().then(() => loadPage())}
          />
        )
      ) : null}

      {status?.ready && page === "combos" ? (
        <CombosHome
          combos={combos}
          models={models}
          busy={busy}
          showCreate={showCreateCombo}
          setShowCreate={(v) => {
            if (!v) {
              setShowCreateCombo(false);
              setEditingComboId(null);
            } else openCreateCombo();
          }}
          editingId={editingComboId}
          comboName={comboName}
          setComboName={setComboName}
          comboKind={comboKind}
          setComboKind={setComboKind}
          comboPicks={comboPicks}
          setComboPicks={setComboPicks}
          onSave={() => void saveCombo()}
          onEdit={openEditCombo}
          onDelete={async (id) => {
            setBusy(true);
            await hubApi().modelHubDeleteCombo?.(id);
            setBusy(false);
            await loadPage();
          }}
          onKindChange={async (id, kind) => {
            setBusy(true);
            const r = await hubApi().modelHubUpdateCombo?.({ id, kind });
            setBusy(false);
            if (!r?.ok) setErr(r?.error || "Gagal update strategy");
            else await loadPage();
          }}
          capacity={capacity}
          onCapacityChange={(next) => void patchCapacity(next)}
        />
      ) : null}

      {status?.ready && page === "usage" ? (
        <UsageHome
          period={usagePeriod}
          setPeriod={setUsagePeriod}
          tab={usageTab}
          setTab={setUsageTab}
          data={usage}
          chart={usageChart}
          connections={connections}
        />
      ) : null}

      {status?.ready && page === "quota" ? (
        <QuotaHome
          quotas={quotas}
          busy={busy}
          onRefresh={() => void loadPage()}
          onDelete={async (id) => {
            setBusy(true);
            await hubApi().modelHubDeleteConnection?.(id);
            setBusy(false);
            await loadPage();
          }}
        />
      ) : null}

      {oauth ? (
        <OAuthModal
          oauth={oauth}
          paste={paste}
          setPaste={setPaste}
          busy={busy}
          onSubmit={() => void submitPaste()}
          onCancel={() => {
            stopPoll();
            setOauth(null);
            setPaste("");
            setBusy(false);
            setNote(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Providers ─────────────────────────────────────────────── */

function ProvidersHome({
  query,
  onQuery,
  sections,
  connectionsByProvider,
  disabledLocal,
  setDisabledLocal,
  busy,
  onOpen,
  onConnect,
  onRefresh,
}: {
  query: string;
  onQuery: (v: string) => void;
  sections: {
    oauth: CatalogProvider[];
    free: CatalogProvider[];
    apikey: CatalogProvider[];
  };
  connectionsByProvider: Map<string, Connection[]>;
  disabledLocal: Record<string, boolean>;
  setDisabledLocal: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  busy: boolean;
  onOpen: (id: string) => void;
  onConnect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <HubPageHeader
        title="Providers"
        subtitle="Manage your AI provider connections."
        search={query}
        onSearch={onQuery}
        searchPlaceholder="Search providers…"
        actions={<HubBtn onClick={onRefresh}>Refresh</HubBtn>}
      />

      <HubSection
        title="Custom Providers (OpenAI / Anthropic Compatible)"
        actions={
          <>
            <HubBtn variant="soft" disabled>
              + Add Anthropic Compatible
            </HubBtn>
            <HubBtn disabled>+ Add OpenAI Compatible</HubBtn>
          </>
        }
      >
        <EmptyDash>
          No custom providers — use buttons above to add OpenAI/Anthropic compatible
          endpoints.
        </EmptyDash>
      </HubSection>

      <ProviderSection
        title="OAuth Providers"
        providers={sections.oauth}
        connectionsByProvider={connectionsByProvider}
        disabledLocal={disabledLocal}
        setDisabledLocal={setDisabledLocal}
        busy={busy}
        onOpen={onOpen}
        onConnect={onConnect}
      />
      <ProviderSection
        title="Free Tier Providers"
        providers={sections.free}
        connectionsByProvider={connectionsByProvider}
        disabledLocal={disabledLocal}
        setDisabledLocal={setDisabledLocal}
        busy={busy}
        onOpen={onOpen}
        onConnect={onConnect}
      />
      <ProviderSection
        title="API Key Providers"
        providers={sections.apikey}
        connectionsByProvider={connectionsByProvider}
        disabledLocal={disabledLocal}
        setDisabledLocal={setDisabledLocal}
        busy={busy}
        onOpen={onOpen}
        onConnect={onConnect}
      />
    </div>
  );
}

function ProviderSection({
  title,
  providers,
  connectionsByProvider,
  disabledLocal,
  setDisabledLocal,
  busy,
  onOpen,
  onConnect,
}: {
  title: string;
  providers: CatalogProvider[];
  connectionsByProvider: Map<string, Connection[]>;
  disabledLocal: Record<string, boolean>;
  setDisabledLocal: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  busy: boolean;
  onOpen: (id: string) => void;
  onConnect: (id: string) => void;
}) {
  if (!providers.length) return null;
  return (
    <HubSection
      title={title}
      actions={<HubBtn disabled>Test All</HubBtn>}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((p) => {
          const conns = connectionsByProvider.get(p.id) || [];
          const n = conns.length;
          const on = disabledLocal[p.id] !== true;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => (n > 0 || p.hasOAuth ? onOpen(p.id) : onConnect(p.id))}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 py-3 text-left transition hover:border-accent/40 hover:bg-surface-2"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-[12px] font-bold text-accent-soft"
                style={p.color ? { color: p.color, borderColor: `${p.color}55` } : undefined}
              >
                {(p.name || p.id).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-fg">
                  {p.name}
                  {p.deprecated ? (
                    <span className="ml-1 text-[9px] font-normal text-warn">deprecated</span>
                  ) : null}
                </div>
                <div
                  className={`mt-0.5 text-[10.5px] ${
                    n > 0 ? "text-success" : "text-muted"
                  }`}
                >
                  {n > 0 ? `${n} Connected` : p.noAuth ? "Ready" : "No connections"}
                </div>
              </div>
              {n > 0 ? (
                <span
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Toggle
                    on={on}
                    disabled={busy}
                    label={`Toggle ${p.name}`}
                    onChange={(v) =>
                      setDisabledLocal((prev) => ({ ...prev, [p.id]: !v }))
                    }
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </HubSection>
  );
}

function toneFromTestStatus(status?: string): "ok" | "warn" | "danger" | "muted" {
  const s = (status || "").toLowerCase();
  if (s === "active" || s === "success" || s === "ok") return "ok";
  if (s === "error" || s === "failed") return "danger";
  if (s === "unknown" || !s) return "muted";
  return "warn";
}

function splitHubModelId(
  fullId: string,
  fallbackAlias: string,
): { alias: string; bare: string } {
  const i = fullId.indexOf("/");
  if (i <= 0) return { alias: fallbackAlias, bare: fullId };
  return { alias: fullId.slice(0, i), bare: fullId.slice(i + 1) };
}

function ProviderDetail({
  providerId,
  meta,
  connections,
  models,
  busy,
  onBack,
  onConnect,
  onDelete,
  onRefresh,
  onToggleConnection,
}: {
  providerId: string;
  meta?: CatalogProvider;
  connections: Connection[];
  models: HubModel[];
  busy: boolean;
  onBack: () => void;
  onConnect: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onToggleConnection: (id: string, isActive: boolean) => void;
}) {
  const [modelOn, setModelOn] = useState<Record<string, boolean>>({});
  const [retainedModels, setRetainedModels] = useState<HubModel[]>([]);
  const [connTests, setConnTests] = useState<Record<string, ConnTestState>>({});
  const [modelTests, setModelTests] = useState<Record<string, ModelTestState>>({});
  const [testingAllConns, setTestingAllConns] = useState(false);
  const [testingAllModels, setTestingAllModels] = useState(false);
  const [togglingModel, setTogglingModel] = useState<string | null>(null);

  // Keep models that disappear from /v1/models after disable (API filters them out).
  useEffect(() => {
    setRetainedModels((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of models) map.set(m.id, m);
      return [...map.values()];
    });
  }, [models]);

  // Sync enabled state from hub disabledModels + restore disabled stubs at bottom.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await hubApi().modelHubFetchDisabledModels?.();
      if (cancelled) return;
      const disabledMap = r?.ok ? r.disabled || {} : {};
      const nextOn: Record<string, boolean> = {};
      const stubs: HubModel[] = [];

      const aliasCandidates = new Set<string>([providerId]);
      for (const m of models) {
        const { alias } = splitHubModelId(m.id, providerId);
        aliasCandidates.add(alias);
      }
      // Common alias for antigravity models
      if (providerId === "antigravity") aliasCandidates.add("ag");

      for (const alias of aliasCandidates) {
        const list = disabledMap[alias] || [];
        for (const bare of list) {
          const fullId = bare.includes("/") ? bare : `${alias}/${bare}`;
          stubs.push({
            id: fullId,
            owned_by: alias,
            name: "disabled",
          });
          nextOn[fullId] = false;
        }
      }

      for (const m of models) {
        const { alias, bare } = splitHubModelId(m.id, providerId);
        const list =
          disabledMap[alias] ||
          disabledMap[providerId] ||
          (alias === "ag" ? disabledMap.antigravity : undefined) ||
          [];
        nextOn[m.id] = !list.includes(bare) && !list.includes(m.id);
      }

      if (stubs.length) {
        setRetainedModels((prev) => {
          const map = new Map(prev.map((m) => [m.id, m]));
          for (const m of models) map.set(m.id, m);
          for (const s of stubs) {
            if (!map.has(s.id)) map.set(s.id, s);
          }
          return [...map.values()];
        });
      }

      setModelOn((prev) => ({ ...prev, ...nextOn }));
    })();
    return () => {
      cancelled = true;
    };
  }, [models, providerId]);

  const activeModels = retainedModels.filter((m) => modelOn[m.id] !== false);
  const disabledModels = retainedModels.filter((m) => modelOn[m.id] === false);
  const orderedModels = [...activeModels, ...disabledModels];

  const testConnection = async (id: string) => {
    setConnTests((prev) => ({
      ...prev,
      [id]: { status: "testing" },
    }));
    const r = await hubApi().modelHubTestConnection?.(id);
    const ok = Boolean(r?.ok && r.valid);
    setConnTests((prev) => ({
      ...prev,
      [id]: {
        status: ok ? "ok" : "error",
        latencyMs: r?.latencyMs,
        error: r?.error || (ok ? null : "Connection failed"),
        testedAt: r?.testedAt,
      },
    }));
    onRefresh();
  };

  const testAllConnections = async () => {
    const ids = connections.map((c) => c.id).filter(Boolean) as string[];
    if (!ids.length) return;
    setTestingAllConns(true);
    for (const id of ids) {
      await testConnection(id);
    }
    setTestingAllConns(false);
  };

  const testModel = async (modelId: string) => {
    setModelTests((prev) => ({
      ...prev,
      [modelId]: { status: "testing" },
    }));
    const r = await hubApi().modelHubTestModel?.(modelId);
    const ok = Boolean(r?.ok);
    setModelTests((prev) => ({
      ...prev,
      [modelId]: {
        status: ok ? "ok" : "error",
        latencyMs: r?.latencyMs,
        error: r?.error || (ok ? null : "Model failed"),
        preview: r?.preview || null,
        httpStatus: r?.status,
        testedAt: r?.testedAt,
      },
    }));
  };

  const testAllModels = async () => {
    const ids = orderedModels.map((m) => m.id).filter((id) => modelOn[id] !== false);
    if (!ids.length) return;
    setTestingAllModels(true);
    for (const id of ids) {
      await testModel(id);
    }
    setTestingAllModels(false);
  };

  const setModelEnabled = async (modelId: string, enabled: boolean) => {
    const { alias, bare } = splitHubModelId(modelId, providerId);
    setModelOn((prev) => ({ ...prev, [modelId]: enabled }));
    // Ensure card stays in list when disabling (v1/models will drop it on refresh)
    setRetainedModels((prev) => {
      if (prev.some((m) => m.id === modelId)) return prev;
      return [...prev, { id: modelId, owned_by: alias, name: bare }];
    });
    setTogglingModel(modelId);
    const r = await hubApi().modelHubSetModelEnabled?.({
      alias,
      modelIds: [bare],
      enabled,
    });
    setTogglingModel(null);
    if (!r?.ok) {
      setModelOn((prev) => ({ ...prev, [modelId]: !enabled }));
    }
  };

  const setAllModelsEnabled = async (enabled: boolean) => {
    const byAlias = new Map<string, string[]>();
    const next: Record<string, boolean> = {};
    for (const m of orderedModels) {
      const { alias, bare } = splitHubModelId(m.id, providerId);
      const list = byAlias.get(alias) || [];
      list.push(bare);
      byAlias.set(alias, list);
      next[m.id] = enabled;
    }
    setModelOn(next);
    for (const [alias, modelIds] of byAlias) {
      await hubApi().modelHubSetModelEnabled?.({ alias, modelIds, enabled });
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="text-muted hover:text-fg"
          >
            Providers
          </button>
          <span className="text-muted">›</span>
          <span className="font-semibold text-fg">{meta?.name || providerId}</span>
        </div>
        <HubBtn
          disabled={busy || testingAllConns || !connections.length}
          onClick={() => void testAllConnections()}
        >
          {testingAllConns ? "Testing accounts…" : "Test All Accounts"}
        </HubBtn>
      </div>

      <div className="mb-3 overflow-hidden rounded-xl border border-border bg-surface-1">
        {connections.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-muted">
            No accounts yet.{" "}
            <button
              type="button"
              className="text-accent-soft underline"
              onClick={onConnect}
              disabled={busy}
            >
              Connect
            </button>
          </div>
        ) : (
          <ul>
            {connections.map((c, i) => {
              const active = c.isActive !== false;
              const live = c.id ? connTests[c.id] : undefined;
              const tone =
                live?.status === "testing"
                  ? "warn"
                  : live?.status === "ok"
                    ? "ok"
                    : live?.status === "error"
                      ? "danger"
                      : !active
                        ? "muted"
                        : toneFromTestStatus(c.testStatus);
              const statusLabel =
                live?.status === "testing"
                  ? "testing"
                  : live?.status === "ok"
                    ? "ok"
                    : live?.status === "error"
                      ? "error"
                      : !active
                        ? "off"
                        : c.testStatus || "unknown";
              return (
                <li
                  key={c.id || i}
                  className="flex flex-wrap items-center gap-3 border-b border-border/70 px-3 py-2.5 last:border-0"
                >
                  <StatusDot tone={tone} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-fg">
                      {connLabel(c)}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted">
                      #{i + 1}
                      {c.testStatus ? ` · ${c.testStatus}` : ""}
                      {live?.status === "ok" && live.latencyMs != null
                        ? ` · ${live.latencyMs}ms`
                        : ""}
                      {live?.status === "error" && live.error
                        ? ` · ${live.error}`
                        : ""}
                      {!live?.error && c.lastError ? ` · ${c.lastError}` : ""}
                    </div>
                  </div>
                  <Pill
                    tone={
                      statusLabel === "error"
                        ? "danger"
                        : statusLabel === "ok" || statusLabel === "active"
                          ? "ok"
                          : statusLabel === "testing"
                            ? "warn"
                            : "muted"
                    }
                  >
                    {statusLabel}
                  </Pill>
                  <Pill tone="accent">{c.authType === "apikey" ? "API Key" : "OAuth"}</Pill>
                  <HubBtn
                    disabled={busy || !c.id || live?.status === "testing" || testingAllConns}
                    onClick={() => c.id && void testConnection(c.id)}
                  >
                    {live?.status === "testing" ? "Testing…" : "Test"}
                  </HubBtn>
                  <HubBtn
                    variant="danger"
                    disabled={busy || !c.id}
                    onClick={() => c.id && onDelete(c.id)}
                  >
                    Delete
                  </HubBtn>
                  <Toggle
                    on={active}
                    disabled={busy || !c.id}
                    label={`Enable ${connLabel(c)}`}
                    onChange={(v) => c.id && onToggleConnection(c.id, v)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-3 py-2">
          <HubBtn variant="primary" disabled={busy} onClick={onConnect}>
            + Add
          </HubBtn>
        </div>
      </div>

      <HubSection
        title="Available Models"
        hint="Test = tiny /v1 chat ping — shows ok / latency or error schema. Disabled models stay listed below."
        actions={
          <>
            <HubBtn
              disabled={testingAllModels || !activeModels.length}
              onClick={() => void testAllModels()}
            >
              {testingAllModels ? "Testing models…" : "Test All Models"}
            </HubBtn>
            <HubBtn
              disabled={busy}
              onClick={() => void setAllModelsEnabled(true)}
            >
              Active All
            </HubBtn>
            <HubBtn
              disabled={busy}
              onClick={() => void setAllModelsEnabled(false)}
            >
              Disable All
            </HubBtn>
          </>
        }
      >
        {!orderedModels.length ? (
          <EmptyDash>No models for this provider yet.</EmptyDash>
        ) : (
          <div className="space-y-3">
            {activeModels.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {activeModels.map((m) => (
                  <ModelCard
                    key={m.id}
                    m={m}
                    on
                    t={modelTests[m.id]}
                    busy={busy}
                    toggling={togglingModel === m.id}
                    testingAll={testingAllModels}
                    onTest={() => void testModel(m.id)}
                    onToggle={(v) => void setModelEnabled(m.id, v)}
                  />
                ))}
              </div>
            ) : (
              <EmptyDash>All models disabled for this provider.</EmptyDash>
            )}

            {disabledModels.length ? (
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
                  <span className="h-px flex-1 bg-border" />
                  Disabled · {disabledModels.length}
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {disabledModels.map((m) => (
                    <ModelCard
                      key={m.id}
                      m={m}
                      on={false}
                      t={modelTests[m.id]}
                      busy={busy}
                      toggling={togglingModel === m.id}
                      testingAll={testingAllModels}
                      onTest={() => void testModel(m.id)}
                      onToggle={(v) => void setModelEnabled(m.id, v)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </HubSection>
    </div>
  );
}

function ModelCard({
  m,
  on,
  t,
  busy,
  toggling,
  testingAll,
  onTest,
  onToggle,
}: {
  m: HubModel;
  on: boolean;
  t?: ModelTestState;
  busy: boolean;
  toggling: boolean;
  testingAll: boolean;
  onTest: () => void;
  onToggle: (v: boolean) => void;
}) {
  const tone =
    t?.status === "testing"
      ? "warn"
      : t?.status === "ok"
        ? "ok"
        : t?.status === "error"
          ? "danger"
          : on
            ? "ok"
            : "danger";
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        t?.status === "error"
          ? "border-danger/40 bg-surface-1"
          : t?.status === "ok"
            ? "border-success/40 bg-surface-1"
            : on
              ? "border-success/40 bg-surface-1"
              : "border-danger/30 bg-surface-1/60 opacity-90"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-semibold text-fg">
            {m.id}
          </div>
          <div className="truncate text-[10px] text-muted">
            {on ? m.name || m.owned_by || "model" : "disabled"}
          </div>
        </div>
        <HubBtn
          disabled={t?.status === "testing" || testingAll}
          onClick={onTest}
        >
          {t?.status === "testing" ? "…" : "Test"}
        </HubBtn>
        <button
          type="button"
          title="Copy model id"
          onClick={() => void navigator.clipboard?.writeText(m.id)}
          className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
        >
          Copy
        </button>
        <Toggle
          on={on}
          disabled={busy || toggling}
          onChange={onToggle}
        />
      </div>
      {t && t.status !== "idle" ? (
        <div
          className={`mt-1.5 rounded-md border px-2 py-1 font-mono text-[10px] ${
            t.status === "ok"
              ? "border-success/25 bg-success/10 text-success"
              : t.status === "error"
                ? "border-danger/25 bg-danger/10 text-danger"
                : "border-border bg-surface-2 text-muted"
          }`}
        >
          {t.status === "testing" ? (
            <span>status: testing…</span>
          ) : t.status === "ok" ? (
            <span>
              status: ok · latency: {t.latencyMs ?? "—"}ms
              {t.preview ? ` · reply: “${t.preview}”` : ""}
            </span>
          ) : (
            <span>
              status: error
              {t.httpStatus != null ? ` · http: ${t.httpStatus}` : ""}
              {t.latencyMs != null ? ` · latency: ${t.latencyMs}ms` : ""}
              {t.error ? ` · ${t.error}` : ""}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function OAuthModal({
  oauth,
  paste,
  setPaste,
  busy,
  onSubmit,
  onCancel,
}: {
  oauth: OAuthSession;
  paste: string;
  setPaste: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-1 shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-[13px] font-semibold text-fg">
            Connect {oauth.provider}
          </h3>
          <HubBtn onClick={onCancel}>Cancel</HubBtn>
        </div>
        <div className="space-y-4 p-4">
          {oauth.flowType === "device_code" ? (
            <div className="text-center">
              <p className="text-[11px] text-muted">Enter this code in the browser</p>
              <p className="mt-2 font-mono text-[22px] font-bold tracking-widest text-fg">
                {oauth.userCode || "—"}
              </p>
              {oauth.verificationUri ? (
                <p className="mt-2 break-all font-mono text-[10px] text-accent-soft">
                  {oauth.verificationUri}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Waiting for popup authorization…
              </div>
              <div className="relative text-center text-[9.5px] font-semibold tracking-wide text-muted uppercase">
                <span className="relative z-10 bg-surface-1 px-2">
                  or paste callback URL manually
                </span>
                <span className="absolute inset-x-0 top-1/2 border-t border-border" />
              </div>
              {oauth.authUrl ? (
                <div>
                  <div className="mb-1 text-[10.5px] font-medium text-fg">
                    Step 1: Open this URL in your browser
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={oauth.authUrl}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-surface-0 px-2.5 py-1.5 font-mono text-[10px] text-fg"
                    />
                    <HubBtn
                      onClick={() =>
                        void navigator.clipboard?.writeText(oauth.authUrl || "")
                      }
                    >
                      Copy
                    </HubBtn>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="mb-1 text-[10.5px] font-medium text-fg">
                  Step 2: Paste the callback URL here
                </div>
                <p className="mb-1 text-[10px] text-muted">
                  After authorization, copy the full URL from your browser.
                </p>
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  rows={2}
                  placeholder="http://localhost:…/callback?code=…"
                  className="w-full rounded-lg border border-border bg-surface-0 px-2.5 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <HubBtn onClick={onCancel}>Cancel</HubBtn>
          {oauth.flowType !== "device_code" ? (
            <HubBtn
              variant="primary"
              disabled={busy || !paste.trim()}
              onClick={onSubmit}
            >
              Connect
            </HubBtn>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Combos ────────────────────────────────────────────────── */

function CombosHome({
  combos,
  models,
  busy,
  showCreate,
  setShowCreate,
  editingId,
  comboName,
  setComboName,
  comboKind,
  setComboKind,
  comboPicks,
  setComboPicks,
  onSave,
  onEdit,
  onDelete,
  onKindChange,
  capacity,
  onCapacityChange,
}: {
  combos: Combo[];
  models: HubModel[];
  busy: boolean;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  editingId: string | null;
  comboName: string;
  setComboName: (v: string) => void;
  comboKind: "fallback" | "round-robin" | "fusion";
  setComboKind: (v: "fallback" | "round-robin" | "fusion") => void;
  comboPicks: string[];
  setComboPicks: React.Dispatch<React.SetStateAction<string[]>>;
  onSave: () => void;
  onEdit: (c: Combo) => void;
  onDelete: (id: string) => void;
  onKindChange: (id: string, kind: "fallback" | "round-robin" | "fusion") => void;
  capacity: CapacityAdapter;
  onCapacityChange: (next: CapacityAdapter) => void;
}) {
  const [disabledMap, setDisabledMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await hubApi().modelHubFetchDisabledModels?.();
      if (!cancelled && r?.ok && r.disabled) {
        setDisabledMap(r.disabled);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCreate]);

  const availableModelsForPicker = useMemo(() => {
    return models.filter((m) => {
      const slash = m.id.indexOf("/");
      const prefix = slash > 0 ? m.id.slice(0, slash) : (m.owned_by || "");
      const bare = slash > 0 ? m.id.slice(slash + 1) : m.id;

      const keysToCheck = [
        prefix,
        m.owned_by,
        prefix === "ag" ? "antigravity" : undefined,
        prefix === "antigravity" ? "ag" : undefined,
        prefix === "cx" ? "codex" : undefined,
        prefix === "codex" ? "cx" : undefined,
        prefix === "cu" ? "cursor" : undefined,
        prefix === "cursor" ? "cu" : undefined,
        prefix === "kr" ? "kiro" : undefined,
        prefix === "kiro" ? "kr" : undefined,
        prefix === "gh" ? "github" : undefined,
        prefix === "github" ? "gh" : undefined,
      ].filter(Boolean) as string[];

      for (const k of keysToCheck) {
        const list = disabledMap[k];
        if (Array.isArray(list)) {
          if (list.includes(bare) || list.includes(m.id)) return false;
        }
      }
      return true;
    });
  }, [models, disabledMap]);
  return (
    <div>
      <HubPageHeader
        title="Combos"
        subtitle="Model combos with fallback."
        actions={
          <HubBtn variant="primary" onClick={() => setShowCreate(true)}>
            + Create Combo
          </HubBtn>
        }
      />
      <p className="mb-4 text-[11px] text-muted">
        Strategies: <strong className="text-fg-dim">Fallback</strong>,{" "}
        <strong className="text-fg-dim">Round Robin</strong>,{" "}
        <strong className="text-fg-dim">Fusion</strong>.
      </p>

      {!combos.length ? (
        <EmptyDash>No combos yet — create one to use as AGENT_MODEL.</EmptyDash>
      ) : (
        <ul className="flex flex-col gap-3">
          {combos.map((c) => {
            const list = c.models || [];
            const shown = list.slice(0, 3);
            const more = Math.max(0, list.length - shown.length);
            const kind =
              c.kind === "fallback" || c.kind === "fusion" || c.kind === "round-robin"
                ? c.kind
                : "round-robin";
            return (
              <li
                key={c.id || c.name}
                className="rounded-xl border border-border bg-surface-1 p-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent-soft">
                    ◆
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-fg">{c.name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {shown.length ? (
                        shown.map((m) => (
                          <span
                            key={m}
                            className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg"
                          >
                            {m}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted italic">No models</span>
                      )}
                      {more > 0 ? (
                        <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent-soft">
                          +{more} more
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <select
                        disabled={busy || !c.id}
                        value={kind}
                        onChange={(e) =>
                          c.id &&
                          onKindChange(
                            c.id,
                            e.target.value as "fallback" | "round-robin" | "fusion",
                          )
                        }
                        className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-[11px] text-fg"
                      >
                        <option value="fallback">Fallback — try next on error</option>
                        <option value="round-robin">Round Robin — rotate</option>
                        <option value="fusion">Fusion — merge</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <HubBtn
                      onClick={() =>
                        void navigator.clipboard?.writeText(c.name || "")
                      }
                    >
                      Copy
                    </HubBtn>
                    {c.id ? (
                      <HubBtn disabled={busy} onClick={() => onEdit(c)}>
                        Edit
                      </HubBtn>
                    ) : null}
                    {c.id ? (
                      <HubBtn
                        variant="danger"
                        disabled={busy}
                        onClick={() => onDelete(c.id!)}
                      >
                        Delete
                      </HubBtn>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <VisionAdapterPanel
        models={models}
        capacity={capacity}
        busy={busy}
        onChange={onCapacityChange}
      />

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-1 shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-[13px] font-semibold text-fg">
                {editingId ? "Edit Combo" : "Create Combo"}
              </h3>
              <HubBtn onClick={() => setShowCreate(false)}>Close</HubBtn>
            </div>
            <div className="space-y-3 p-4">
              <input
                value={comboName}
                onChange={(e) => setComboName(e.target.value)}
                placeholder="combo-name"
                className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-accent/50"
              />
              <div className="flex flex-wrap gap-2">
                {(["fallback", "round-robin", "fusion"] as const).map((k) => (
                  <HubBtn
                    key={k}
                    variant={comboKind === k ? "primary" : "ghost"}
                    onClick={() => setComboKind(k)}
                  >
                    {k}
                  </HubBtn>
                ))}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-border bg-surface-0 p-2">
                {availableModelsForPicker.length === 0 ? (
                  <p className="text-[11px] text-muted">No enabled models available.</p>
                ) : (
                  <ul className="space-y-1">
                    {availableModelsForPicker.map((m) => {
                      const on = comboPicks.includes(m.id);
                      return (
                        <li key={m.id}>
                          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setComboPicks((prev) =>
                                  on
                                    ? prev.filter((x) => x !== m.id)
                                    : [...prev, m.id],
                                )
                              }
                            />
                            <span className="font-mono">{m.id}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <HubBtn onClick={() => setShowCreate(false)}>Cancel</HubBtn>
              <HubBtn
                variant="primary"
                disabled={busy || !comboName.trim() || !comboPicks.length}
                onClick={onSave}
              >
                {editingId ? "Save" : "Create"}
              </HubBtn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VisionAdapterPanel({
  models,
  capacity,
  busy,
  onChange,
}: {
  models: HubModel[];
  capacity: CapacityAdapter;
  busy: boolean;
  onChange: (next: CapacityAdapter) => void;
}) {
  const [picking, setPicking] = useState<"vision" | "audioInput" | null>(null);

  const rows: Array<{ key: "vision" | "audioInput"; label: string }> = [
    { key: "vision", label: "Vision — images" },
    { key: "audioInput", label: "Audio — Audio input" },
  ];

  const updateCap = (key: "vision" | "audioInput", patch: Partial<CapacityCap>) => {
    onChange({
      ...capacity,
      [key]: { ...capacity[key], ...patch },
    });
  };

  return (
    <HubSection
      title="Vision Adapter"
      hint="Your model can't read image/audio? Auto-switches to a model in the pool below."
    >
      <div className="space-y-2 rounded-xl border border-border bg-surface-1 p-3">
        {rows.map(({ key, label }) => {
          const cap = capacity[key];
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-surface-0 px-2.5 py-2"
            >
              <Toggle
                on={cap.enabled}
                disabled={busy}
                label={label}
                onChange={(v) => updateCap(key, { enabled: v })}
              />
              <span className="w-28 text-[10.5px] text-muted">{label}</span>
              <div className="min-w-[160px] flex-1">
                {cap.models.length === 0 ? (
                  <span className="font-mono text-[11px] text-muted">No models</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {cap.models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={busy}
                        title="Remove"
                        onClick={() =>
                          updateCap(key, {
                            models: cap.models.filter((x) => x !== m),
                          })
                        }
                        className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg hover:border-danger/40"
                      >
                        {m} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Toggle
                on={cap.roundRobin}
                disabled={busy || !cap.enabled}
                label={`${label} round robin`}
                onChange={(v) => updateCap(key, { roundRobin: v })}
              />
              <span className="text-[10px] text-muted">Round</span>
              <HubBtn
                disabled={busy || !cap.enabled}
                onClick={() => setPicking(picking === key ? null : key)}
              >
                + Add Model
              </HubBtn>
              {picking === key ? (
                <select
                  className="w-full rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    if (!cap.models.includes(id)) {
                      updateCap(key, { models: [...cap.models, id] });
                    }
                    setPicking(null);
                  }}
                >
                  <option value="">Pick model…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          );
        })}
        <p className="text-[10px] text-muted">
          Tersimpan ke Model Hub <code className="text-fg-dim">capacityAdapter</code> —
          dipakai otomatis saat request butuh vision/audio.
        </p>
      </div>
    </HubSection>
  );
}

/* ── Usage ─────────────────────────────────────────────────── */

type NetworkProviderNode = {
  id: string;
  label: string;
  requests: number;
  accounts: number;
  activeAccounts: number;
  connected: boolean;
  lit: boolean;
};

function buildNetworkProviders(
  connections: Connection[],
  byProvider: Record<string, { requests?: number }>,
): NetworkProviderNode[] {
  const byId = new Map<string, NetworkProviderNode>();

  for (const c of connections) {
    const id = String(c.provider || "").trim().toLowerCase();
    if (!id) continue;
    const cur = byId.get(id) || {
      id,
      label: c.provider || id,
      requests: 0,
      accounts: 0,
      activeAccounts: 0,
      connected: true,
      lit: false,
    };
    cur.accounts += 1;
    if (c.isActive !== false) cur.activeAccounts += 1;
    byId.set(id, cur);
  }

  for (const [rawName, v] of Object.entries(byProvider)) {
    const id = String(rawName || "").trim().toLowerCase();
    if (!id) continue;
    const req = v.requests || 0;
    const cur = byId.get(id) || {
      id,
      label: rawName,
      requests: 0,
      accounts: 0,
      activeAccounts: 0,
      connected: false,
      lit: false,
    };
    cur.requests += req;
    if (req > 0) cur.lit = true;
    byId.set(id, cur);
  }

  for (const node of byId.values()) {
    if (node.requests > 0) node.lit = true;
  }

  return [...byId.values()].sort((a, b) => {
    if (b.requests !== a.requests) return b.requests - a.requests;
    if (b.activeAccounts !== a.activeAccounts) return b.activeAccounts - a.activeAccounts;
    return a.label.localeCompare(b.label);
  });
}

function UsageNetworkGraph({
  byProvider,
  connections,
}: {
  byProvider: Record<string, { requests?: number }>;
  connections: Connection[];
}) {
  const providers = buildNetworkProviders(connections, byProvider).slice(0, 14);
  const totalReq = providers.reduce((s, p) => s + p.requests, 0);
  const W = 560;
  const H = Math.max(200, 56 + providers.length * 34);
  const ax = 72;
  const ay = H / 2;
  const px = W - 140;

  if (!providers.length) {
    return (
      <div className="flex min-h-[160px] items-center justify-center text-[11px] text-muted">
        Belum ada provider terkoneksi — connect OAuth/API key dulu.
      </div>
    );
  }

  return (
    <div className="hub-network relative min-h-[160px] overflow-hidden rounded-lg bg-surface-0/60">
      <div className="absolute top-2 right-2 z-[1] text-[9.5px] text-muted">
        {providers.filter((p) => p.lit).length}/{providers.length} lit · semua
        koneksi ditampilkan
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        <defs>
          <linearGradient id="hubEdgeGradLit" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id="hubEdgeGradIdle" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-muted)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-border)" stopOpacity="0.7" />
          </linearGradient>
          <filter id="hubGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {providers.map((p, i) => {
          const py =
            providers.length === 1
              ? H / 2
              : 40 + (i * (H - 80)) / Math.max(1, providers.length - 1);
          const weight =
            p.lit && totalReq > 0
              ? Math.max(0.3, p.requests / totalReq)
              : 0.12;
          const strokeW = p.lit ? 1.4 + weight * 4 : 1;
          const midX = (ax + px) / 2;
          const midY = (ay + py) / 2 + (i % 2 === 0 ? -10 : 10);
          const d = `M ${ax} ${ay} Q ${midX} ${midY} ${px} ${py}`;
          const inactive = p.connected && p.activeAccounts === 0;
          return (
            <g key={p.id} opacity={inactive ? 0.45 : 1}>
              <path
                d={d}
                fill="none"
                stroke={p.lit ? "url(#hubEdgeGradLit)" : "url(#hubEdgeGradIdle)"}
                strokeWidth={strokeW}
                strokeLinecap="round"
                opacity={p.lit ? 0.4 + weight * 0.55 : 0.35}
                filter={p.lit ? "url(#hubGlow)" : undefined}
                className={p.lit ? "hub-network-edge" : undefined}
                strokeDasharray={p.lit ? undefined : "3 6"}
              />
              <circle
                cx={px}
                cy={py}
                r={p.lit ? 3 + weight * 3 : 2.5}
                className={p.lit ? "hub-network-pulse" : undefined}
                fill={p.lit ? "var(--color-accent)" : "var(--color-muted)"}
                opacity={p.lit ? 0.95 : 0.55}
              />
              <foreignObject x={px + 10} y={py - 16} width={128} height={32}>
                <div
                  className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${
                    p.lit
                      ? "border-accent/40 bg-surface-2/95 text-fg shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]"
                      : "border-border bg-surface-1/90 text-muted"
                  }`}
                >
                  {p.label}{" "}
                  <span
                    className={`font-mono ${p.lit ? "text-accent-soft" : "text-muted"}`}
                  >
                    ({p.requests})
                  </span>
                  {p.accounts > 0 ? (
                    <span className="ml-1 text-[9px] text-muted">
                      · {p.activeAccounts}/{p.accounts} akun
                    </span>
                  ) : null}
                </div>
              </foreignObject>
            </g>
          );
        })}
        <circle
          cx={ax}
          cy={ay}
          r={22}
          fill="var(--color-accent)"
          filter="url(#hubGlow)"
          className="hub-network-agent"
        />
        <text
          x={ax}
          y={ay + 4}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#062028"
        >
          Agent
        </text>
      </svg>
    </div>
  );
}

function UsageHome({
  period,
  setPeriod,
  tab,
  setTab,
  data,
  chart,
  connections,
}: {
  period: string;
  setPeriod: (p: string) => void;
  tab: "overview" | "details";
  setTab: (t: "overview" | "details") => void;
  data: Record<string, unknown> | null;
  chart: Array<{ label: string; tokens: number; cost: number }>;
  connections: Connection[];
}) {
  const recent = (Array.isArray(data?.recentRequests)
    ? data!.recentRequests
    : []) as Array<{
    timestamp?: string;
    model?: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
  }>;
  const byModel = (data?.byModel && typeof data.byModel === "object"
    ? data.byModel
    : {}) as Record<
    string,
    {
      requests?: number;
      provider?: string;
      rawModel?: string;
      lastUsed?: string;
      cost?: number;
      promptCost?: number;
      completionCost?: number;
      cachedCost?: number;
    }
  >;
  const byProvider = (data?.byProvider && typeof data.byProvider === "object"
    ? data.byProvider
    : {}) as Record<string, { requests?: number }>;
  const maxTok = Math.max(1, ...chart.map((b) => b.tokens || 0), 1);

  return (
    <div>
      <HubPageHeader
        title="Usage & Analytics"
        subtitle="Monitor your API usage and costs"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["overview", "details"] as const).map((t) => (
          <HubBtn
            key={t}
            variant={tab === t ? "primary" : "ghost"}
            onClick={() => setTab(t)}
          >
            {t === "overview" ? "Overview" : "Details"}
          </HubBtn>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {(["today", "24h", "7d", "30d", "all"] as const).map((p) => (
          <HubBtn
            key={p}
            variant={period === p ? "soft" : "ghost"}
            onClick={() => setPeriod(p)}
          >
            {p === "today" ? "Today" : p.toUpperCase()}
          </HubBtn>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          ["TOTAL REQUESTS", data?.totalRequests, "text-fg"],
          ["TOTAL INPUT TOKENS", data?.totalPromptTokens, "text-accent-soft"],
          ["CACHED TOKENS", data?.totalCachedTokens, "text-secondary"],
          ["OUTPUT TOKENS", data?.totalCompletionTokens, "text-success"],
          ["EST. COST", fmtCost(data?.totalCost), "text-warn"],
        ].map(([label, val, color]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-border bg-surface-1 px-3 py-3"
          >
            <div className="text-[9.5px] font-semibold tracking-wide text-muted">
              {String(label)}
            </div>
            <div className={`mt-1 font-mono text-[18px] font-semibold ${color}`}>
              {typeof val === "string" ? val : fmt(val)}
            </div>
          </div>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="mb-4 grid gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-border bg-surface-1 p-3 lg:col-span-3">
            <div className="mb-2 text-[10px] font-semibold text-muted">
              Network · Agent → providers
            </div>
            <UsageNetworkGraph byProvider={byProvider} connections={connections} />
          </div>
          <div className="rounded-xl border border-border bg-surface-1 p-3 lg:col-span-2">
            <div className="mb-2 text-[10px] font-semibold tracking-wide text-muted">
              RECENT REQUESTS
            </div>
            <ul className="max-h-[200px] space-y-2 overflow-y-auto">
              {recent.length === 0 ? (
                <li className="text-[11px] text-muted">No recent requests</li>
              ) : (
                recent.slice(0, 12).map((r, i) => (
                  <li
                    key={`${r.timestamp}-${i}`}
                    className="flex items-start justify-between gap-2 border-b border-border/50 pb-1.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] text-fg">
                        {r.model || "?"}
                      </div>
                      <div className="text-[9.5px] capitalize text-muted">
                        {r.provider || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10px]">
                      <div className="text-danger">↑ {r.promptTokens ?? 0}</div>
                      <div className="text-success">
                        ↓ {r.completionTokens ?? 0}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-border bg-surface-1 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold text-muted">Tokens</div>
          <div className="font-mono text-[9.5px] text-muted">
            peak {maxTok.toLocaleString()}
          </div>
        </div>
        {chart.length === 0 ? (
          <EmptyDash>No chart data for this period.</EmptyDash>
        ) : (
          <div className="flex h-28 items-end gap-0.5">
            {chart.map((b, i) => (
              <div
                key={`${b.label}-${i}`}
                title={`${b.label}: ${b.tokens} tok`}
                className="min-w-0 flex-1 rounded-t bg-accent/80"
                style={{
                  height: `${Math.max(2, Math.round((b.tokens / maxTok) * 100))}%`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <HubSection title="Usage by Model">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface-1">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="border-b border-border text-[9.5px] tracking-wide text-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Model</th>
                <th className="px-3 py-2 font-semibold">Provider</th>
                <th className="px-3 py-2 font-semibold">Requests</th>
                <th className="px-3 py-2 font-semibold">Last used</th>
                <th className="px-3 py-2 font-semibold">Total cost</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(byModel).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted">
                    No model usage yet
                  </td>
                </tr>
              ) : (
                Object.entries(byModel)
                  .sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0))
                  .map(([id, row]) => (
                    <tr key={id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 font-mono text-fg">
                        {row.rawModel || id}
                      </td>
                      <td className="px-3 py-2 capitalize text-muted">
                        {row.provider || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-fg">
                        {row.requests ?? 0}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {row.lastUsed
                          ? new Date(row.lastUsed).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-warn">
                        {fmtCost(row.cost)}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </HubSection>
    </div>
  );
}

/* ── Quota ─────────────────────────────────────────────────── */

function QuotaHome({
  quotas,
  busy,
  onRefresh,
  onDelete,
}: {
  quotas: Array<{ connection: Connection; data?: unknown; error?: string }>;
  busy: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <HubPageHeader
        title="Quota Tracker"
        subtitle="Track and manage your API quota limits"
        actions={<HubBtn onClick={onRefresh}>Refresh</HubBtn>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <HubBtn disabled>All Providers</HubBtn>
        <HubBtn disabled>All accounts</HubBtn>
        <HubBtn disabled>Expiring first</HubBtn>
        <HubBtn variant="danger" disabled>
          Turn off Empty
        </HubBtn>
        <HubBtn variant="soft" disabled>
          Turn on Available
        </HubBtn>
      </div>

      {!quotas.length ? (
        <EmptyDash>
          No connections — connect OAuth providers first to track quotas.
        </EmptyDash>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {quotas.map((row) => (
            <QuotaCard
              key={row.connection.id || row.connection.email}
              row={row}
              busy={busy}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuotaCard({
  row,
  busy,
  onDelete,
}: {
  row: { connection: Connection; data?: unknown; error?: string };
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  const c = row.connection;
  const parsed = parseQuotaRows(row.data);
  const dataObj =
    row.data && typeof row.data === "object"
      ? (row.data as Record<string, unknown>)
      : null;
  const apiMessage =
    typeof dataObj?.message === "string" ? dataObj.message : null;
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-[11px] font-bold text-accent-soft">
          {(c.provider || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold capitalize text-fg">
            {c.provider}
          </div>
          <div className="truncate text-[10.5px] text-muted">{connLabel(c)}</div>
        </div>
        {c.id ? (
          <HubBtn
            variant="danger"
            disabled={busy}
            onClick={() => onDelete(c.id!)}
          >
            Delete
          </HubBtn>
        ) : null}
        <Toggle on disabled />
      </div>
      {row.error ? (
        <p className="text-[10.5px] text-danger">{row.error}</p>
      ) : parsed.length === 0 ? (
        <div className="space-y-1">
          {apiMessage ? (
            <p className="text-[10.5px] text-warn">{apiMessage}</p>
          ) : null}
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[9.5px] text-muted">
            {JSON.stringify(row.data ?? {}, null, 2).slice(0, 600)}
          </pre>
        </div>
      ) : (
        <ul className="space-y-2">
          <li className="text-[10px] text-muted">{parsed.length} quotas</li>
          {parsed.slice(0, 10).map((q) => {
            const tone =
              q.pctRemaining <= 5
                ? "danger"
                : q.pctRemaining <= 25
                  ? "warn"
                  : "ok";
            return (
              <li key={q.name} className="space-y-1">
                <div className="flex items-center gap-2 text-[10.5px]">
                  <StatusDot tone={tone} />
                  <span className="min-w-0 flex-1 truncate text-fg">{q.name}</span>
                  <span className="font-mono text-muted">
                    {q.used}/{q.total}
                  </span>
                  <span className="w-14 text-right font-mono text-muted">
                    {q.pctRemaining}% left
                  </span>
                </div>
                <ProgressBar pct={q.pctRemaining} tone={tone} />
                {q.resetLabel ? (
                  <div className="text-[9.5px] text-muted">{q.resetLabel}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function parseQuotaRows(data: unknown): Array<{
  name: string;
  used: number | string;
  total: number | string;
  pctRemaining: number;
  resetLabel?: string;
}> {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  // Prefer top-level quotas; some providers nest under message/error payloads.
  const quotas =
    d.quotas && typeof d.quotas === "object"
      ? (d.quotas as Record<
          string,
          {
            remaining?: number;
            remainingPercentage?: number;
            used?: number;
            total?: number;
            resetAt?: string;
            unlimited?: boolean;
            displayName?: string;
          }
        >)
      : null;
  if (!quotas || Object.keys(quotas).length === 0) return [];
  return Object.entries(quotas).map(([name, q]) => {
    const totalNum = typeof q.total === "number" ? q.total : null;
    const usedNum =
      typeof q.used === "number"
        ? q.used
        : totalNum != null && typeof q.remaining === "number" && q.remaining <= totalNum
          ? Math.max(0, totalNum - q.remaining)
          : null;

    let pctRemaining = 100;
    if (typeof q.remainingPercentage === "number" && Number.isFinite(q.remainingPercentage)) {
      // Antigravity / Gemini / most hub providers expose this 0–100 field.
      pctRemaining = Math.round(Math.max(0, Math.min(100, q.remainingPercentage)));
    } else if (
      typeof q.remaining === "number" &&
      totalNum != null &&
      totalNum > 0 &&
      q.remaining <= totalNum
    ) {
      // Absolute remaining (Codex windows use remaining of 100).
      pctRemaining = Math.round((q.remaining / totalNum) * 100);
    } else if (
      typeof q.remaining === "number" &&
      q.remaining >= 0 &&
      q.remaining <= 100 &&
      (totalNum == null || totalNum === 100)
    ) {
      // remaining already a percentage 0–100
      pctRemaining = Math.round(q.remaining);
    } else if (usedNum != null && totalNum != null && totalNum > 0) {
      pctRemaining = Math.round(Math.max(0, Math.min(100, ((totalNum - usedNum) / totalNum) * 100)));
    } else if (q.unlimited) {
      pctRemaining = 100;
    } else if (typeof q.remaining === "number" && q.remaining === 0) {
      pctRemaining = 0;
    }

    const total = q.unlimited ? "∞" : (q.total ?? "—");
    const used = usedNum != null ? usedNum : q.used != null ? q.used : "—";

    return {
      name: q.displayName || name,
      used,
      total,
      pctRemaining,
      resetLabel: q.resetAt
        ? `resets ${new Date(q.resetAt).toLocaleString()}`
        : undefined,
    };
  });
}
