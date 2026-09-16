import React, { useEffect, useId, useRef, useState } from "react";
import {
  copyMermaidSourceAsImage,
  copySvgAsImage,
  copySvgElementAsImage,
  copyText,
} from "./clipboard.js";
import { CodeBlock } from "./CodeBlock.js";
import { CopyButton } from "./CopyButton.js";
import { loadMermaid, renderMermaidForExport } from "./mermaid-loader.js";

type Props = {
  code: string;
  filename?: string;
};

export function looksLikeMermaid(code: string): boolean {
  const t = code.trim();
  return /^(sequenceDiagram|flowchart(?:\s|$)|graph\s|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:\s|$)|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container)/i.test(
    t,
  );
}

/** Renders Mermaid source as a visual diagram (SVG). Source stays in .md fences. */
export function MermaidDiagram({ code, filename }: Props) {
  const reactId = useId().replace(/:/g, "");
  const svgHostRef = useRef<HTMLDivElement>(null);
  const [layer, setLayer] = useState<"diagram" | "source">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const trimmed = code.replace(/\n$/, "");

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `mmd-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, trimmed);
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
  }, [trimmed, reactId]);

  const copyPreview = async () => {
    const ok = await copyMermaidSourceAsImage(trimmed, renderMermaidForExport);
    if (ok) return true;
    const live = svgHostRef.current?.querySelector("svg");
    if (live) {
      const fromDom = await copySvgElementAsImage(live);
      if (fromDom) return true;
    }
    return svg ? copySvgAsImage(svg) : false;
  };

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-border bg-surface-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-b from-surface-3 to-surface-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[9.5px] font-semibold tracking-wide text-accent uppercase">
            Diagram
          </span>
          <span className="truncate font-mono text-[11px] text-fg">
            {filename || "diagram.mmd"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ["diagram", "Preview"],
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
          <CopyButton
            className="ml-0.5"
            title={
              layer === "diagram"
                ? "Copy diagram as image"
                : "Copy Mermaid source"
            }
            disabled={layer === "diagram" && (!svg || busy)}
            onCopy={() =>
              layer === "diagram" ? copyPreview() : copyText(trimmed)
            }
          />
        </div>
      </div>

      {layer === "diagram" ? (
        <div className="bg-surface-1 p-3">
          {busy && (
            <div className="py-6 text-center text-[11px] text-muted">
              Rendering diagram…
            </div>
          )}
          {!busy && error && (
            <div className="rounded-md border border-danger/40 bg-[#2a1518] px-3 py-2 text-[11px] text-danger">
              Gagal render Mermaid: {error}
            </div>
          )}
          {/* SAFE: svg from mermaid.render with securityLevel:"strict" (DOMPurify). */}
          {!busy && svg && (
            <div
              ref={svgHostRef}
              className="mermaid-svg flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      ) : (
        <div className="p-0">
          <CodeBlock
            code={trimmed}
            language="mermaid"
            filename={filename || "diagram.mmd"}
            hideCopy
          />
        </div>
      )}
    </div>
  );
}
