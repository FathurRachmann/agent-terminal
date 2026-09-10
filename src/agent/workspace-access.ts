import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import type { PtySandbox } from "../sandbox/pty-sandbox.js";
import { expandUserPath } from "../sandbox/guardrails.js";

/**
 * HITL-gated folder grant. Register under interruptOn.request_folder_access
 * so the user must press y/n before the sandbox allowlist expands.
 */
export function createWorkspaceAccessTools(sandbox: PtySandbox) {
  const requestFolderAccess = tool(
    async ({ folderPath }: { folderPath: string }) => {
      const expanded = expandUserPath(folderPath);
      const resolved = path.resolve(expanded);
      if (!fs.existsSync(resolved)) {
        return `Folder does not exist: ${resolved}`;
      }
      if (!fs.statSync(resolved).isDirectory()) {
        return `Not a directory: ${resolved}`;
      }

      const granted = sandbox.grantFolderAccess(resolved);
      const roots = sandbox.getAllowedRoots();
      return [
        `Granted folder access (allowlist updated).`,
        `Active cwd: ${granted}`,
        `Allowed folders:`,
        ...roots.map((r) => `- ${r}`),
        `Shell/file tools can only touch these folders. Outside paths stay blocked.`,
      ].join("\n");
    },
    {
      name: "request_folder_access",
      description:
        "Request permission to access a folder on the user's machine. " +
        "Always call this BEFORE reading/writing/executing outside the current workspace. " +
        "Human must approve (y/n). After approval, the sandbox is confined to that folder " +
        "(plus previously granted folders).",
      schema: z.object({
        folderPath: z
          .string()
          .describe(
            "Absolute path or ~/… folder the user named (e.g. /Users/me/Documents/Project)",
          ),
      }),
    },
  );

  const showAllowedFolders = tool(
    async () => {
      const roots = sandbox.getAllowedRoots();
      return [
        `Active cwd: ${sandbox.getWorkspaceRoot()}`,
        `Allowed folders:`,
        ...roots.map((r) => `- ${r}`),
      ].join("\n");
    },
    {
      name: "show_allowed_folders",
      description:
        "List folders the agent is currently allowed to access (workspace confinement).",
      schema: z.object({}),
    },
  );

  return [requestFolderAccess, showAllowedFolders];
}
