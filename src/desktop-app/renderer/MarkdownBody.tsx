import React, { useMemo } from "react";
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
      return <CodeBlock code={text} language={language} filename={filename} />;
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

export function MarkdownBody({
  text,
  onOpenPath,
}: {
  text: string;
  onOpenPath?: (path: string) => void;
}) {
  const components = useMemo(
    () => buildMdComponents(onOpenPath),
    [onOpenPath],
  );
  const repaired = useMemo(() => repairMermaidMarkdown(text), [text]);
  return (
    <div className="md-body break-words text-xs leading-relaxed text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {repaired}
      </ReactMarkdown>
    </div>
  );
}
