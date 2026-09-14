import React, { useEffect, useId, useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock.js";
import {
  looksLikeSqlSchema,
  schemaSourceToMermaidEr,
  sqlToDbml,
} from "./sql-schema.js";

type Props = {
  code: string;
  filename?: string;
  language?: string;
};

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        fontFamily: "IBM Plex Sans, Segoe UI, system-ui, sans-serif",
        themeVariables: {
          darkMode: true,
          background: "#0d1117",
          primaryColor: "#1f6feb",
          primaryTextColor: "#e7ecf3",
          primaryBorderColor: "#388bfd",
          lineColor: "#8b98a8",
          secondaryColor: "#161b22",
          tertiaryColor: "#121821",
          noteBkgColor: "#151c27",
          noteTextColor: "#e7ecf3",
          textColor: "#e7ecf3",
        },
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

export { looksLikeSqlSchema };

/**
 * SQL / DBML schema blocks with ER preview + source,
 * plus open-in-dbdiagram.io via copied DBML.
 */
export function DbSchemaDiagram({ code, filename, language = "sql" }: Props) {
  const reactId = useId().replace(/:/g, "");
  const [layer, setLayer] = useState<"diagram" | "source" | "dbml">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const trimmed = code.replace(/\n$/, "");

  const isDbmlSource =
    language === "dbml" ||
    (/^(table|enum|ref|project|tablegroup)\b/im.test(trimmed.trim()) &&
      !looksLikeSqlSchema(trimmed));

  const mermaidSrc = useMemo(
    () => schemaSourceToMermaidEr(trimmed),
    [trimmed],
  );

  const dbmlSrc = useMemo(() => {
    if (isDbmlSource) return trimmed;
    return sqlToDbml(trimmed);
  }, [trimmed, isDbmlSource]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (!mermaidSrc) {
          if (!cancelled) {
            setSvg(null);
            setError("Tidak ada tabel yang bisa divisualisasikan.");
            setBusy(false);
            setLayer("source");
          }
          return;
        }
        const mermaid = await loadMermaid();
        const id = `erd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, mermaidSrc);
        if (!cancelled) {
          setSvg(rendered);
          setBusy(false);
        }
      } catch (e) {
        if (!cancelled) {
          setSvg(null);
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
          setLayer("source");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mermaidSrc, reactId]);

  const openInDbdiagram = async () => {
    if (!dbmlSrc.trim()) return;
    try {
      await navigator.clipboard.writeText(dbmlSrc);
    } catch {
      /* clipboard may be unavailable */
    }
    window.open("https://dbdiagram.io/", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-[#2a313c] bg-[#0d1117] shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-2 border-b border-[#2a313c] bg-gradient-to-b from-[#161b22] to-[#12171e] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[9.5px] font-semibold tracking-wide text-accent uppercase">
            Schema
          </span>
          <span className="truncate font-mono text-[11px] text-[#e6edf3]">
            {filename || (isDbmlSource ? "schema.dbml" : "schema.sql")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ["diagram", "Preview"],
              ["source", isDbmlSource ? "Source" : "SQL"],
              ["dbml", "DBML"],
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
          <button
            type="button"
            onClick={() => void openInDbdiagram()}
            title="Salin DBML ke clipboard & buka dbdiagram.io"
            className="ml-1 rounded border border-border px-2 py-0.5 text-[9.5px] text-fg-dim hover:border-accent/40 hover:text-accent"
          >
            dbdiagram.io
          </button>
        </div>
      </div>

      {layer === "diagram" ? (
        <div className="max-h-[520px] overflow-auto bg-[#0d1117] p-3">
          {busy && (
            <div className="py-6 text-center text-[11px] text-muted">
              Rendering schema diagram…
            </div>
          )}
          {!busy && error && (
            <div className="rounded-md border border-danger/40 bg-[#2a1518] px-3 py-2 text-[11px] text-danger">
              Gagal render schema: {error}
            </div>
          )}
          {!busy && svg && (
            <div
              className="mermaid-svg flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      ) : layer === "dbml" ? (
        <div className="p-0">
          <CodeBlock
            code={dbmlSrc || "(empty)"}
            language="dbml"
            filename={(filename || "schema").replace(/\.sql$/i, ".dbml")}
          />
        </div>
      ) : (
        <div className="p-0">
          <CodeBlock
            code={trimmed}
            language={isDbmlSource ? "dbml" : language || "sql"}
            filename={
              filename || (isDbmlSource ? "schema.dbml" : "schema.sql")
            }
          />
        </div>
      )}
    </div>
  );
}
