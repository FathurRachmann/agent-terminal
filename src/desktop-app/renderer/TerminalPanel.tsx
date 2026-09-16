import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type TerminalSessionMeta = {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  pid: number;
};

export type TerminalDeckTab = "terminal" | "pty" | "log";

type Props = {
  open: boolean;
  height: number;
  /** Agent sandbox PTY stream (read-only). */
  ptyLog: string;
  /** Agent/tool event log (read-only). */
  agentLog: string;
  onClearPty: () => void;
  onClearLog: () => void;
  onClose: () => void;
  onResize: (deltaY: number) => void;
};

type ElectronTerminalApi = {
  terminalCreate?: (opts?: {
    cols?: number;
    rows?: number;
  }) => Promise<{
    ok: boolean;
    session?: TerminalSessionMeta;
    error?: string;
  }>;
  terminalWrite?: (
    id: string,
    data: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  terminalResize?: (
    id: string,
    cols: number,
    rows: number,
  ) => Promise<{ ok: boolean; error?: string }>;
  terminalKill?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  terminalList?: () => Promise<{ sessions: TerminalSessionMeta[] }>;
  onTerminalData?: (
    callback: (payload: { id: string; data: string }) => void,
  ) => () => void;
  onTerminalExit?: (
    callback: (payload: {
      id: string;
      exitCode: number;
      signal?: number;
    }) => void,
  ) => () => void;
};

const MAX_BUFFER_CHARS = 400_000;

const DECK_TABS: Array<{ id: TerminalDeckTab; label: string; tip: string }> = [
  { id: "terminal", label: "TERMINAL", tip: "Interactive shell" },
  { id: "pty", label: "PTY", tip: "Agent PTY output" },
  { id: "log", label: "LOG", tip: "Agent status log" },
];

function getApi(): ElectronTerminalApi | undefined {
  return (window as Window & { electronAgent?: ElectronTerminalApi })
    .electronAgent;
}

function appendBuffer(
  buffers: Map<string, string>,
  id: string,
  chunk: string,
): void {
  const prev = buffers.get(id) ?? "";
  const next = prev + chunk;
  buffers.set(
    id,
    next.length <= MAX_BUFFER_CHARS
      ? next
      : next.slice(next.length - MAX_BUFFER_CHARS),
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tip={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted transition hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

function ReadOnlyPane({
  text,
  empty,
}: {
  text: string;
  empty: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!stickRef.current || !preRef.current) return;
    preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={preRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickRef.current = dist < 40;
      }}
      className="absolute inset-0 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-[#c8d1db]"
    >
      {text.trim() ? text : empty}
    </pre>
  );
}

export function TerminalPanel({
  open,
  height,
  ptyLog,
  agentLog,
  onClearPty,
  onClearLog,
  onClose,
  onResize,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const buffersRef = useRef<Map<string, string>>(new Map());
  const creatingRef = useRef(false);
  const openRef = useRef(open);
  const dragging = useRef(false);
  const lastY = useRef(0);

  const [deckTab, setDeckTab] = useState<TerminalDeckTab>("terminal");
  const [sessions, setSessions] = useState<TerminalSessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  activeIdRef.current = activeId;
  openRef.current = open;

  const showBuffer = useCallback((id: string | null) => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    if (!id) return;
    const buf = buffersRef.current.get(id);
    if (buf) term.write(buf);
  }, []);

  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const id = activeIdRef.current;
    if (!term || !fit || !open || deckTab !== "terminal") return;
    try {
      fit.fit();
    } catch {
      /* host may be hidden */
    }
    const api = getApi();
    if (id && api?.terminalResize) {
      void api.terminalResize(id, term.cols, term.rows);
    }
  }, [open, deckTab]);

  const ensureSession = useCallback(async () => {
    const api = getApi();
    if (!api?.terminalCreate || creatingRef.current || !openRef.current) return;
    creatingRef.current = true;
    setBootError(null);
    try {
      const listed = await api.terminalList?.();
      const existing = listed?.sessions ?? [];
      if (existing.length > 0) {
        setSessions(existing);
        setActiveId((cur) => {
          if (cur && existing.some((s) => s.id === cur)) return cur;
          return existing[0]!.id;
        });
        return;
      }
      const cols = termRef.current?.cols ?? 120;
      const rows = termRef.current?.rows ?? 30;
      const res = await api.terminalCreate({ cols, rows });
      if (!res.ok || !res.session) {
        setBootError(res.error || "Failed to start terminal");
        return;
      }
      buffersRef.current.set(res.session.id, "");
      setSessions([res.session]);
      setActiveId(res.session.id);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    } finally {
      creatingRef.current = false;
    }
  }, []);

  const createSession = useCallback(async () => {
    const api = getApi();
    if (!api?.terminalCreate) return;
    const cols = termRef.current?.cols ?? 120;
    const rows = termRef.current?.rows ?? 30;
    const res = await api.terminalCreate({ cols, rows });
    if (!res.ok || !res.session) {
      setBootError(res.error || "Failed to create terminal");
      return;
    }
    setBootError(null);
    buffersRef.current.set(res.session.id, "");
    setSessions((prev) => [...prev, res.session!]);
    setActiveId(res.session.id);
    setDeckTab("terminal");
    termRef.current?.focus();
  }, []);

  const killActive = useCallback(async () => {
    const id = activeIdRef.current;
    const api = getApi();
    if (!id || !api?.terminalKill) return;
    await api.terminalKill(id);
    buffersRef.current.delete(id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const fallback = next[next.length - 1]?.id ?? null;
      setActiveId(fallback);
      if (!fallback && openRef.current) {
        void ensureSession();
      }
      return next;
    });
  }, [ensureSession]);

  const clearScreen = useCallback(() => {
    if (deckTab === "pty") {
      onClearPty();
      return;
    }
    if (deckTab === "log") {
      onClearLog();
      return;
    }
    const id = activeIdRef.current;
    if (id) buffersRef.current.set(id, "");
    termRef.current?.clear();
    termRef.current?.focus();
  }, [deckTab, onClearLog, onClearPty]);

  useEffect(() => {
    if (!hostRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: "#0a0a0b",
        foreground: "#c8c8d0",
        cursor: "#c8c8d0",
        selectionBackground: "#2a3f5f",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fitRef.current = fit;
    termRef.current = term;

    term.onData((data) => {
      const id = activeIdRef.current;
      const api = getApi();
      if (!id || !api?.terminalWrite) return;
      void api.terminalWrite(id, data);
    });

    const api = getApi();
    const unsubData = api?.onTerminalData?.((payload) => {
      appendBuffer(buffersRef.current, payload.id, payload.data);
      if (payload.id === activeIdRef.current) {
        term.write(payload.data);
      }
    });
    const unsubExit = api?.onTerminalExit?.((payload) => {
      const msg = `\r\n\x1b[90m[process exited with code ${payload.exitCode}]\x1b[0m\r\n`;
      appendBuffer(buffersRef.current, payload.id, msg);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== payload.id);
        if (activeIdRef.current === payload.id) {
          term.write(msg);
          const fallback = next[next.length - 1]?.id ?? null;
          setActiveId(fallback);
          if (!fallback && openRef.current) {
            buffersRef.current.delete(payload.id);
            void ensureSession();
          } else if (!fallback) {
            buffersRef.current.delete(payload.id);
          }
        } else {
          buffersRef.current.delete(payload.id);
        }
        return next;
      });
    });

    return () => {
      unsubData?.();
      unsubExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [ensureSession]);

  useEffect(() => {
    if (!open || deckTab !== "terminal") return;
    void ensureSession().then(() => {
      requestAnimationFrame(() => {
        fitAndResize();
        termRef.current?.focus();
      });
    });
  }, [open, deckTab, ensureSession, fitAndResize]);

  useEffect(() => {
    if (!open || deckTab !== "terminal") return;
    fitAndResize();
  }, [open, height, deckTab, fitAndResize]);

  useEffect(() => {
    if (!open) return;
    const onWinResize = () => fitAndResize();
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, [open, fitAndResize]);

  useEffect(() => {
    if (deckTab !== "terminal") return;
    showBuffer(activeId);
    if (open) {
      requestAnimationFrame(() => fitAndResize());
    }
  }, [activeId, open, deckTab, showBuffer, fitAndResize]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dy = e.clientY - lastY.current;
      lastY.current = e.clientY;
      onResize(-dy);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onResize]);

  return (
    <div
      className={`relative flex shrink-0 flex-col border-t border-border bg-surface-0 ${
        open ? "" : "hidden"
      }`}
      style={{ height: open ? height : 0 }}
      aria-hidden={!open}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize terminal"
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            lastY.current = e.clientY;
            document.body.style.cursor = "row-resize";
            document.body.style.userSelect = "none";
          }}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/80 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {DECK_TABS.map((tab) => {
                const active = deckTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-tip={tab.tip}
                    data-tip-pos="bottom"
                    onClick={() => setDeckTab(tab.id)}
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
                      active
                        ? "bg-surface-2 text-fg"
                        : "text-muted hover:text-fg"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
              {deckTab === "terminal" && sessions.length > 1
                ? sessions.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveId(s.id)}
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] ${
                        s.id === activeId
                          ? "bg-accent/20 text-accent"
                          : "text-muted hover:text-fg"
                      }`}
                      data-tip={`Shell session ${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  ))
                : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              data-tip="Hide terminal"
              className="rounded px-2 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-fg"
            >
              ✕
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              ref={hostRef}
              className={`absolute inset-0 px-1 py-1 ${
                deckTab === "terminal" ? "" : "invisible pointer-events-none"
              }`}
            />
            {deckTab === "pty" ? (
              <ReadOnlyPane
                text={ptyLog}
                empty="Waiting for agent PTY / execute output…"
              />
            ) : null}
            {deckTab === "log" ? (
              <ReadOnlyPane
                text={agentLog}
                empty="Agent log is empty — tool runs and status will appear here."
              />
            ) : null}
            {deckTab === "terminal" && bootError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-0/90 px-4 text-center text-[11px] text-[#ffb4b0]">
                {bootError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-l border-border/80 py-2">
          {deckTab === "terminal" ? (
            <IconBtn title="New terminal" onClick={() => void createSession()}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </IconBtn>
          ) : null}
          <IconBtn title="Clear" onClick={clearScreen}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
              <path d="M9 7V4h6v3" />
            </svg>
          </IconBtn>
          {deckTab === "terminal" ? (
            <IconBtn title="Kill terminal" onClick={() => void killActive()}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </IconBtn>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Cap terminal log size to avoid unbounded memory growth. */
export function appendTerminalLog(
  prev: string,
  chunk: string,
  maxChars = 200_000,
): string {
  if (!chunk) return prev;
  const next = prev + chunk;
  if (next.length <= maxChars) return next;
  return next.slice(next.length - maxChars);
}
