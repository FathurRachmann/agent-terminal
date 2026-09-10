import { tool } from "langchain";
import { z } from "zod";
import { grantDesktopApp, loadDesktopAllowlist } from "./allowlist.js";
import { runDesktopAction } from "./actions.js";
import {
  getFrontmostApplication,
  isDesktopAutomationEnabled,
  isDesktopAutomationSupported,
  KEYSTROKE_MAX_CHARS,
} from "./macos.js";

/**
 * HITL-gated desktop automation tools (macOS / Chrome-first).
 * Register interruptOn for desktop_automate + request_desktop_app_access.
 * Read-only status uses show_desktop_apps (no interrupt).
 */
export function createDesktopTools(workspaceRoot: string) {
  const desktopAutomate = tool(
    async (input: {
      action: "open_app" | "activate_app" | "open_url" | "keystroke";
      app?: string;
      url?: string;
      text?: string;
      modifiers?: Array<"cmd" | "shift" | "option" | "control">;
    }) => {
      const result = await runDesktopAction(workspaceRoot, input);
      return result.ok ? result.message : `Error: ${result.message}`;
    },
    {
      name: "desktop_automate",
      description:
        "Control allowlisted macOS desktop apps via osascript (Chrome-first). " +
        "Prefer this over mouse/UI clicking for desktop tasks. " +
        "Mutating actions: open_app, activate_app, open_url (http/https), keystroke, youtube_play_first. " +
        "Human must approve (y/n). " +
        "Keystroke needs Accessibility permission for Terminal/Cursor. " +
        "youtube_play_first clicks the first result on a YouTube results page (Chrome must allow JavaScript from Apple Events). " +
        "Default allowed app: Google Chrome. Use request_desktop_app_access for others. " +
        "Use show_desktop_apps for allowlist + frontmost (no approval).",
      schema: z.object({
        action: z.enum([
          "open_app",
          "activate_app",
          "open_url",
          "keystroke",
          "youtube_play_first",
        ]),
        app: z
          .string()
          .optional()
          .describe('App name (default "Google Chrome" for open_url/keystroke)'),
        url: z.string().optional().describe("http(s) URL for open_url"),
        text: z
          .string()
          .max(KEYSTROKE_MAX_CHARS)
          .optional()
          .describe(`Keystroke text (max ${KEYSTROKE_MAX_CHARS} chars)`),
        modifiers: z
          .array(z.enum(["cmd", "shift", "option", "control"]))
          .optional()
          .describe("Optional modifiers for keystroke (e.g. cmd for Cmd+L)"),
      }),
    },
  );

  const requestDesktopAppAccess = tool(
    async ({ appName }: { appName: string }) => {
      if (!isDesktopAutomationEnabled()) {
        return "Desktop automation disabled (DESKTOP_AUTOMATION=0).";
      }
      if (!isDesktopAutomationSupported()) {
        return "Desktop automation is only supported on macOS.";
      }
      const name = appName.trim();
      if (!name) {
        return "Error: empty app name";
      }
      const apps = grantDesktopApp(workspaceRoot, name);
      return [
        `Granted desktop app access: ${name}`,
        "Allowed apps:",
        ...apps.map((a) => `- ${a}`),
      ].join("\n");
    },
    {
      name: "request_desktop_app_access",
      description:
        "Request permission to control another macOS app (beyond the Chrome-first allowlist). " +
        "Human must approve (y/n). After approval, desktop_automate may target that app.",
      schema: z.object({
        appName: z
          .string()
          .describe('Exact macOS application name, e.g. "Safari" or "Slack"'),
      }),
    },
  );

  const showDesktopApps = tool(
    async () => {
      if (!isDesktopAutomationEnabled()) {
        return "Desktop automation disabled (DESKTOP_AUTOMATION=0).";
      }
      if (!isDesktopAutomationSupported()) {
        return "Desktop automation is only supported on macOS.";
      }
      const apps = loadDesktopAllowlist(workspaceRoot);
      let frontmost = "(unavailable)";
      try {
        frontmost = await getFrontmostApplication();
      } catch (err) {
        frontmost = err instanceof Error ? err.message : String(err);
      }
      return [
        `Platform: ${process.platform}`,
        `Frontmost app: ${frontmost}`,
        "Allowed desktop apps:",
        ...apps.map((a) => `- ${a}`),
      ].join("\n");
    },
    {
      name: "show_desktop_apps",
      description:
        "List desktop allowlist (default: Google Chrome) and the frontmost app. Read-only; no approval.",
      schema: z.object({}),
    },
  );

  return [desktopAutomate, requestDesktopAppAccess, showDesktopApps];
}
