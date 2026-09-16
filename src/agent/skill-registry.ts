import fs from "node:fs";
import path from "node:path";
import type { SubAgent } from "deepagents";

export type SkillAgentSpec = {
  /** Relative folder under `.agent/skills/` (posix-ish). */
  skillFolder: string;
  name: string;
  description: string;
  systemPrompt: string;
};

function findSkillFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSkillFiles(full, out);
    else if (entry.name === "SKILL.md") out.push(full);
  }
  return out;
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

/**
 * Parse optional `agent:` block from SKILL.md YAML frontmatter.
 *
 * ```yaml
 * agent:
 *   name: security-reviewer
 *   description: Audit diffs for OWASP issues.
 *   systemPromptFile: AGENT_PROMPT.md
 *   # or inline:
 *   systemPrompt: |
 *     You are a security reviewer...
 * ```
 */
export function parseAgentFrontmatter(
  raw: string,
  skillDir: string,
): Omit<SkillAgentSpec, "skillFolder"> | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = raw.slice(3, end);
  const lines = block.split("\n");

  let agentStart = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^agent:\s*$/.test(lines[i]!) || /^agent:\s+\S/.test(lines[i]!)) {
      agentStart = i;
      break;
    }
  }
  if (agentStart < 0) return null;

  const fields: Record<string, string> = {};
  let currentKey: string | null = null;
  let multiline: string[] = [];
  let multilineMode: "|" | ">" | null = null;

  const flush = () => {
    if (!currentKey) return;
    if (multilineMode) {
      fields[currentKey] = multiline.join(multilineMode === "|" ? "\n" : " ").trim();
    }
    currentKey = null;
    multiline = [];
    multilineMode = null;
  };

  const first = lines[agentStart]!;
  const inlineRest = first.replace(/^agent:\s*/, "").trim();
  if (inlineRest && !inlineRest.startsWith("{")) {
    // unsupported inline map — ignore
  }

  for (let i = agentStart + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\S/.test(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
      flush();
      break;
    }
    if (multilineMode) {
      // Indented continuation or blank — strip one level of nesting (2 spaces).
      if (/^\s+/.test(line) || line.trim() === "") {
        multiline.push(line.replace(/^\t/, "  ").replace(/^ {2}/, ""));
        continue;
      }
      flush();
    }

    const m = line.match(/^\s+([A-Za-z_][\w]*):\s*(.*)$/);
    if (!m) continue;
    flush();
    const key = m[1]!;
    const val = (m[2] ?? "").trim();
    if (val === "|" || val === ">" || val === ">-") {
      currentKey = key;
      multilineMode = val.startsWith(">") ? ">" : "|";
      multiline = [];
    } else {
      fields[key] = unquote(val);
    }
  }
  flush();

  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description) return null;

  let systemPrompt = fields.systemPrompt?.trim() ?? "";
  const promptFile = fields.systemPromptFile?.trim();
  if (promptFile) {
    const skillRoot = path.resolve(skillDir);
    const resolved = path.resolve(skillDir, promptFile);
    const rootPrefix = skillRoot.endsWith(path.sep)
      ? skillRoot
      : skillRoot + path.sep;
    if (
      (resolved === skillRoot || resolved.startsWith(rootPrefix)) &&
      fs.existsSync(resolved)
    ) {
      systemPrompt = fs.readFileSync(resolved, "utf8").trim();
    }
  }
  if (!systemPrompt) {
    // Fall back to skill body after frontmatter so the subagent still has guidance.
    const bodyStart = end + 4;
    systemPrompt = raw.slice(Math.max(0, bodyStart)).trim().slice(0, 8000);
  }
  if (!systemPrompt) return null;

  return { name, description, systemPrompt };
}

export function loadSkillAgentSpecs(skillsRoot: string): SkillAgentSpec[] {
  const root = path.resolve(skillsRoot);
  const specs: SkillAgentSpec[] = [];
  const seen = new Set<string>();

  for (const skillFile of findSkillFiles(root)) {
    const skillDir = path.dirname(skillFile);
    const skillFolder = path.relative(root, skillDir).split(path.sep).join("/");
    let raw: string;
    try {
      raw = fs.readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const parsed = parseAgentFrontmatter(raw, skillDir);
    if (!parsed) continue;
    if (seen.has(parsed.name)) continue;
    seen.add(parsed.name);
    specs.push({
      skillFolder,
      name: parsed.name,
      description: parsed.description,
      systemPrompt: parsed.systemPrompt,
    });
  }

  return specs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Convert skill agent specs into Deep Agents SubAgent entries for `task`. */
export function loadSkillSubagents(skillsRoot: string): SubAgent[] {
  return loadSkillAgentSpecs(skillsRoot).map((spec) => ({
    name: spec.name,
    description: `${spec.description} (from skill \`${spec.skillFolder}\`)`,
    systemPrompt: spec.systemPrompt,
  }));
}

/** Match board.skillsUsed entries to registered skill agents. */
export function matchSkillAgents(
  skillsUsed: string[],
  specs: SkillAgentSpec[],
): SkillAgentSpec[] {
  if (!skillsUsed.length || !specs.length) return [];
  const needles = skillsUsed
    .map((s) => s.trim().toLowerCase())
    .filter((n) => n.length >= 2);
  return specs.filter((spec) => {
    const folder = spec.skillFolder.toLowerCase();
    const base = path.posix.basename(folder);
    const name = spec.name.toLowerCase();
    return needles.some(
      (n) =>
        folder === n ||
        folder.endsWith(`/${n}`) ||
        base === n ||
        name === n,
    );
  });
}
