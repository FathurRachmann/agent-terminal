/**
 * Workspace roots shown in Files / used for deliverable search.
 * General sessions (no project folders) → artifact home only.
 * Project sessions → project folders + artifact home (virtual dual roots).
 */
import path from "node:path";

export function buildDeliverySearchRoots(input: {
  projectFolders?: string[] | null;
  toolWorkspaceRoot: string;
  artifactHome: string;
}): string[] {
  const roots = [
    ...(input.projectFolders ?? []),
    input.toolWorkspaceRoot,
    input.artifactHome,
  ].filter(Boolean);
  return [...new Set(roots.map((r) => path.resolve(String(r))))];
}

/** Payload fields shared by newSession / openSession / setActiveProject. */
export function sessionWorkspaceFields(input: {
  workspaceRoot: string;
  projectFolders: string[] | null;
  activeProjectId: string | null;
  projectId?: string | null;
}): {
  workspaceRoot: string;
  projectFolders: string[] | null;
  activeProjectId: string | null;
  projectId: string | null;
} {
  return {
    workspaceRoot: input.workspaceRoot,
    projectFolders: input.projectFolders,
    activeProjectId: input.activeProjectId,
    projectId:
      input.projectId !== undefined
        ? input.projectId
        : input.activeProjectId,
  };
}
