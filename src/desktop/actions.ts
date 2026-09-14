import { resolveAllowedAppName, loadDesktopAllowlist } from "./allowlist.js";
import {
  activateApplication,
  chromeClickFirstYoutubeResult,
  getFrontmostApplication,
  isDesktopAutomationEnabled,
  isDesktopAutomationSupported,
  KEYSTROKE_MAX_CHARS,
  openApplication,
  openUrlInApp,
  sendKeystroke,
  type KeyModifier,
} from "./macos.js";

export type DesktopActionName =
  | "open_app"
  | "activate_app"
  | "open_url"
  | "keystroke"
  | "youtube_play_first"
  | "get_frontmost"
  | "show_allowed_apps";

export type DesktopActionInput = {
  action: DesktopActionName;
  app?: string;
  url?: string;
  text?: string;
  modifiers?: KeyModifier[];
};

export type DesktopActionResult = {
  ok: boolean;
  message: string;
};

const MUTATING: ReadonlySet<DesktopActionName> = new Set([
  "open_app",
  "activate_app",
  "open_url",
  "keystroke",
  "youtube_play_first",
]);

export function isMutatingDesktopAction(action: DesktopActionName): boolean {
  return MUTATING.has(action);
}

export function validateHttpUrl(
  url: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `blocked scheme: ${parsed.protocol} (only http/https)`,
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(url)) {
    return { ok: false, reason: "URL contains control characters" };
  }
  return { ok: true };
}

export async function runDesktopAction(
  workspaceRoot: string,
  input: DesktopActionInput,
): Promise<DesktopActionResult> {
  if (!isDesktopAutomationEnabled()) {
    return {
      ok: false,
      message: "Desktop automation disabled (DESKTOP_AUTOMATION=0).",
    };
  }
  if (!isDesktopAutomationSupported()) {
    return {
      ok: false,
      message: "Desktop automation is only supported on macOS.",
    };
  }

  try {
    switch (input.action) {
      case "show_allowed_apps": {
        const apps = loadDesktopAllowlist(workspaceRoot);
        return {
          ok: true,
          message: [
            "Allowed desktop apps:",
            ...apps.map((a) => `- ${a}`),
            apps.length === 1
              ? "(Chrome-first default. Use request_desktop_app_access to add more.)"
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
      case "get_frontmost": {
        const name = await getFrontmostApplication();
        return { ok: true, message: `Frontmost app: ${name}` };
      }
      case "open_app":
            case "activate_app": {
              const appRes = requireApp(workspaceRoot, input.app);
              if (!appRes.ok) return appRes;
              // appRes is guaranteed { ok: true; name: string } here
              const { name } = appRes as { ok: true; name: string };
              const msg =
                input.action === "open_app"
                  ? await openApplication(name)
                  : await activateApplication(name);
              return { ok: true, message: msg };
            }
      case "open_url": {
        const appRes = requireApp(workspaceRoot, input.app ?? "Google Chrome");
        if (!appRes.ok) return appRes;
        // appRes is guaranteed { ok: true; name: string } here
        const { name } = appRes as { ok: true; name: string };
        const url = input.url?.trim() ?? "";
        if (!url) {
          return { ok: false, message: "open_url requires url" };
        }
        const urlCheck = validateHttpUrl(url);
        if (!urlCheck.ok) {
          return { ok: false, message: urlCheck.reason };
        }
        const msg = await openUrlInApp(name, url);
        return { ok: true, message: msg };
      }
      case "keystroke": {
        const appRes = requireApp(workspaceRoot, input.app ?? "Google Chrome");
        if (!appRes.ok) return appRes;
        // appRes is guaranteed { ok: true; name: string } here
        const { name } = appRes as { ok: true; name: string };
        const text = input.text ?? "";
        if (!text) {
          return { ok: false, message: "keystroke requires text" };
        }
        if (text.length > KEYSTROKE_MAX_CHARS) {
          return {
            ok: false,
            message: `keystroke text exceeds ${KEYSTROKE_MAX_CHARS} characters`,
          };
        }
        const mods = normalizeModifiers(input.modifiers);
        if (!mods.ok) return mods;
        const { modifiers } = mods as { ok: true; modifiers: KeyModifier[] };
        const msg = await sendKeystroke({
          appName: name,
          text,
          modifiers,
        });
        return { ok: true, message: msg };
      }
      case "youtube_play_first": {
        const appRes = requireApp(workspaceRoot, input.app ?? "Google Chrome");
        if (!appRes.ok) return appRes;
        // appRes is guaranteed { ok: true; name: string } here
        const { name } = appRes as { ok: true; name: string };
        const msg = await chromeClickFirstYoutubeResult(name);
        return { ok: true, message: msg };
      }
      default: {
        const _exhaustive: never = input.action;
        return { ok: false, message: `unknown action: ${_exhaustive}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function requireApp(
  workspaceRoot: string,
  app: string | undefined,
): { ok: true; name: string } | DesktopActionResult {
  const raw = (app ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      message:
        "app is required (default allowlist is Google Chrome). " +
        "Call request_desktop_app_access to grant another app.",
    };
  }
  const canonical = resolveAllowedAppName(workspaceRoot, raw);
  if (!canonical) {
    return {
      ok: false,
      message:
        `App not on desktop allowlist: ${raw}. ` +
        `Call request_desktop_app_access with appName="${raw}" and wait for human approval.`,
    };
  }
  return { ok: true, name: canonical };
}

function normalizeModifiers(
  mods: KeyModifier[] | undefined,
):
  | { ok: true; modifiers: KeyModifier[] }
  | DesktopActionResult {
  if (!mods || mods.length === 0) {
    return { ok: true, modifiers: [] };
  }
  const allowed: KeyModifier[] = ["cmd", "shift", "option", "control"];
  for (const m of mods) {
    if (!allowed.includes(m)) {
      return {
        ok: false,
        message: `invalid modifier: ${m} (use cmd|shift|option|control)`,
      };
    }
  }
  return { ok: true, modifiers: [...new Set(mods)] };
}
