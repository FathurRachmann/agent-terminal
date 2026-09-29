import fs from "node:fs";
import path from "node:path";

export type CapabilityKind = "skills" | "tools" | "mcp";

export type CapabilityItem = {
  id: string;
  kind: CapabilityKind;
  name: string;
  category: string;
  description: string;
  badge?: string;
  enabled: boolean;
  detailMarkdown: string;
  meta?: Record<string, string | number | boolean>;
};

export type CapabilitiesPrefs = {
  disabled: string[];
};

const PREFS_REL = path.join(".agent", "capabilities-prefs.json");

/** Built-in Deep Agents filesystem/shell tools (always present via backend). */
const BUILTIN_TOOLS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  detail: string;
}> = [
  {
    id: "tool:execute",
    name: "execute",
    category: "Shell",
    description: "Run commands in the PTY pool (default 3 parallel slots). Prefer multiple execute calls in one turn for independent commands.",
    detail:
      "Persistent interactive shell. Supports JSON payload `{ command, stdin?, background?, timeoutMs? }`. Independent commands can run across up to 3 PTY slots.",
  },
  {
    id: "tool:ls",
    name: "ls",
    category: "Filesystem",
    description: "List directory entries (workspace-confined).",
    detail: "Lists files under allowed workspace roots. Use `/skills/` to discover skill folders.",
  },
  {
    id: "tool:read_file",
    name: "read_file",
    category: "Filesystem",
    description: "Read file contents with optional offset/limit.",
    detail: "Primary way to load skill docs: `read_file /skills/<name>/SKILL.md`.",
  },
  {
    id: "tool:write_file",
    name: "write_file",
    category: "Filesystem",
    description: "Create or overwrite a file.",
    detail: "Writes within allowlisted roots. Prefer `tmp/` for generated artifacts.",
  },
  {
    id: "tool:edit_file",
    name: "edit_file",
    category: "Filesystem",
    description: "Apply a surgical edit to an existing file.",
    detail: "Patch-style edit; keep diffs minimal.",
  },
  {
    id: "tool:glob",
    name: "glob",
    category: "Filesystem",
    description: "Find files by glob pattern.",
    detail: "Fast path discovery across the workspace.",
  },
  {
    id: "tool:grep",
    name: "grep",
    category: "Filesystem",
    description: "Search file contents by pattern.",
    detail: "Ripgrep-style content search within allowed roots.",
  },
  {
    id: "tool:task",
    name: "task",
    category: "Orchestration",
    description: "Delegate to explorer / coder / reviewer subagents.",
    detail:
      "Deep Agents `task` tool. Skills with frontmatter `agent:` register extra subagents at boot. Prefer multiple `task` calls in one turn when independent.",
  },
];

const CUSTOM_TOOLS: Array<{
  id: string;
  name: string;
  category: string;
  description: string;
  detail: string;
  desktopOnly?: boolean;
}> = [
  {
    id: "tool:request_folder_access",
    name: "request_folder_access",
    category: "Access",
    description: "Ask human approval to grant a folder into the allowlist.",
    detail: "Required before reading/writing outside the default workspace root.",
  },
  {
    id: "tool:show_allowed_folders",
    name: "show_allowed_folders",
    category: "Access",
    description: "Show current workspace allowlist.",
    detail: "Lists folders the shell/filesystem tools may touch.",
  },
  {
    id: "tool:task_plan",
    name: "task_plan",
    category: "Workflow",
    description: "Save the markdown plan for the current task.",
    detail: "Mandatory before coding work unless user skips plan.",
  },
  {
    id: "tool:task_todos",
    name: "task_todos",
    category: "Workflow",
    description: "Create atomic todos from the plan.",
    detail: "Requires `task_plan` first.",
  },
  {
    id: "tool:task_todo_update",
    name: "task_todo_update",
    category: "Workflow",
    description: "Update todo status (pending/in_progress/completed).",
    detail: "Drive the execute loop one todo at a time when dependent.",
  },
  {
    id: "tool:task_status",
    name: "task_status",
    category: "Workflow",
    description: "Show plan + todo board progress.",
    detail: "Quick status snapshot for the current `.agent/task` board.",
  },
  {
    id: "tool:task_verify",
    name: "task_verify",
    category: "Workflow",
    description: "Verify execution against plan/todos.",
    detail: "Returns VERIFY PASS/FAIL before final user summary.",
  },
  {
    id: "tool:delegate_task",
    name: "delegate_task",
    category: "Orchestration",
    description: "Spawn ≥3 parallel LLM workers in one call.",
    detail:
      "Usually unnecessary after approved task_todos — runtime already injects fixed explorer/coder/reviewer synthesis. Use for a new independent research batch only.",
  },
  {
    id: "tool:web_search",
    name: "web_search",
    category: "Web",
    description: "Search the public web.",
    detail: "Returns ranked snippets for follow-up extraction.",
  },
  {
    id: "tool:web_extract",
    name: "web_extract",
    category: "Web",
    description: "Extract readable text from a URL.",
    detail: "Use after web_search when you need page body content.",
  },
  {
    id: "tool:memory_store",
    name: "memory_store",
    category: "Memory",
    description: "Store a long-term memory record.",
    detail: "Kinds: fact, preference, episode, error, guideline.",
  },
  {
    id: "tool:memory_recall",
    name: "memory_recall",
    category: "Memory",
    description: "Semantic + lexical recall from LTM.",
    detail: "Prefer fresh tool evidence when memories conflict with the workspace.",
  },
  {
    id: "tool:remember_rule",
    name: "remember_rule",
    category: "Memory",
    description: "Persist a WHEN→DO guideline into memory + AGENTS.md.",
    detail: "Use after non-obvious fixes or fatal mistakes.",
  },
  {
    id: "tool:skill_manage",
    name: "skill_manage",
    category: "Skills",
    description: "Create, patch, or delete skills under /skills/.",
    detail: "Maintains `.agent/skills/<name>/SKILL.md`.",
  },
  {
    id: "tool:process_manage",
    name: "process_manage",
    category: "Process",
    description: "Start/list/poll/kill background processes.",
    detail: "Long-lived servers and workers; also listed in the Connection panel.",
  },
  {
    id: "tool:vault_store",
    name: "vault_store",
    category: "Vault",
    description: "Store an encrypted credential.",
    detail: "Secrets stay out of transcripts; retrieve via vault_get.",
  },
  {
    id: "tool:vault_list",
    name: "vault_list",
    category: "Vault",
    description: "List vault entry names (not values).",
    detail: "Safe inventory of stored credentials.",
  },
  {
    id: "tool:vault_get",
    name: "vault_get",
    category: "Vault",
    description: "Retrieve a decrypted vault secret.",
    detail: "Use sparingly; never echo secrets into chat.",
  },
  {
    id: "tool:vault_delete",
    name: "vault_delete",
    category: "Vault",
    description: "Delete a vault entry.",
    detail: "Irreversible removal of a stored credential.",
  },
  {
    id: "tool:browser_open",
    name: "browser_open",
    category: "Browser",
    description: "Open a page in headless Chromium.",
    detail: "Playwright-backed SPA / JS interaction.",
  },
  {
    id: "tool:browser_click",
    name: "browser_click",
    category: "Browser",
    description: "Click a selector in the browser session.",
    detail: "Requires an active browser_open session.",
  },
  {
    id: "tool:browser_type",
    name: "browser_type",
    category: "Browser",
    description: "Type into a page element.",
    detail: "Fill forms / search boxes in the headless browser.",
  },
  {
    id: "tool:browser_eval",
    name: "browser_eval",
    category: "Browser",
    description: "Evaluate JavaScript in the page.",
    detail: "For DOM inspection or custom extraction.",
  },
  {
    id: "tool:browser_screenshot",
    name: "browser_screenshot",
    category: "Browser",
    description: "Capture a screenshot of the page.",
    detail: "Useful before vision_analyze.",
  },
  {
    id: "tool:browser_close",
    name: "browser_close",
    category: "Browser",
    description: "Close the browser session.",
    detail: "Frees Playwright resources.",
  },
  {
    id: "tool:vision_analyze",
    name: "vision_analyze",
    category: "Vision",
    description: "Multimodal analysis of a local image/screenshot.",
    detail: "Describe UI state, errors, or visual diffs.",
  },
  {
    id: "tool:read_document",
    name: "read_document",
    category: "Filesystem",
    description: "Extract text from Word/Excel/text documents.",
    detail:
      "Use for .docx/.xlsx instead of read_file (those are binary ZIP packages).",
  },
  {
    id: "tool:graphify_status",
    name: "graphify_status",
    category: "Codebase graph",
    description: "Check project Graphify graph readiness.",
    detail: "Looks for <project>/graphify-out/graph.json (project-scoped).",
  },
  {
    id: "tool:graphify_query",
    name: "graphify_query",
    category: "Codebase graph",
    description: "Query the project knowledge graph for architecture questions.",
    detail:
      "Cursor-style: prefer this when graph exists before broad grep / reading GRAPH_REPORT.md.",
  },
  {
    id: "tool:graphify_path",
    name: "graphify_path",
    category: "Codebase graph",
    description: "Shortest path between two concepts in the project graph.",
    detail: "e.g. AuthModule → Database.",
  },
  {
    id: "tool:graphify_explain",
    name: "graphify_explain",
    category: "Codebase graph",
    description: "Explain a concept/node and its neighbors.",
    detail: "Plain-language subgraph summary.",
  },
  {
    id: "tool:graphify_update",
    name: "graphify_update",
    category: "Codebase graph",
    description: "Build or refresh the project Graphify graph.",
    detail: "AST-only update into <project>/graphify-out/ (not per session).",
  },
  {
    id: "tool:git_status",
    name: "git_status",
    category: "Git",
    description: "Branch + short git status.",
    detail: "Prefer over raw execute('git status').",
  },
  {
    id: "tool:git_diff",
    name: "git_diff",
    category: "Git",
    description: "Show unstaged or staged diff.",
    detail: "Optional path filter; staged=true for index.",
  },
  {
    id: "tool:git_log",
    name: "git_log",
    category: "Git",
    description: "Recent commits (oneline).",
    detail: "Default last 10 commits.",
  },
  {
    id: "tool:git_add",
    name: "git_add",
    category: "Git",
    description: "Stage files for commit.",
    detail: "Requires approval unless auto-approve.",
  },
  {
    id: "tool:git_commit",
    name: "git_commit",
    category: "Git",
    description: "Create a commit (no amend/force).",
    detail: "Requires approval unless auto-approve.",
  },
  {
    id: "tool:find_symbol",
    name: "find_symbol",
    category: "Code navigation",
    description: "Go-to-definition (TypeScript LS or ripgrep).",
    detail: "Uses tsconfig language service when available.",
  },
  {
    id: "tool:find_references",
    name: "find_references",
    category: "Code navigation",
    description: "Find all references to a symbol.",
    detail: "TypeScript language service when available; else ripgrep -w.",
  },
  {
    id: "tool:run_tests",
    name: "run_tests",
    category: "Verification",
    description: "Run project tests or typecheck.",
    detail: "Auto-detects npm scripts; use after edits.",
  },
  {
    id: "tool:desktop_automate",
    name: "desktop_automate",
    category: "Desktop",
    description: "Control allowlisted macOS apps (Chrome-first).",
    detail: "open_url / open_app etc. Requires human approval unless auto-approve.",
    desktopOnly: true,
  },
  {
    id: "tool:request_desktop_app_access",
    name: "request_desktop_app_access",
    category: "Desktop",
    description: "Request approval to control another desktop app.",
    detail: "Expands the desktop allowlist beyond Chrome.",
    desktopOnly: true,
  },
  {
    id: "tool:show_desktop_apps",
    name: "show_desktop_apps",
    category: "Desktop",
    description: "Show desktop automation allowlist.",
    detail: "Lists apps the agent may drive via desktop_automate.",
    desktopOnly: true,
  },
];

function prefsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PREFS_REL);
}

export function readCapabilitiesPrefs(workspaceRoot: string): CapabilitiesPrefs {
  const file = prefsPath(workspaceRoot);
  if (!fs.existsSync(file)) return { disabled: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CapabilitiesPrefs;
    return { disabled: Array.isArray(raw.disabled) ? raw.disabled.map(String) : [] };
  } catch {
    return { disabled: [] };
  }
}

export function writeCapabilitiesPrefs(
  workspaceRoot: string,
  prefs: CapabilitiesPrefs,
): void {
  const file = prefsPath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}

export function setCapabilityEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): CapabilitiesPrefs {
  const prefs = readCapabilitiesPrefs(workspaceRoot);
  const set = new Set(prefs.disabled);
  if (enabled) set.delete(id);
  else set.add(id);
  const next = { disabled: [...set].sort() };
  writeCapabilitiesPrefs(workspaceRoot, next);
  return next;
}

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

function skillCategory(name: string, description: string): string {
  const blob = `${name} ${description}`.toLowerCase();
  if (/security|vault|auth/.test(blob)) return "Security";
  if (/test|tdd|verify|benchmark/.test(blob)) return "Testing";
  if (/frontend|ui|react/.test(blob)) return "Frontend";
  if (/backend|api|server/.test(blob)) return "Backend";
  if (/desktop|chrome|browser/.test(blob)) return "Desktop";
  if (/memory|plan|workflow|coding|debug|review|terminal|workspace|skill/.test(blob))
    return "Workflow";
  return "General";
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

function listSkills(workspaceRoot: string, disabled: Set<string>): CapabilityItem[] {
  const dir = path.join(workspaceRoot, ".agent", "skills");
  const items: CapabilityItem[] = [];
  for (const skillFile of findSkillFiles(dir)) {
    const relDir = path.dirname(skillFile);
    const folderName = path.basename(relDir);
    const rel = path.relative(dir, relDir);
    const raw = fs.readFileSync(skillFile, "utf8");
    const fm = parseSkillFrontmatter(raw);
    const name = fm.name || folderName;
    const description = fm.description || "Agent skill (on-demand).";
    const id = `skill:${rel.replaceAll(path.sep, "/")}`;
    const bodyStart = raw.startsWith("---")
      ? raw.indexOf("\n---", 3) + 4
      : 0;
    const body = raw.slice(Math.max(0, bodyStart)).trim();
    items.push({
      id,
      kind: "skills",
      name,
      category: skillCategory(name, description),
      description,
      badge: "learned",
      enabled: !disabled.has(id),
      detailMarkdown: [
        `# ${name}`,
        "",
        description,
        "",
        `- **Path**: \`.agent/skills/${rel.replaceAll(path.sep, "/")}/SKILL.md\``,
        `- **Virtual**: \`/skills/${rel.replaceAll(path.sep, "/")}/SKILL.md\``,
        `- **Mode**: catalog descriptions in system prompt; full body on-demand via read_file`,
        "",
        "## Skill document",
        "",
        body.slice(0, 6000) + (body.length > 6000 ? "\n\n…" : ""),
      ].join("\n"),
      meta: { folder: rel },
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function listTools(
  desktopEnabled: boolean,
  disabled: Set<string>,
): CapabilityItem[] {
  const all = [
    ...BUILTIN_TOOLS.map((t) => ({ ...t, desktopOnly: false })),
    ...CUSTOM_TOOLS,
  ].filter((t) => !t.desktopOnly || desktopEnabled);

  return all.map((t) => ({
    id: t.id,
    kind: "tools" as const,
    name: t.name,
    category: t.category,
    description: t.description,
    badge: t.desktopOnly ? "desktop" : undefined,
    enabled: !disabled.has(t.id),
    detailMarkdown: [
      `# ${t.name}`,
      "",
      t.description,
      "",
      `- **Category**: ${t.category}`,
      `- **Id**: \`${t.id}\``,
      t.desktopOnly ? "- **Requires**: macOS desktop automation enabled" : "",
      "",
      "## Notes",
      "",
      t.detail,
      "",
      "```ts",
      `// model invokes via native tool calling`,
      `await tools.${t.name}(/* args */)`,
      "```",
    ]
      .filter(Boolean)
      .join("\n"),
  }));
}

function listMcp(workspaceRoot: string, disabled: Set<string>): CapabilityItem[] {
  const candidates = [
    path.join(workspaceRoot, ".agent", "mcp.json"),
    path.join(workspaceRoot, ".mcp.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
        mcpServers?: Record<
          string,
          { command?: string; args?: string[]; url?: string; description?: string }
        >;
      };
      const servers = raw.mcpServers ?? {};
      return Object.entries(servers)
        .map(([name, cfg]) => {
          const id = `mcp:${name}`;
          const description =
            cfg.description ||
            cfg.command ||
            cfg.url ||
            "Configured MCP server";
          return {
            id,
            kind: "mcp" as const,
            name,
            category: "MCP",
            description,
            badge: "configured",
            enabled: !disabled.has(id),
            detailMarkdown: [
              `# ${name}`,
              "",
              description,
              "",
              `- **Config**: \`${path.relative(workspaceRoot, file)}\``,
              cfg.command ? `- **Command**: \`${cfg.command} ${(cfg.args ?? []).join(" ")}\`` : "",
              cfg.url ? `- **URL**: ${cfg.url}` : "",
              "",
              "MCP tools from this server are loaded into the agent at runtime (names prefixed `mcp_<server>_`). Disable via Capabilities if unused.",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      /* ignore corrupt config */
    }
  }
  return [];
}

export function listCapabilities(options: {
  workspaceRoot: string;
  desktopEnabled?: boolean;
}): {
  skills: CapabilityItem[];
  tools: CapabilityItem[];
  mcp: CapabilityItem[];
  counts: { skills: number; tools: number; mcp: number };
} {
  const prefs = readCapabilitiesPrefs(options.workspaceRoot);
  const disabled = new Set(prefs.disabled);
  const skills = listSkills(options.workspaceRoot, disabled);
  const tools = listTools(Boolean(options.desktopEnabled), disabled);
  const mcp = listMcp(options.workspaceRoot, disabled);
  return {
    skills,
    tools,
    mcp,
    counts: { skills: skills.length, tools: tools.length, mcp: mcp.length },
  };
}

/** Runtime filter derived from `.agent/capabilities-prefs.json`. */
export type CapabilityFilter = {
  disabledIds: Set<string>;
  /** Tool names (without `tool:` prefix) that must be hidden/rejected. */
  disabledToolNames: Set<string>;
  /** Skill folder names under `.agent/skills/` that must be inaccessible. */
  disabledSkillFolders: Set<string>;
  /** MCP server names that should not be connected. */
  disabledMcpServers: Set<string>;
};

export function resolveCapabilityFilter(workspaceRoot: string): CapabilityFilter {
  const prefs = readCapabilitiesPrefs(workspaceRoot);
  const disabledIds = new Set(prefs.disabled);
  const disabledToolNames = new Set<string>();
  const disabledSkillFolders = new Set<string>();
  const disabledMcpServers = new Set<string>();
  for (const id of disabledIds) {
    if (id.startsWith("tool:")) disabledToolNames.add(id.slice("tool:".length));
    else if (id.startsWith("skill:"))
      disabledSkillFolders.add(id.slice("skill:".length));
    else if (id.startsWith("mcp:"))
      disabledMcpServers.add(id.slice("mcp:".length));
  }
  return {
    disabledIds,
    disabledToolNames,
    disabledSkillFolders,
    disabledMcpServers,
  };
}

export function filterToolsByCapability<T extends { name: string }>(
  tools: readonly T[],
  disabledToolNames: Set<string>,
): T[] {
  if (disabledToolNames.size === 0) return [...tools];
  return tools.filter((t) => !disabledToolNames.has(t.name));
}

/**
 * Deep Agents filesystem permission rules that deny access to disabled skills
 * under the `/skills/` virtual mount.
 */
export function buildDisabledSkillPermissions(
  disabledSkillFolders: Set<string>,
): Array<{
  operations: readonly ["read", "write"];
  paths: string[];
  mode: "deny";
}> {
  const rules = [];
  for (const folder of disabledSkillFolders) {
    if (!folder || folder.includes("..") || folder.includes("/") || folder.includes("\\")) {
      continue;
    }
    rules.push({
      operations: ["read", "write"] as const,
      paths: [`/skills/${folder}`, `/skills/${folder}/**`],
      mode: "deny" as const,
    });
  }
  return rules;
}

/** Filter MCP server map by disabled prefs. */
export function filterMcpServers<T>(
  servers: Record<string, T>,
  disabledMcpServers: Set<string>,
): Record<string, T> {
  if (disabledMcpServers.size === 0) return { ...servers };
  const out: Record<string, T> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!disabledMcpServers.has(name)) out[name] = cfg;
  }
  return out;
}
