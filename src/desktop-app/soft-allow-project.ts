/**
 * Soft-align sandbox to a project without agent reboot.
 * Expands PtySandbox allowlist so workspace/session can use project folders
 * while another turn is still running.
 */
import type { AgentBundle } from "../agent/create-agent.js";
import {
  loadProjectRegistry,
  primaryFolderOf,
  type ProjectRecord,
} from "../agent/projects/index.js";

export type SoftAllowResult =
  | {
      ok: true;
      projectId: string;
      folders: string[];
      added: string[];
      softAligned: true;
    }
  | { ok: false; error: string };

export function projectFoldersOf(project: ProjectRecord | null | undefined): string[] {
  if (!project) return [];
  const folders = [...(project.folders ?? [])].map((f) => String(f).trim()).filter(Boolean);
  const primary = primaryFolderOf(project);
  if (primary && !folders.includes(primary)) folders.unshift(primary);
  return [...new Set(folders)];
}

export function softAllowProjectFolders(
  bundle: AgentBundle | null | undefined,
  agentStateRoot: string,
  projectId: string | null | undefined,
): SoftAllowResult {
  const id = String(projectId || "").trim();
  if (!id) return { ok: false, error: "projectId required" };
  if (!bundle?.sandbox) {
    return { ok: false, error: "Agent engine not ready" };
  }
  const project =
    loadProjectRegistry(agentStateRoot).projects.find((p) => p.id === id) ?? null;
  if (!project) return { ok: false, error: `Unknown project: ${id}` };

  const folders = projectFoldersOf(project);
  if (!folders.length) {
    return { ok: false, error: `Project "${project.name}" has no folders` };
  }

  const sandbox = bundle.sandbox as {
    allowFolders?: (paths: string[]) => string[];
  };
  if (typeof sandbox.allowFolders !== "function") {
    return {
      ok: false,
      error: "Sandbox cannot soft-allow folders; finish running turns first.",
    };
  }
  const added = sandbox.allowFolders(folders);
  return {
    ok: true,
    projectId: id,
    folders,
    added,
    softAligned: true,
  };
}
