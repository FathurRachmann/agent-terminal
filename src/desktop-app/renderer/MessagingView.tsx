import React, { useEffect, useMemo, useState } from "react";
import {
  formatAllowedUsersCsv,
  parseAllowedUsersCsv,
  type MessagingConfig,
} from "../messaging-shared.js";

type WaStatus = {
  status: "disconnected" | "connecting" | "qr" | "connected" | "error";
  enabled: boolean;
  hasAuth: boolean;
  me?: string | null;
  lastError?: string | null;
  qrDataUrl?: string | null;
};

type MessagingEvent =
  | { type: "status"; payload: WaStatus }
  | { type: "qr"; payload: { qrDataUrl: string } }
  | { type: "error"; payload: { message: string } }
  | {
      type: "message_in";
      payload: { jid: string; pushName?: string; text: string };
    }
  | {
      type: "message_out";
      payload: { jid: string; text: string; ok: boolean; error?: string };
    }
  | { type: "ignored"; payload: { jid: string; reason: string } };

type PlatformId =
  | "whatsapp"
  | "discord"
  | "slack"
  | "telegram"
  | "signal"
  | "email";

const PLATFORMS: Array<{
  id: PlatformId;
  name: string;
  ready: boolean;
  blurb: string;
}> = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    ready: true,
    blurb: "QR bridge lokal (Baileys).",
  },
  {
    id: "discord",
    name: "Discord",
    ready: false,
    blurb: "Coming soon",
  },
  {
    id: "slack",
    name: "Slack",
    ready: false,
    blurb: "Coming soon",
  },
  {
    id: "telegram",
    name: "Telegram",
    ready: false,
    blurb: "Coming soon",
  },
  {
    id: "signal",
    name: "Signal",
    ready: false,
    blurb: "Coming soon",
  },
  {
    id: "email",
    name: "Email",
    ready: false,
    blurb: "Coming soon",
  },
];

type LogRow = { id: string; at: string; text: string; tone?: "ok" | "warn" | "err" };

type Props = {
  onClose?: () => void;
};

function statusBadges(wa: WaStatus | null, enabled: boolean) {
  const badges: Array<{ label: string; className: string }> = [];
  if (!enabled) {
    badges.push({
      label: "Disabled",
      className: "border-border bg-surface-2 text-muted",
    });
  } else {
    badges.push({
      label: "Enabled",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    });
  }
  if (!wa?.hasAuth && wa?.status !== "connected") {
    badges.push({
      label: "Needs setup",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    });
  }
  if (wa?.status === "connected") {
    badges.push({
      label: "Connected",
      className: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    });
  } else if (wa?.status === "qr") {
    badges.push({
      label: "Scan QR",
      className: "border-accent/40 bg-accent/10 text-accent-soft",
    });
  } else if (wa?.status === "connecting") {
    badges.push({
      label: "Connecting",
      className: "border-border bg-surface-2 text-fg-dim",
    });
  } else if (wa?.status === "error") {
    badges.push({
      label: "Error",
      className: "border-danger/40 bg-[#2a1518] text-danger",
    });
  }
  return badges;
}

export function MessagingView({ onClose }: Props) {
  const [platform, setPlatform] = useState<PlatformId>("whatsapp");
  const [enabled, setEnabled] = useState(false);
  const [usersCsv, setUsersCsv] = useState("");
  const [friendsCsv, setFriendsCsv] = useState("");
  const [concise, setConcise] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [wa, setWa] = useState<WaStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);

  const pushLog = (text: string, tone?: LogRow["tone"]) => {
    setLogs((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          at: new Date().toLocaleTimeString(),
          text,
          tone,
        },
        ...prev,
      ].slice(0, 40),
    );
  };

  const hydrate = (config: MessagingConfig, status: WaStatus) => {
    setEnabled(config.whatsapp.enabled);
    setUsersCsv(formatAllowedUsersCsv(config.whatsapp.users));
    setFriendsCsv(formatAllowedUsersCsv(config.whatsapp.friends));
    setConcise(config.whatsapp.conciseReplies);
    setWa(status);
    setQr(status.qrDataUrl ?? null);
    setDirty(false);
  };

  const refresh = async () => {
    if (!window.electronAgent?.getMessagingConfig) {
      setError("Messaging bridge missing. Rebuild desktop app.");
      return;
    }
    try {
      const res = await window.electronAgent.getMessagingConfig();
      if (!res.ok || !res.config || !res.whatsapp) {
        setError(res.error || "Failed to load messaging config");
        return;
      }
      hydrate(res.config, res.whatsapp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!window.electronAgent?.onMessagingEvent) return;
    return window.electronAgent.onMessagingEvent((raw) => {
      const event = raw as MessagingEvent;
      if (event.type === "status") {
        setWa(event.payload);
        if (event.payload.qrDataUrl) setQr(event.payload.qrDataUrl);
        if (event.payload.status === "connected") setQr(null);
      } else if (event.type === "qr") {
        setQr(event.payload.qrDataUrl);
        setWa((prev) =>
          prev
            ? { ...prev, status: "qr", qrDataUrl: event.payload.qrDataUrl }
            : prev,
        );
      } else if (event.type === "error") {
        setError(event.payload.message);
        pushLog(event.payload.message, "err");
      } else if (event.type === "message_in") {
        pushLog(
          `← ${event.payload.pushName || event.payload.jid}: ${event.payload.text.slice(0, 120)}`,
          "ok",
        );
      } else if (event.type === "message_out") {
        pushLog(
          event.payload.ok
            ? `→ ${event.payload.jid}: ${event.payload.text.slice(0, 120)}`
            : `→ failed: ${event.payload.error}`,
          event.payload.ok ? "ok" : "err",
        );
      } else if (event.type === "ignored") {
        pushLog(`ignored ${event.payload.jid}: ${event.payload.reason}`, "warn");
      }
    });
  }, []);

  const badges = useMemo(
    () => statusBadges(wa, enabled),
    [wa, enabled],
  );

  const save = async () => {
    if (!window.electronAgent?.saveMessagingConfig) return;
    setBusy(true);
    try {
      const res = await window.electronAgent.saveMessagingConfig({
        version: 1,
        whatsapp: {
          enabled,
          users: parseAllowedUsersCsv(usersCsv),
          friends: parseAllowedUsersCsv(friendsCsv),
          conciseReplies: concise,
        },
      });
      if (!res.ok || !res.config || !res.whatsapp) {
        setError(res.error || "Save failed");
        return;
      }
      hydrate(res.config, res.whatsapp);
      pushLog("Config saved", "ok");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!window.electronAgent?.whatsappStart) return;
    setBusy(true);
    setError(null);
    try {
      if (dirty) await save();
      const res = await window.electronAgent.whatsappStart();
      if (!res.ok) setError(res.error || "Failed to start WhatsApp");
      else pushLog("WhatsApp bridge starting…", "ok");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!window.electronAgent?.whatsappStop) return;
    setBusy(true);
    try {
      await window.electronAgent.whatsappStop();
      setQr(null);
      pushLog("WhatsApp disconnected", "warn");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!window.electronAgent?.whatsappLogout) return;
    setBusy(true);
    try {
      const res = await window.electronAgent.whatsappLogout();
      if (!res.ok) setError(res.error || "Logout failed");
      else {
        setQr(null);
        pushLog("Logged out — scan QR again to reconnect", "warn");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-surface-1">
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          <div>
            <div className="text-[11px] font-semibold text-fg">Messaging</div>
            <div className="text-[9.5px] text-muted">Gateway platforms</div>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-2 py-0.5 text-[9.5px] text-muted hover:text-fg"
            >
              Close
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {PLATFORMS.map((p) => {
            const active = platform === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={`mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition ${
                  active
                    ? "border-accent/35 bg-surface-3"
                    : "border-transparent hover:bg-surface-2"
                } ${p.ready ? "" : "opacity-55"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-fg">{p.name}</span>
                  {!p.ready ? (
                    <span className="text-[8px] uppercase tracking-wide text-muted">
                      Soon
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[9.5px] text-muted">{p.blurb}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-0">
        {platform !== "whatsapp" ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-muted">
            {PLATFORMS.find((p) => p.id === platform)?.name} belum tersedia.
            Fase 1 hanya WhatsApp.
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b border-border px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[15px] font-semibold text-fg">WhatsApp</h1>
                {badges.map((b) => (
                  <span
                    key={b.label}
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${b.className}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-muted">
                Pakai Agent lewat WhatsApp bridge lokal (QR auth). Tambahkan nomor
                yang diizinkan, Save, lalu Start &amp; scan QR.
              </p>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                <div className="space-y-4">
                  <section className="rounded-xl border border-border bg-surface-1 p-4">
                    <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
                      Get connected
                    </div>
                    <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-fg-dim">
                      <li>
                        Isi nomor <span className="text-fg">User</span> (full)
                        dan/atau <span className="text-fg">Friends</span>{" "}
                        (guardrail).
                      </li>
                      <li>Centang Enable WhatsApp, lalu Save changes.</li>
                      <li>Klik Start bridge — scan QR dari WhatsApp di HP.</li>
                      <li>
                        Kirim pesan dari nomor tersebut; Agent membalas sesuai
                        role.
                      </li>
                    </ol>
                  </section>

                  <section className="rounded-xl border border-border bg-surface-1 p-4">
                    <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
                      Required
                    </div>
                    <label className="mb-3 flex items-center gap-2 text-[11px] text-fg">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          setEnabled(e.target.checked);
                          setDirty(true);
                        }}
                      />
                      Enable WhatsApp messaging
                    </label>

                    <div className="mb-1 text-[10.5px] font-medium text-fg">
                      User (full access)
                    </div>
                    <input
                      value={usersCsv}
                      onChange={(e) => {
                        setUsersCsv(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="62812xxxx"
                      className="mb-3 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                    />

                    <div className="mb-1 text-[10.5px] font-medium text-fg">
                      Friends (guardrail)
                    </div>
                    <input
                      value={friendsCsv}
                      onChange={(e) => {
                        setFriendsCsv(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="62813yyyy, 62814zzzz"
                      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-fg outline-none focus:border-accent/50"
                    />
                    <p className="mt-1.5 text-[9.5px] leading-snug text-muted">
                      <span className="text-fg-dim">User</span>: akses penuh
                      tool agent.{" "}
                      <span className="text-fg-dim">Friends</span>: hanya bantu
                      buat dokumen/kode/excel di workspace —{" "}
                      <strong className="font-medium text-fg-dim">
                        dilarang
                      </strong>{" "}
                      shell, akses folder PC, vault, desktop/browser. Nomor
                      internasional lengkap (contoh{" "}
                      <span className="font-mono">62812xxxx</span>). Jika keduanya
                      kosong, semua inbound ditolak.
                    </p>
                  </section>

                  <section className="rounded-xl border border-border bg-surface-1">
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((v) => !v)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-[10px] font-semibold tracking-wider text-muted uppercase"
                    >
                      Advanced (1)
                      <span>{advancedOpen ? "▾" : "▸"}</span>
                    </button>
                    {advancedOpen ? (
                      <div className="border-t border-border px-4 py-3">
                        <label className="flex items-center gap-2 text-[11px] text-fg">
                          <input
                            type="checkbox"
                            checked={concise}
                            onChange={(e) => {
                              setConcise(e.target.checked);
                              setDirty(true);
                            }}
                          />
                          Concise WhatsApp replies
                        </label>
                      </div>
                    ) : null}
                  </section>

                  {error ? (
                    <div className="rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-2 text-[11px] text-danger">
                      {error}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save()}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-surface-0 disabled:opacity-50"
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      disabled={busy || !enabled}
                      onClick={() => void start()}
                      className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] text-accent-soft disabled:opacity-50"
                    >
                      {wa?.status === "connected" ? "Reconnect" : "Start bridge"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || wa?.status === "disconnected"}
                      onClick={() => void stop()}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg-dim disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void logout()}
                      className="rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-1.5 text-[11px] text-danger disabled:opacity-50"
                    >
                      Logout / reset QR
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-surface-1 p-4">
                    <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
                      QR / session
                    </div>
                    {qr ? (
                      <img
                        src={qr}
                        alt="WhatsApp QR"
                        className="mx-auto rounded-lg border border-border bg-white p-2"
                        width={220}
                        height={220}
                      />
                    ) : wa?.status === "connected" ? (
                      <div className="py-8 text-center text-[11px] text-emerald-300">
                        Connected
                        {wa.me ? (
                          <div className="mt-1 font-mono text-[9.5px] text-muted">
                            {wa.me}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-[11px] text-muted">
                        QR muncul setelah Start bridge.
                      </div>
                    )}
                    {wa?.lastError ? (
                      <div className="mt-2 text-[9.5px] leading-snug text-amber-300/90">
                        {wa.lastError}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border bg-surface-1 p-4">
                    <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
                      Activity
                    </div>
                    <div className="max-h-56 space-y-1.5 overflow-y-auto">
                      {logs.length === 0 ? (
                        <div className="text-[10px] text-muted">No events yet</div>
                      ) : (
                        logs.map((row) => (
                          <div
                            key={row.id}
                            className={`rounded border border-border/60 bg-surface-2 px-2 py-1.5 text-[9.5px] leading-snug ${
                              row.tone === "err"
                                ? "text-danger"
                                : row.tone === "warn"
                                  ? "text-amber-300"
                                  : "text-fg-dim"
                            }`}
                          >
                            <span className="mr-1.5 font-mono text-muted">
                              {row.at}
                            </span>
                            {row.text}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
