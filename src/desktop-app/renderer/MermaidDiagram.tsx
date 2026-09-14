import React, { useEffect, useId, useState } from "react";
import { CodeBlock } from "./CodeBlock.js";

type Props = {
  code: string;
  filename?: string;
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
          actorBkg: "#161b22",
          actorBorder: "#58a6ff",
          actorTextColor: "#e7ecf3",
          signalColor: "#8b98a8",
          signalTextColor: "#e7ecf3",
        },
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

export function looksLikeMermaid(code: string): boolean {
  const t = code.trim();
  return /^(sequenceDiagram|flowchart(?:\s|$)|graph\s|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:\s|$)|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container)/i.test(
    t,
  );
}

/** Renders Mermaid source as a visual diagram (SVG). Source stays in .md fences. */
export function MermaidDiagram({ code, filename }: Props) {
  const reactId = useId().replace(/:/g, "");
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

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-[#2a313c] bg-[#0d1117] shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-2 border-b border-[#2a313c] bg-gradient-to-b from-[#161b22] to-[#12171e] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[9.5px] font-semibold tracking-wide text-accent uppercase">
            Diagram
          </span>
          <span className="truncate font-mono text-[11px] text-[#e6edf3]">
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
        </div>
      </div>

      {layer === "diagram" ? (
        <div className="max-h-[480px] overflow-auto bg-[#0d1117] p-3">
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
          {!busy && svg && (
            <div
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
          />
        </div>
      )}
    </div>
  );
}
