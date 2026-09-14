import React, { useEffect, useMemo, useState } from "react";

export type ArtifactCategory = "all" | "images" | "files" | "links";

export type ArtifactRecord = {
  id: string;
  title: string;
  location: string;
  category: "images" | "files" | "links";
  threadId: string;
  sessionPreview: string;
  at: string;
  toolName?: string;
  kind?: string;
  path?: string;
};

type Props = {
  onClose?: () => void;
  onOpenArtifact?: (artifact: ArtifactRecord) => void;
  onOpenSession?: (threadId: string) => void;
};

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function categoryIcon(category: ArtifactRecord["category"]): string {
  if (category === "links") return "🔗";
  if (category === "images") return "🖼";
  return "📄";
}

export function ArtifactsView({ onClose, onOpenArtifact, onOpenSession }: Props) {
  const [tab, setTab] = useState<ArtifactCategory>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ArtifactRecord[]>([]);
  const [counts, setCounts] = useState({
    all: 0,
    images: 0,
    files: 0,
    links: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!window.electronAgent?.listArtifacts) {
      setError("Artifacts bridge missing. Run npm run desktop:start.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await window.electronAgent.listArtifacts();
      setRows(res.artifacts ?? []);
      setCounts(
        res.counts ?? {
          all: res.artifacts?.length ?? 0,
          images: 0,
          files: 0,
          links: 0,
        },
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.category !== tab) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q) ||
        r.sessionPreview.toLowerCase().includes(q) ||
        (r.toolName ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, tab, query]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="text-[11px] font-semibold text-fg">Artifacts</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[9.5px] text-fg-dim hover:text-fg"
          >
            Refresh
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[9.5px] text-fg-dim hover:text-fg"
            >
              Back
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[180px] flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[10px] text-muted">
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Try "json"'
            className="w-full rounded-lg border border-border bg-surface-2 py-1.5 pr-3 pl-7 text-[11px] text-fg outline-none placeholder:text-muted focus:border-accent/50"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "All", counts.all],
              ["images", "Images", counts.images],
              ["files", "Files", counts.files],
              ["links", "Links", counts.links],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1 text-[10px] ${
                tab === id
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {label} {n}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="m-3 rounded-lg border border-danger/40 bg-[#2a1518] px-3 py-2 text-[10.5px] text-danger">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(160px,1fr)] gap-2 border-b border-border bg-surface-1 px-4 py-2 text-[9px] font-semibold tracking-wider text-muted uppercase">
          <div>Title / Name</div>
          <div>Location</div>
          <div>Session</div>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-[11px] text-muted">
            Loading artifacts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[11px] text-muted">
            Belum ada artifact. File, link, dan gambar dari sesi akan muncul di
            sini.
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(160px,1fr)] gap-2 border-b border-border/60 px-4 py-2.5 hover:bg-surface-2/80"
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left"
                onClick={() => onOpenArtifact?.(row)}
                title="Open in Canvas / browser"
              >
                <span className="shrink-0 text-[11px]">
                  {categoryIcon(row.category)}
                </span>
                <span className="truncate text-[11px] font-medium text-fg">
                  {row.title}
                </span>
              </button>
              <div
                className="truncate font-mono text-[10px] text-fg-dim"
                title={row.location}
              >
                {row.location}
              </div>
              <button
                type="button"
                className="min-w-0 truncate border-0 bg-transparent p-0 text-left text-[10px] text-muted hover:text-accent"
                onClick={() => onOpenSession?.(row.threadId)}
                title={row.threadId}
              >
                {row.sessionPreview.slice(0, 48)}
                {row.sessionPreview.length > 48 ? "…" : ""}, {formatWhen(row.at)}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
