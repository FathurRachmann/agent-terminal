import React, { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock.js";
import { MarkdownBody } from "./MarkdownBody.js";
import {
  normalizeCanvasKey,
  parseDelimitedPreview,
  type ActivityArtifact,
  type PreviewKind,
} from "./activity-artifact.js";

export type CanvasTab = {
  id: string;
  path: string;
  basename: string;
  kind: PreviewKind;
  language: string;
  inlineContent?: string;
};

type PreviewPayload = {
  ok: boolean;
  error?: string;
  kind?: PreviewKind;
  language?: string;
  text?: string;
  html?: string;
  dataUrl?: string;
  sheets?: Array<{ name: string; rows: string[][] }>;
  truncated?: boolean;
  note?: string;
  basename?: string;
};

type Props = {
  tabs: CanvasTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** When set, show Approve / Reject plan bar (HITL before task_todos). */
  planApproval?: {
    pending: boolean;
    busy?: boolean;
    onApprove: () => void;
    onReject: () => void;
  } | null;
};

function SheetTable({ rows }: { rows: string[][] }) {
  if (!rows.length) {
    return <div className="p-3 text-[10.5px] text-muted">Empty sheet</div>;
  }
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <div className="max-h-full overflow-auto">
      <table className="w-full border-collapse text-left text-[9.5px]">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="border-b border-border px-2 py-1.5 font-semibold text-fg-dim whitespace-nowrap"
              >
                {h || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="odd:bg-surface-1/40">
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  className="border-b border-border/60 px-2 py-1 font-mono text-fg whitespace-nowrap"
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CsvTable({ text }: { text: string }) {
  const { headers, rows } = useMemo(
    () => parseDelimitedPreview(text),
    [text],
  );
  if (!headers.length) {
    return <div className="p-3 text-[10.5px] text-muted">Empty CSV</div>;
  }
  return <SheetTable rows={[headers, ...rows]} />;
}

function HtmlLayers({
  html,
  filename,
}: {
  html: string;
  filename: string;
}) {
  const [layer, setLayer] = useState<"preview" | "source">("preview");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1">
        {(
          [
            ["preview", "Preview"],
            ["source", "Source"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setLayer(id)}
            className={`rounded px-2 py-0.5 text-[9.5px] ${
              layer === id
                ? "bg-accent/20 text-accent"
                : "text-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {layer === "preview" ? (
          <iframe
            title={filename}
            sandbox=""
            srcDoc={html}
            className="h-full min-h-[200px] w-full rounded-md border border-border bg-white"
          />
        ) : (
          <CodeBlock code={html} language="html" filename={filename} />
        )}
      </div>
    </div>
  );
}

function DocumentHtml({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>
        body{font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:16px;color:#111;background:#fff}
        table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:6px}
        img{max-width:100%}
      </style></head><body>${html}</body></html>`}
      className="h-full min-h-[200px] w-full border-0 bg-white"
    />
  );
}

export function artifactToCanvasTab(artifact: ActivityArtifact): CanvasTab {
  return {
    id: normalizeCanvasKey(artifact.path),
    path: artifact.path,
    basename: artifact.basename,
    kind: artifact.kind,
    language: artifact.language,
    inlineContent: artifact.inlineContent,
  };
}

export function ActivityCanvas({
  tabs,
  activeId,
  onSelect,
  onClose,
  planApproval,
}: Props) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!active) {
        setPayload(null);
        return;
      }
      setLoading(true);
      setSheetIdx(0);
      try {
        // Prefer fresh workspace read; fall back to inline tool content.
        if (window.electronAgent?.readWorkspacePreview) {
          const res = await window.electronAgent.readWorkspacePreview(active.path);
          if (cancelled) return;
          if (res.ok) {
            setPayload(res);
            return;
          }
          if (active.inlineContent) {
            setPayload({
              ok: true,
              kind: active.kind,
              language: active.language,
              text: active.inlineContent,
              note: res.error
                ? `Workspace read failed (${res.error}); showing tool payload.`
                : undefined,
            });
            return;
          }
          setPayload({ ok: false, error: res.error || "Preview failed" });
          return;
        }
        if (active.inlineContent) {
          setPayload({
            ok: true,
            kind: active.kind,
            language: active.language,
            text: active.inlineContent,
          });
          return;
        }
        setPayload({
          ok: false,
          error: "Preview bridge missing. Run npm run desktop:start.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.path, active?.inlineContent, active?.kind, active?.language]);

  if (!tabs.length) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-1 items-center justify-center px-4 text-center text-[10.5px] text-muted">
          Canvas kosong. Buka file dari Trace (Read / Write / Edit) untuk preview
          .md, kode, .html, .csv, .xlsx, .docx.
        </div>
        {planApproval?.pending && (
          <div className="shrink-0 border-t border-border bg-surface-2 px-3 py-2.5">
            <div className="mb-2 text-[10px] leading-snug text-muted">
              Plan is ready. Approve to continue with todos &amp; coding.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={planApproval.busy}
                onClick={planApproval.onApprove}
                className="flex-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-surface-0 disabled:opacity-50"
              >
                Approve plan
              </button>
              <button
                type="button"
                disabled={planApproval.busy}
                onClick={planApproval.onReject}
                className="rounded-md border border-danger/40 bg-[#2a1518] px-2 py-1.5 text-[11px] text-danger disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const kind = (payload?.kind ?? active?.kind) as PreviewKind | undefined;
  const text = payload?.text ?? active?.inlineContent ?? "";
  const sheets = payload?.sheets ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {tabs.map((tab) => {
          const selected = tab.id === (active?.id ?? "");
          return (
            <div
              key={tab.id}
              className={`inline-flex max-w-[140px] items-center gap-1 rounded-md px-2 py-1 text-[9.5px] ${
                selected
                  ? "bg-accent/20 text-fg"
                  : "bg-surface-2 text-muted hover:text-fg"
              }`}
            >
              <button
                type="button"
                className="min-w-0 truncate border-0 bg-transparent p-0 text-inherit"
                onClick={() => onSelect(tab.id)}
                title={tab.path}
              >
                {tab.basename}
              </button>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[9px] text-muted hover:text-fg"
                aria-label={`Close ${tab.basename}`}
                onClick={() => onClose(tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && (
          <div className="p-3 text-[10.5px] text-muted">Loading preview…</div>
        )}
        {!loading && payload && !payload.ok && (
          <div className="p-3 text-[10.5px] text-danger">{payload.error}</div>
        )}
        {!loading && payload?.ok && payload.note && !text && !payload.html && !sheets.length && (
          <div className="p-3 text-[10.5px] text-muted">{payload.note}</div>
        )}
        {!loading && payload?.ok && kind === "markdown" && text && (
          <div className="h-full overflow-auto p-3">
            <MarkdownBody text={text} />
          </div>
        )}
        {!loading && payload?.ok && kind === "html" && text && (
          <HtmlLayers html={text} filename={active?.basename ?? "index.html"} />
        )}
        {!loading && payload?.ok && kind === "document" && payload.html && (
          <div className="h-full overflow-hidden">
            <DocumentHtml
              html={payload.html}
              title={active?.basename ?? "document"}
            />
          </div>
        )}
        {!loading && payload?.ok && kind === "image" && payload.dataUrl && (
          <div className="flex h-full items-start justify-center overflow-auto p-3">
            <img
              src={payload.dataUrl}
              alt={active?.basename ?? "image"}
              className="max-h-full max-w-full rounded-md border border-border object-contain"
            />
          </div>
        )}
        {!loading && payload?.ok && kind === "csv" && text && (
          <div className="h-full overflow-hidden p-1">
            {payload.note && (
              <div className="px-2 py-1 text-[9px] text-muted">{payload.note}</div>
            )}
            <CsvTable text={text} />
          </div>
        )}
        {!loading && payload?.ok && kind === "spreadsheet" && sheets.length > 0 && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1">
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setSheetIdx(i)}
                  className={`rounded px-2 py-0.5 text-[9.5px] ${
                    sheetIdx === i
                      ? "bg-accent/20 text-accent"
                      : "text-muted hover:text-fg"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-1">
              <SheetTable rows={sheets[sheetIdx]?.rows ?? []} />
            </div>
          </div>
        )}
        {!loading &&
          payload?.ok &&
          (kind === "code" || kind === "text") &&
          text && (
            <div className="h-full overflow-auto p-2">
              {payload.truncated && (
                <div className="mb-1 text-[9px] text-muted">
                  Preview truncated
                </div>
              )}
              <CodeBlock
                code={text}
                language={payload.language ?? active?.language ?? "text"}
                filename={active?.basename}
              />
            </div>
          )}
        {!loading &&
          payload?.ok &&
          !text &&
          !payload.html &&
          !sheets.length &&
          payload.note && (
            <div className="p-3 text-[10.5px] text-muted">{payload.note}</div>
          )}
      </div>

      {planApproval?.pending && (
        <div className="shrink-0 border-t border-border bg-surface-2 px-3 py-2.5">
          <div className="mb-2 text-[10px] leading-snug text-muted">
            Review the plan above. Approve to continue with todos &amp; coding,
            or reject to stop.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={planApproval.busy}
              onClick={planApproval.onApprove}
              className="flex-1 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-surface-0 disabled:opacity-50"
            >
              Approve plan
            </button>
            <button
              type="button"
              disabled={planApproval.busy}
              onClick={planApproval.onReject}
              className="rounded-md border border-danger/40 bg-[#2a1518] px-2 py-1.5 text-[11px] text-danger disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
