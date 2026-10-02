import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock, parseFenceMeta } from "./CodeBlock.js";
import { looksLikeMermaid, MermaidDiagram } from "./MermaidDiagram.js";
import {
  recoverMermaidCodeFence,
  repairMermaidMarkdown,
} from "./mermaid-markdown-repair.js";
import { DbSchemaDiagram, looksLikeSqlSchema } from "./DbSchemaDiagram.js";
import { looksLikeWorkspacePath } from "./activity-artifact.js";
import {
  attachFencePaths,
  shouldRenderFenceAsDiff,
} from "./markdown-code-policy.js";
import { ProposedCodeDiff } from "./ProposedCodeDiff.js";
import {
  sectionDefaultOpen,
  splitMarkdownByH2,
} from "./md-sections.js";

function buildMdComponents(
  onOpenPath?: (path: string) => void,
): React.ComponentProps<typeof ReactMarkdown>["components"] {
  return {
    h1: ({ children }) => (
      <h1 className="mb-2.5 text-xl font-bold text-white">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-[14px] font-bold text-white">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3.5 text-[13px] font-semibold text-fg">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="mb-2.5 break-words [overflow-wrap:anywhere]">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-2.5 list-disc pl-5.5 break-words [overflow-wrap:anywhere]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2.5 list-decimal pl-5.5 break-words [overflow-wrap:anywhere]">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="mb-1 break-words [overflow-wrap:anywhere]">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-bold text-white">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="my-3.5 border-0 border-t border-border-strong" />,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-soft underline"
        onClick={(e) => {
          if (href?.startsWith("http")) {
            e.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
          }
        }}
      >
        {children}
      </a>
    ),
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children, ...props }) => {
      const text = String(children).replace(/\n$/, "");
      const inline = !className && !text.includes("\n");
      if (inline) {
        const path = text.trim().replace(/\\/g, "/");
        if (onOpenPath && looksLikeWorkspacePath(path)) {
          return (
            <button
              type="button"
              data-tip="Open in canvas"
              data-tip-pos="bottom"
              onClick={() => onOpenPath(path)}
              className="inline rounded border border-border-strong bg-surface-1 px-1.5 py-px font-mono text-[11px] text-accent-soft transition hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
            >
              {children}
            </button>
          );
        }
        return (
          <code className="rounded border border-border-strong bg-surface-1 px-1.5 py-px font-mono text-[11px]">
            {children}
          </code>
        );
      }

      const meta =
        typeof (props as { node?: { data?: { meta?: string } } }).node?.data
          ?.meta === "string"
          ? (props as { node?: { data?: { meta?: string } } }).node?.data?.meta
          : undefined;
      const { language, filename } = parseFenceMeta(className, meta);
      const recovered = recoverMermaidCodeFence(language, text);
      const mermaidCode = recovered?.code ?? text;
      const mermaidLang = recovered?.language ?? language;
      if (
        mermaidLang === "mermaid" ||
        mermaidLang === "mmd" ||
        looksLikeMermaid(mermaidCode)
      ) {
        return <MermaidDiagram code={mermaidCode} filename={filename} />;
      }
      const sqlLang = [
        "sql",
        "pgsql",
        "postgres",
        "postgresql",
        "mysql",
        "sqlite",
        "dbml",
      ].includes((language || "").toLowerCase());
      if (sqlLang && (language === "dbml" || looksLikeSqlSchema(text))) {
        return (
          <DbSchemaDiagram
            code={text}
            filename={filename}
            language={language || "sql"}
          />
        );
      }
      if (shouldRenderFenceAsDiff(language, text)) {
        return (
          <ProposedCodeDiff
            code={text}
            language={language}
            filename={filename}
            onOpenPath={onOpenPath}
          />
        );
      }
      return (
        <CodeBlock
          code={text}
          language={language}
          filename={filename || language || "code"}
        />
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="mb-2.5 rounded-r-md border-l-[3px] border-accent/50 bg-surface-1 px-3 py-1.5 text-fg-dim">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="mb-2.5 overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border-strong bg-surface-2 px-2 py-1.5 text-left">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border-strong px-2 py-1.5">{children}</td>
    ),
  };
}

function MdChunkView({
  markdown,
  components,
}: {
  markdown: string;
  components: React.ComponentProps<typeof ReactMarkdown>["components"];
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}

function CollapsibleSection({
  title,
  markdown,
  lineCount,
  streaming,
  components,
}: {
  title: string;
  markdown: string;
  lineCount: number;
  streaming: boolean;
  components: React.ComponentProps<typeof ReactMarkdown>["components"];
}) {
  const [open, setOpen] = useState(() =>
    sectionDefaultOpen(lineCount, { streaming }),
  );
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      setOpen(sectionDefaultOpen(lineCount));
    }
    wasStreaming.current = streaming;
  }, [streaming, lineCount]);

  return (
    <div className={`md-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="md-section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="md-section-chevron material-symbols-outlined" aria-hidden>
          {open ? "expand_more" : "chevron_right"}
        </span>
        <span className="md-section-title">{title}</span>
        {!open ? (
          <span className="md-section-hint">Click to expand</span>
        ) : null}
      </button>
      {open ? (
        <div className="md-section-body">
          <MdChunkView markdown={markdown} components={components} />
        </div>
      ) : null}
    </div>
  );
}

export function MarkdownBody({
  text,
  onOpenPath,
  streaming = false,
  collapsibleSections = true,
}: {
  text: string;
  onOpenPath?: (path: string) => void;
  /** Keep ## sections open while the answer is still streaming. */
  streaming?: boolean;
  /** Wrap ## headings in open/close panels (default on). */
  collapsibleSections?: boolean;
}) {
  const components = useMemo(
    () => buildMdComponents(onOpenPath),
    [onOpenPath],
  );
  const repaired = useMemo(
    () => attachFencePaths(repairMermaidMarkdown(text)),
    [text],
  );
  const chunks = useMemo(
    () => (collapsibleSections ? splitMarkdownByH2(repaired) : null),
    [repaired, collapsibleSections],
  );

  const hasSections = Boolean(
    chunks && chunks.some((c) => c.type === "section"),
  );

  return (
    <div className="md-body select-text break-words text-xs leading-relaxed text-fg">
      {hasSections && chunks ? (
        chunks.map((chunk, i) => {
          if (chunk.type === "prose") {
            return (
              <MdChunkView
                key={`p-${i}`}
                markdown={chunk.markdown}
                components={components}
              />
            );
          }
          return (
            <CollapsibleSection
              key={`s-${i}-${chunk.title}`}
              title={chunk.title}
              markdown={chunk.markdown}
              lineCount={chunk.lineCount}
              streaming={streaming}
              components={components}
            />
          );
        })
      ) : (
        <MdChunkView markdown={repaired} components={components} />
      )}
    </div>
  );
}
