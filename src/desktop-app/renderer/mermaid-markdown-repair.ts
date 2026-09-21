/**
 * Repair common LLM Mermaid markdown mistakes so chat bubbles render diagrams
 * instead of raw `mermaidsequenceDiagram…` prose.
 */

const DIAGRAM_START =
  "(?:sequenceDiagram|flowchart(?:\\s|$)|graph\\s|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:\\s|$)|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|C4Container)";

/**
 * Fix markdown so Mermaid fences are recognized by ReactMarkdown.
 *
 * Handles:
 * - ```mermaidsequenceDiagram  (diagram type glued to language)
 * - bare `mermaidsequenceDiagram` / `mermaid\nsequenceDiagram` without fences
 * - missing closing ```
 */
export function repairMermaidMarkdown(md: string): string {
  let out = String(md || "").replace(/\r\n/g, "\n");
  if (!out.trim()) return out;

  // ```mermaidsequenceDiagram / ```mmdflowchart TD …
  out = out.replace(
    new RegExp(
      "```(?:mermaid|mmd)\\s*(" + DIAGRAM_START + ")",
      "gi",
    ),
    "```mermaid\n$1",
  );

  // Bare "mermaidsequenceDiagram" or "mermaid\nsequenceDiagram" outside fences.
  out = out.replace(
    new RegExp(
      "(^|\\n)[ \\t]*(?:mermaid|mmd)\\s*(" + DIAGRAM_START + ")",
      "gi",
    ),
    (full, lead: string, diagram: string, offset: number) => {
      const before = out.slice(0, offset + lead.length);
      // Already inside an open fence — don't wrap again.
      const opens = (before.match(/```/g) || []).length;
      if (opens % 2 === 1) return full;
      return `${lead}\`\`\`mermaid\n${diagram}`;
    },
  );

  // If we opened a mermaid fence and never closed it before EOF / next heading,
  // close it at the end of the diagram-ish block.
  out = ensureClosedMermaidFences(out);

  return out;
}

function ensureClosedMermaidFences(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inMermaid = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const open = /^```\s*(mermaid|mmd)\b/i.test(line);
    const close = /^```\s*$/.test(line);

    if (open && !inMermaid) {
      inMermaid = true;
      out.push("```mermaid");
      // If the opener itself still has leftover diagram text after language, keep it.
      const rest = line.replace(/^```\s*(?:mermaid|mmd)\s*/i, "");
      if (rest.trim()) out.push(rest);
      continue;
    }

    if (inMermaid && close) {
      inMermaid = false;
      out.push("```");
      continue;
    }

    if (
      inMermaid &&
      !close &&
      (/^#{1,6}\s/.test(line) ||
        /^File tersimpan/i.test(line) ||
        /^✅/.test(line) ||
        (/^[A-Za-z].{0,80}:/.test(line) &&
          !/^\s*(participant|actor|Note|alt|else|end|loop|opt|par|and|rect|activate|deactivate|User|API|Frontend|Backend|Client|Auth|DB|Session)/.test(
            line,
          ) &&
          !/->>|-->>|-->|===/.test(line)))
    ) {
      out.push("```");
      inMermaid = false;
      out.push(line);
      continue;
    }

    out.push(line);
  }

  if (inMermaid) out.push("```");
  return out.join("\n");
}

/**
 * Recover when fence language is `mermaidsequenceDiagram` (glued) and body
 * starts mid-diagram.
 */
export function recoverMermaidCodeFence(
  language: string | undefined,
  code: string,
): { language: string; code: string } | null {
  const lang = String(language || "").trim();
  const body = String(code || "");

  if (/^(mermaid|mmd)$/i.test(lang)) {
    return { language: "mermaid", code: body };
  }

  const glued = new RegExp(
    "^(mermaid|mmd)\\s*(" + DIAGRAM_START + ")(.*)$",
    "i",
  ).exec(lang);
  if (glued) {
    const diagram = glued[2]!;
    const restLang = glued[3] || "";
    const prefix = `${diagram}${restLang}`.trimEnd();
    return {
      language: "mermaid",
      code: body.trim() ? `${prefix}\n${body}` : prefix,
    };
  }

  // Body itself starts with glued mermaid+diagram
  const bodyGlued = new RegExp(
    "^(?:mermaid|mmd)\\s*(" + DIAGRAM_START + ")([\\s\\S]*)$",
    "i",
  ).exec(body.trim());
  if (bodyGlued) {
    return {
      language: "mermaid",
      code: `${bodyGlued[1]}${bodyGlued[2] || ""}`.replace(/^\n/, ""),
    };
  }

  return null;
}
