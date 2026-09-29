import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import type { PtySandbox } from "../sandbox/pty-sandbox.js";
import { expandUserPath } from "../sandbox/guardrails.js";
import { addFolderAllowlist } from "./folder-allowlist.js";

export type WorkspaceAccessToolsOptions = {
  /** Profile home for persisting HITL folder grants across reboots. */
  profileHome?: string;
};

/**
 * HITL-gated folder grant. Always register under interruptOn.request_folder_access
 * so the UI shows Approve/Deny before the sandbox allowlist expands.
 */
export function createWorkspaceAccessTools(
  sandbox: PtySandbox,
  options?: WorkspaceAccessToolsOptions,
) {
  const profileHome = options?.profileHome
    ? path.resolve(options.profileHome)
    : null;

  const requestFolderAccess = tool(
    async ({ folderPath }: { folderPath: string }) => {
      const expanded = expandUserPath(folderPath);
      const resolved = path.resolve(expanded);
      if (!fs.existsSync(resolved)) {
        return [
          `Folder does not exist: ${resolved}`,
          `If you need a new subfolder, call request_folder_access on an existing parent (e.g. Desktop), then mkdir inside it.`,
        ].join("\n");
      }
      if (!fs.statSync(resolved).isDirectory()) {
        return `Not a directory: ${resolved}`;
      }

      const granted = sandbox.grantFolderAccess(resolved);
      if (profileHome) {
        try {
          addFolderAllowlist(profileHome, granted);
        } catch {
          /* still granted for this session */
        }
      }
      const roots = sandbox.getAllowedRoots();
      const privacy = sandbox.isPrivacyStrict()
        ? "Privacy ON (project confinement — outside paths need request_folder_access)"
        : "Privacy OFF (full machine access)";
      return [
        `Granted folder access (allowlist updated).`,
        `Active cwd: ${granted}`,
        privacy,
        `Allowed folders:`,
        ...roots.map((r) => `- ${r}`),
        sandbox.isPrivacyStrict()
          ? `Shell/file tools can only touch these folders. Outside paths stay blocked until approved.`
          : `Privacy is OFF — broad machine access is already available; this grant is optional.`,
      ].join("\n");
    },
    {
      name: "request_folder_access",
      description:
        "Request permission to access a folder outside the current allowlist. " +
        "ONLY when Privacy is ON (project-only). When Privacy is OFF the whole machine is already allowed — do NOT call this tool. " +
        "ALWAYS call this BEFORE reading/writing/executing outside the allowlist — " +
        "do NOT ask for permission in chat text; this tool opens the Approve/Deny UI. " +
        "After the user approves, the sandbox allowlist expands and you may continue. " +
        "Pass an existing directory (e.g. ~/Desktop); create new subfolders after grant.",
      schema: z.object({
        folderPath: z
          .string()
          .describe(
            "Absolute path or ~/… folder the user named (e.g. /Users/me/Desktop)",
          ),
      }),
    },
  );

  const showAllowedFolders = tool(
    async () => {
      const roots = sandbox.getAllowedRoots();
      const privacy = sandbox.isPrivacyStrict()
        ? "Privacy ON (project confinement)"
        : "Privacy OFF (full machine access)";
      return [
        `Active cwd: ${sandbox.getWorkspaceRoot()}`,
        privacy,
        `Allowed folders:`,
        ...roots.map((r) => `- ${r}`),
      ].join("\n");
    },
    {
      name: "show_allowed_folders",
      description:
        "List folders the agent is currently allowed to access, and whether Privacy is ON or OFF.",
      schema: z.object({}),
    },
  );

  return [requestFolderAccess, showAllowedFolders];
}
