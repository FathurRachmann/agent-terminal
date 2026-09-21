import path from "node:path";
import {
  isWorkspaceThreadId,
  parseWorkspaceThreadId,
} from "./workspaces/chats.js";

export type WorkingScopeKind = "global" | "bots" | "project";

export type WorkingScope = {
  kind: WorkingScopeKind;
  /** Relative to Agent root, e.g. working/global */
  relDir: string;
  /** Relative uploads dir, e.g. working/global/uploads */
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

/**
 * Artifact layout under Agent repo root:
 * - sesi biasa → working/global
 * - bots (sidebar bot session) → working/bots
 * - project / workspace → working/project/<nama>
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
      !workspaceId && threadId ? parseWorkspaceThreadId(threadId)?.workspaceId : null;
    const stableId = workspaceId || parsedWs || "";
    const slug = slugifyProjectName(
      projectName || projectId || stableId || "workspace",
    );
    const relDir = path.posix.join("working", "project", slug);
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
      relDir: "working/bots",
      uploadsRelDir: "working/bots/uploads",
    };
  }

  // Global session with an active/bound project.
  if (projectId || projectName) {
    const slug = slugifyProjectName(projectName || projectId);
    const relDir = path.posix.join("working", "project", slug);
    return {
      kind: "project",
      relDir,
      uploadsRelDir: path.posix.join(relDir, "uploads"),
    };
  }

  return {
    kind: "global",
    relDir: "working/global",
    uploadsRelDir: "working/global/uploads",
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

/** True when a relative/abs path targets the shared working/ tree. */
export function isWorkingRelativePath(filePath: string): boolean {
  const norm = String(filePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm) return false;
  if (path.isAbsolute(norm)) {
    const parts = norm.split("/");
    const idx = parts.lastIndexOf("working");
    return idx >= 0;
  }
  return norm === "working" || norm.startsWith("working/");
}

/**
 * Remap tool paths that start with working/ onto Agent root (artifact home),
 * so writes do not land inside the active project primary folder.
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
  if (norm === "working" || norm.startsWith("working/")) {
    return path.resolve(artifactHome, trimmed);
  }
  return path.resolve(cwd, trimmed);
}

export function workingScopeInstruction(scope: WorkingScope, absDir: string): string {
  return [
    "[WORKING SCOPE — ARTIFACTS ONLY]",
    `Write ALL generated artifacts under \`${scope.relDir}/\` (absolute: ${absDir}).`,
    "Layout: working/global (sesi biasa), working/bots (bot session), working/project/<nama> (project/workspace).",
    `Uploads go under \`${scope.uploadsRelDir}/\`.`,
    "CRITICAL: `working/…` is NOT the project source tree. To inspect code, `ls` / `read_file` / `grep` the assigned project primary folder (absolute path from bot instruction) — never conclude the repo is empty after looking only under working/.",
    "Do not write scratch outputs into the active project source tree or bare working/ at project cwd.",
    "For write_file / edit_file prefer paths starting with working/… — the runtime maps them to the Agent root.",
    `For shell: mkdir -p "${absDir}" and write files there (use the absolute path).`,
    "When the user asks for a file (kirim/mana filenya): put the path in backticks once. Desktop chat auto-attaches a File card — do NOT tell them to open it from disk; keep the reply short.",
  ].join("\n");
}
