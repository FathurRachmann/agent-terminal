import path from "node:path";
import {
  isWorkspaceThreadId,
  parseWorkspaceThreadId,
} from "./workspaces/chats.js";

import {
  TEMPLATES_REL_DIR,
  documentTemplatesInstruction,
  ensureTemplatesDir,
} from "./document-templates.js";

/**
 * Scratch / artifact root under Agent application root.
 * Legacy alias `working/` still remaps here so old prompts/paths keep working.
 */
export const ARTIFACT_ROOT = "tmp";
/** Accepted prefixes in tool paths (first is canonical). */
export const ARTIFACT_ROOT_ALIASES = [ARTIFACT_ROOT, "working"] as const;

export type WorkingScopeKind = "global" | "bots" | "project";

export type WorkingScope = {
  kind: WorkingScopeKind;
  /** Relative to Agent root, e.g. tmp/global */
  relDir: string;
  /** Relative uploads dir, e.g. tmp/global/uploads */
  uploadsRelDir: string;
};

export type WorkingScopeInput = {
  threadId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  botId?: string | null;
  workspaceId?: string | null;
};

const BOT_THREAD_RE = /^bot-/i;

export function isBotThreadId(threadId: string | null | undefined): boolean {
  return Boolean(threadId && BOT_THREAD_RE.test(threadId));
}

export { isWorkspaceThreadId };

/** Safe folder segment for project names. */
export function slugifyProjectName(name: string): string {
  const raw = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "unnamed";
}

function artifactJoin(...parts: string[]): string {
  return path.posix.join(ARTIFACT_ROOT, ...parts);
}

/**
 * True when path (relative or absolute) targets the artifact tree
 * (`tmp/…` or legacy `working/…`).
 */
export function isWorkingRelativePath(filePath: string): boolean {
  const norm = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm) return false;
  if (path.isAbsolute(norm)) {
    const parts = norm.split("/");
    return ARTIFACT_ROOT_ALIASES.some((a) => parts.includes(a));
  }
  return ARTIFACT_ROOT_ALIASES.some(
    (a) => norm === a || norm.startsWith(`${a}/`),
  );
}

/**
 * Normalize `working/…` → `tmp/…` (canonical). Leaves other paths unchanged.
 */
export function canonicalizeArtifactRelPath(filePath: string): string {
  const norm = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm) return norm;
  for (const alias of ARTIFACT_ROOT_ALIASES) {
    if (norm === alias) return ARTIFACT_ROOT;
    if (norm.startsWith(`${alias}/`)) {
      return `${ARTIFACT_ROOT}${norm.slice(alias.length)}`;
    }
  }
  return norm;
}

/**
 * Artifact layout under Agent repo root:
 * - sesi biasa → tmp/global
 * - bots (sidebar bot session) → tmp/bots
 * - project / workspace → tmp/project/<nama>
 */
export function resolveWorkingScope(input: WorkingScopeInput): WorkingScope {
  const workspaceId = String(input.workspaceId || "").trim();
  const projectId = String(input.projectId || "").trim();
  const projectName = String(input.projectName || "").trim();
  const botId = String(input.botId || "").trim();
  const threadId = input.threadId ?? null;

  // Workspace group chat always uses the assigned project folder.
  if (workspaceId || isWorkspaceThreadId(threadId)) {
    const parsedWs =
      !workspaceId && threadId
        ? parseWorkspaceThreadId(threadId)?.workspaceId
        : null;
    const stableId = workspaceId || parsedWs || "";
    const slug = slugifyProjectName(
      projectName || projectId || stableId || "workspace",
    );
    const relDir = artifactJoin("project", slug);
    return {
      kind: "project",
      relDir,
      uploadsRelDir: path.posix.join(relDir, "uploads"),
    };
  }

  // Specialized / sidebar bot sessions.
  if (isBotThreadId(threadId) || botId) {
    return {
      kind: "bots",
      relDir: artifactJoin("bots"),
      uploadsRelDir: artifactJoin("bots", "uploads"),
    };
  }

  // Global session with an active/bound project.
  if (projectId || projectName) {
    const slug = slugifyProjectName(projectName || projectId);
    const relDir = artifactJoin("project", slug);
    return {
      kind: "project",
      relDir,
      uploadsRelDir: path.posix.join(relDir, "uploads"),
    };
  }

  return {
    kind: "global",
    relDir: artifactJoin("global"),
    uploadsRelDir: artifactJoin("global", "uploads"),
  };
}

export function workingScopeAbs(
  agentRoot: string,
  scope: WorkingScope,
): { absDir: string; uploadsAbsDir: string } {
  const root = path.resolve(agentRoot);
  return {
    absDir: path.join(root, ...scope.relDir.split("/")),
    uploadsAbsDir: path.join(root, ...scope.uploadsRelDir.split("/")),
  };
}

/**
 * Remap tool paths that start with tmp/ or legacy working/ onto Agent root
 * (artifact home), so writes do not land inside the active project folder.
 */
export function resolveWorkingAwarePath(
  artifactHome: string,
  cwd: string,
  filePath: string,
): string {
  const trimmed = String(filePath || "").trim();
  if (!trimmed) return path.resolve(cwd);
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  const norm = trimmed.replace(/\\/g, "/");
  if (isWorkingRelativePath(norm)) {
    return path.resolve(artifactHome, canonicalizeArtifactRelPath(norm));
  }
  return path.resolve(cwd, trimmed);
}

export function workingScopeInstruction(
  scope: WorkingScope,
  absDir: string,
): string {
  // absDir is …/tmp/global|bots|project/<slug> → artifact home is before /tmp/
  const norm = absDir.replace(/\\/g, "/");
  let home = path.resolve(absDir, "../..");
  for (const a of ARTIFACT_ROOT_ALIASES) {
    const marker = `/${a}/`;
    const idx = norm.lastIndexOf(marker);
    if (idx >= 0) {
      home = norm.slice(0, idx);
      break;
    }
  }
  try {
    ensureTemplatesDir(home);
  } catch {
    /* ignore */
  }
  return [
    "[WORKING SCOPE — ARTIFACTS ONLY]",
    `Write ALL generated artifacts under \`${scope.relDir}/\` (absolute: ${absDir}).`,
    `Layout: ${ARTIFACT_ROOT}/global (sesi biasa), ${ARTIFACT_ROOT}/bots (bot session), ${ARTIFACT_ROOT}/project/<nama> (project/workspace).`,
    `Uploads go under \`${scope.uploadsRelDir}/\`.`,
    `Format templates (laporan/BOD/quotation): \`${TEMPLATES_REL_DIR}/\` — ls + read TEMPLATE.md before generating.`,
    `CRITICAL: \`${ARTIFACT_ROOT}/…\` is NOT the project source tree. To inspect code, \`ls\` / \`read_file\` / \`grep\` the assigned project primary folder (absolute path from bot instruction) — never conclude the repo is empty after looking only under ${ARTIFACT_ROOT}/.`,
    `Do not write scratch outputs into the active project source tree or bare ${ARTIFACT_ROOT}/ at project cwd.`,
    `For write_file / edit_file prefer paths starting with ${ARTIFACT_ROOT}/… — the runtime maps them to the Agent root (legacy working/… also remaps here).`,
    "Never write_file .docx/.xlsx/.pptx/.pdf (binary) — use productivity skills + Python scripts.",
    `For shell: mkdir -p "${absDir}" and write files there (use the absolute path).`,
    "When the user asks for a file (kirim/mana filenya): put the path in backticks once. Desktop chat auto-attaches a File card — do NOT tell them to open it from disk; keep the reply short.",
    documentTemplatesInstruction(home),
  ].join("\n");
}
