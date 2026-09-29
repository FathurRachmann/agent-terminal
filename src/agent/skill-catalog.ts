/**
 * Skill name + description catalog for system prompt injection (Cursor-style).
 * Full SKILL.md bodies stay on-demand via /skills/.
 */
import fs from "node:fs";
import path from "node:path";

export type SkillDescription = {
  name: string;
  description: string;
  /** Virtual path under /skills/ */
  virtualPath: string;
  folder: string;
};

const MAX_SKILLS = 100;
const MAX_DESC_LEN = 160;

function parseSkillFrontmatter(raw: string): {
  name?: string;
  description?: string;
} {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = raw.slice(3, end).trim();
  const out: { name?: string; description?: string } = {};
  let currentKey: "name" | "description" | null = null;
  let descLines: string[] = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) {
      if (currentKey === "description" && descLines.length) {
        out.description = descLines.join(" ").trim();
        descLines = [];
      }
      const key = m[1];
      const val = m[2] ?? "";
      if (key === "name") {
        currentKey = "name";
        out.name = val.replace(/^['"]|['"]$/g, "").trim();
      } else if (key === "description") {
        currentKey = "description";
        if (val === ">-" || val === "|" || val === ">") {
          descLines = [];
        } else {
          out.description = val.replace(/^['"]|['"]$/g, "").trim();
          currentKey = null;
        }
      } else {
        currentKey = null;
      }
    } else if (currentKey === "description") {
      descLines.push(line.trim());
    }
  }
  if (currentKey === "description" && descLines.length) {
    out.description = descLines.join(" ").trim();
  }
  return out;
}

function findSkillFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSkillFiles(full, out);
    } else if (entry.name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

function truncateDesc(text: string, max = MAX_DESC_LEN): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function listSkillDescriptions(
  skillsDir: string,
  options?: { disabledFolders?: Set<string> | string[]; limit?: number },
): SkillDescription[] {
  const disabled = new Set(
    [...(options?.disabledFolders ?? [])].map((s) =>
      String(s).replace(/^skill:/, "").replaceAll("\\", "/"),
    ),
  );
  const limit = options?.limit ?? MAX_SKILLS;
  const items: SkillDescription[] = [];
  for (const skillFile of findSkillFiles(skillsDir)) {
    const relDir = path.dirname(skillFile);
    const folderName = path.basename(relDir);
    const rel = path.relative(skillsDir, relDir).replaceAll(path.sep, "/");
    if (disabled.has(rel) || disabled.has(folderName) || disabled.has(`skill:${rel}`)) {
      continue;
    }
    let raw = "";
    try {
      raw = fs.readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const fm = parseSkillFrontmatter(raw);
    const name = fm.name || folderName;
    const description = truncateDesc(
      fm.description || "Agent skill (on-demand).",
    );
    items.push({
      name,
      description,
      virtualPath: `/skills/${rel}/SKILL.md`,
      folder: rel,
    });
    if (items.length >= limit) break;
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Compact block appended to system prompt. */
export function formatSkillCatalogBlock(
  skills: readonly SkillDescription[],
): string {
  if (!skills.length) {
    return [
      "## Available skills",
      "(none installed under `.agent/skills/`)",
      "When needed later, `ls /skills/` and `read_file` the matching SKILL.md.",
    ].join("\n");
  }
  const lines = skills.map(
    (s) => `- **${s.name}** — ${s.description} (read \`${s.virtualPath}\` when needed)`,
  );
  return [
    "## Available skills",
    "Skill *descriptions* are listed below (Cursor-style). Read the full SKILL.md only when you need that skill — do not bulk-load all bodies.",
    ...lines,
  ].join("\n");
}

export function buildSkillCatalogPromptSection(
  skillsDir: string,
  disabledFolders?: Set<string> | string[],
): string {
  return formatSkillCatalogBlock(
    listSkillDescriptions(skillsDir, { disabledFolders }),
  );
}
