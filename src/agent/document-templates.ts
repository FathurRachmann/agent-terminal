/**
 * User document templates under `tmp/templates/`.
 * Agents must ls + read matching templates before generating laporan/PDF/docx.
 */
import fs from "node:fs";
import path from "node:path";

export const TEMPLATES_REL_DIR = "tmp/templates";
/** Legacy location before artifact root rename. */
export const TEMPLATES_REL_DIR_LEGACY = "working/templates";

export type DocumentTemplateEntry = {
  /** Folder or file name under tmp/templates */
  id: string;
  /** Absolute path */
  absPath: string;
  kind: "folder" | "file";
  /** Optional TEMPLATE.md / README describing structure */
  guidePath: string | null;
  /** Sample files (.pdf, .docx, .md, …) inside a folder template */
  samples: string[];
};

export function templatesAbsDir(artifactHome: string): string {
  return path.resolve(artifactHome, ...TEMPLATES_REL_DIR.split("/"));
}

function templatesAbsDirLegacy(artifactHome: string): string {
  return path.resolve(artifactHome, ...TEMPLATES_REL_DIR_LEGACY.split("/"));
}

/** Ensure tmp/templates (+ README) exists. */
export function ensureTemplatesDir(artifactHome: string): string {
  const dir = templatesAbsDir(artifactHome);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, DEFAULT_TEMPLATES_README, "utf8");
  }
  return dir;
}

export function listDocumentTemplates(
  artifactHome: string,
): DocumentTemplateEntry[] {
  const dirs = [
    ensureTemplatesDir(artifactHome),
    templatesAbsDirLegacy(artifactHome),
  ];
  const seen = new Set<string>();
  const entries: DocumentTemplateEntry[] = [];

  for (const dir of dirs) {
    let names: string[] = [];
    try {
      if (!fs.existsSync(dir)) continue;
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".") || name === "README.md") continue;
      if (seen.has(name)) continue;
      const abs = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        const samples: string[] = [];
        let guidePath: string | null = null;
        try {
          for (const child of fs.readdirSync(abs)) {
            const childAbs = path.join(abs, child);
            if (!fs.statSync(childAbs).isFile()) continue;
            const lower = child.toLowerCase();
            if (
              lower === "template.md" ||
              lower === "readme.md" ||
              lower === "acuan.md"
            ) {
              guidePath = childAbs;
            } else if (
              /\.(pdf|docx|doc|xlsx|pptx|md|html|txt)$/i.test(child) &&
              !/^_/.test(child)
            ) {
              samples.push(childAbs);
            }
          }
        } catch {
          /* ignore */
        }
        seen.add(name);
        entries.push({
          id: name,
          absPath: abs,
          kind: "folder",
          guidePath,
          samples,
        });
      } else if (st.isFile() && /\.(pdf|docx|md|html|txt)$/i.test(name)) {
        seen.add(name);
        entries.push({
          id: name,
          absPath: abs,
          kind: "file",
          guidePath: null,
          samples: [abs],
        });
      }
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** Match templates by user intent keywords (laporan, bod, quotation, …). */
export function matchTemplatesForIntent(
  templates: DocumentTemplateEntry[],
  intent: string,
): DocumentTemplateEntry[] {
  const q = intent.toLowerCase();
  const tokens = q
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  if (!tokens.length) return templates;
  const scored = templates
    .map((t) => {
      const hay = `${t.id} ${t.guidePath ?? ""} ${t.samples.map((s) => path.basename(s)).join(" ")}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += 2;
        if (t.id.toLowerCase().includes(tok)) score += 3;
      }
      // Common aliases
      if (/laporan|report|keuangan|bulanan/.test(q) && /laporan|report|keuangan|bulanan/.test(hay))
        score += 2;
      if (/bod|delivery|serah/.test(q) && /bod|delivery|serah/.test(hay)) score += 2;
      if (/quotation|penawaran|quote/.test(q) && /quotation|penawaran|quote/.test(hay))
        score += 2;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.t);
}

/** Prompt block injected into system / working-scope instructions. */
export function documentTemplatesInstruction(artifactHome?: string): string {
  const rel = TEMPLATES_REL_DIR;
  const absHint = artifactHome
    ? ` (absolute: ${templatesAbsDir(artifactHome)})`
    : "";
  return [
    "## Document templates (mandatory for laporan / surat / BOD / quotation / PDF / DOCX)",
    `User-owned format references live in \`${rel}/\`${absHint}.`,
    "Before generating any laporan, surat, BOD, quotation, invoice, or similar deliverable:",
    `1. \`ls ${rel}/\` (and subfolders) — see available templates`,
    "2. Pick the closest match by name (e.g. `laporan-keuangan`, `laporan-bulanan`, `bod-jira`)",
    "3. Read `TEMPLATE.md` / `README.md` / `acuan.md` in that folder (structure, sections, tone)",
    "4. If a sample `.pdf` / `.docx` / `.md` exists: `read_document` (Office) or `read_file` (md) — **match its section order, headings, and layout**",
    "5. Then generate the new file under `tmp/<scope>/…` via the productivity skill + Python — same format as the template, with real filled content",
    "Do **not** invent a random empty JSON skeleton. Do **not** ignore an existing template when one matches.",
    "Users add templates by dropping folders/files into `tmp/templates/` (Finder or chat save-as). Each folder should contain `TEMPLATE.md` + optional sample file.",
  ].join("\n");
}

export const DEFAULT_TEMPLATES_README = `# Document templates

Drop your format references here. The agent **must** look here first when making laporan, BOD, quotation, surat, etc.

## Layout

\`\`\`
tmp/templates/
  README.md                 ← this file
  laporan-keuangan/         ← example folder template
    TEMPLATE.md             ← structure & rules (required)
    sample.pdf              ← optional visual/format sample
  laporan-bulanan/
    TEMPLATE.md
  bod-jira/
    TEMPLATE.md
    sample.docx
  quotation-atlassian.md    ← single-file template also OK
\`\`\`

## TEMPLATE.md tips

- List required sections in order (1., 2., 3. …)
- Note paper size, language (ID/EN), header/footer, signature blocks
- Say which skill to use (\`pdf\` / \`docx\` / \`xlsx\`)
- Point at the sample file if present
- For PDF/reportlab: warn that raw \`"<b>…</b>"\` in \`Table\` cells prints as literal tags; cover titles need spacing around \`HRFlowable\`

## Adding a template

1. Create a folder under \`tmp/templates/<nama>/\`
2. Add \`TEMPLATE.md\` with the outline
3. Optionally add a filled sample \`.pdf\` / \`.docx\`
4. Ask the agent: "buat laporan … mengikuti template laporan-keuangan"
`;
