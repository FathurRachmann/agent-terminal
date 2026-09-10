import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const KEYSTROKE_MAX_CHARS = 200;

export type KeyModifier = "cmd" | "shift" | "option" | "control";

/**
 * Escape a value for use inside an AppleScript double-quoted string.
 * Rejects control characters that could break out of the string literal.
 */
export function escapeAppleScriptString(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(
      "AppleScript string contains control characters (rejected)",
    );
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Safe characters for app display names (letters, digits, spaces, .+-_). */
export function assertSafeAppName(name: string): string {
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(
      `invalid app name: control characters rejected (${JSON.stringify(name)})`,
    );
  }
  const trimmed = name.trim().replace(/ {2,}/g, " ");
  if (!trimmed) {
    throw new Error("empty app name");
  }
  if (trimmed.length > 80) {
    throw new Error("app name too long");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 .+\-_]*$/.test(trimmed)) {
    throw new Error(
      `invalid app name: ${JSON.stringify(name)} (letters/digits/spaces only)`,
    );
  }
  return trimmed;
}

const DANGEROUS_KEYSTROKES: Array<{
  text: string;
  modifiers: KeyModifier[];
  reason: string;
}> = [
  { text: "q", modifiers: ["cmd"], reason: "Cmd+Q quits the app" },
  { text: "w", modifiers: ["cmd"], reason: "Cmd+W closes the window" },
  {
    text: "q",
    modifiers: ["cmd", "option"],
    reason: "Cmd+Option+Q force-quits",
  },
];

export function assertSafeKeystroke(
  text: string,
  modifiers: KeyModifier[] = [],
): void {
  if (text.length === 0) {
    throw new Error("keystroke text is empty");
  }
  if (text.length > KEYSTROKE_MAX_CHARS) {
    throw new Error(
      `keystroke text exceeds ${KEYSTROKE_MAX_CHARS} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error("keystroke text contains control characters (rejected)");
  }
  const modSet = new Set(modifiers);
  for (const rule of DANGEROUS_KEYSTROKES) {
    if (text.toLowerCase() !== rule.text.toLowerCase()) continue;
    if (
      rule.modifiers.length === modSet.size &&
      rule.modifiers.every((m) => modSet.has(m))
    ) {
      throw new Error(`blocked keystroke: ${rule.reason}`);
    }
  }
}

export function isDesktopAutomationSupported(): boolean {
  return process.platform === "darwin";
}

export function isDesktopAutomationEnabled(): boolean {
  const flag = process.env.DESKTOP_AUTOMATION?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
    return false;
  }
  return true;
}

export async function runOsascript(
  script: string,
  options?: { timeoutMs?: number },
): Promise<string> {
  if (!isDesktopAutomationSupported()) {
    throw new Error("Desktop automation is only supported on macOS");
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      "osascript",
      ["-e", script],
      {
        timeout: options?.timeoutMs ?? 15_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const out = `${stdout ?? ""}${stderr ?? ""}`.trim();
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not allowed assistive|accessibility/i.test(message)) {
      throw new Error(
        "Keystroke blocked: grant Accessibility permission to Terminal/Cursor " +
          "(System Settings → Privacy & Security → Accessibility), then retry.",
      );
    }
    if (/javascript from apple events|Allow JavaScript from Apple Events/i.test(message)) {
      throw new Error(
        "Chrome blocked JavaScript from Apple Events. In Chrome: View → Developer → Allow JavaScript from Apple Events",
      );
    }
    throw new Error(`osascript failed: ${message}`);
  }
}

export async function openApplication(appName: string): Promise<string> {
  const safeName = assertSafeAppName(appName);
  const app = escapeAppleScriptString(safeName);
  await runOsascript(`tell application "${app}" to activate`);
  return `Opened/activated: ${safeName}`;
}

export async function activateApplication(appName: string): Promise<string> {
  return openApplication(appName);
}

export async function openUrlInApp(
  appName: string,
  url: string,
): Promise<string> {
  const safeName = assertSafeAppName(appName);
  const app = escapeAppleScriptString(safeName);
  const safeUrl = escapeAppleScriptString(url);
  await runOsascript(
    `tell application "${app}" to open location "${safeUrl}"`,
  );
  return `Opened ${url} in ${safeName}`;
}

/**
 * Fixed Chrome JS template (no freeform JS from the model).
 * Clicks the first YouTube search/result video title.
 */
export async function chromeClickFirstYoutubeResult(
  appName = "Google Chrome",
): Promise<string> {
  const safeName = assertSafeAppName(appName);
  if (!/^Google Chrome$/i.test(safeName)) {
    throw new Error("youtube_play_first is only supported in Google Chrome");
  }
  const app = escapeAppleScriptString(safeName);
  // Keep JS free of double-quotes so it sits inside an AppleScript string safely.
  const js =
    "var a=document.querySelector('a#video-title'); if(!a){a=document.querySelector('ytd-video-renderer a#thumbnail');} if(a){a.click(); 'clicked';} else {'no_result';}";
  const safeJs = escapeAppleScriptString(js);
  const script = [
    `tell application "${app}" to activate`,
    "delay 0.4",
    `tell application "${app}"`,
    "  if (count of windows) = 0 then error \"no Chrome window\"",
    `  set r to execute active tab of front window javascript "${safeJs}"`,
    "  return r",
    "end tell",
  ].join("\n");
  const out = await runOsascript(script, { timeoutMs: 20_000 });
  if (/no_result/i.test(out)) {
    throw new Error(
      "No YouTube result link found yet (page still loading?). Retry youtube_play_first.",
    );
  }
  if (/javascript from apple events|executing javascript/i.test(out)) {
    throw new Error(
      "Chrome blocked JavaScript from Apple Events. Enable: View → Developer → Allow JavaScript from Apple Events",
    );
  }
  return `Clicked first YouTube result in ${safeName}`;
}

export async function getFrontmostApplication(): Promise<string> {
  const out = await runOsascript(
    'tell application "System Events" to get name of first application process whose frontmost is true',
  );
  return out || "(unknown)";
}

/**
 * Activate allowed app, then send keystroke via System Events.
 */
export async function sendKeystroke(options: {
  appName: string;
  text: string;
  modifiers?: KeyModifier[];
}): Promise<string> {
  const mods = options.modifiers ?? [];
  assertSafeKeystroke(options.text, mods);
  const safeName = assertSafeAppName(options.appName);

  const app = escapeAppleScriptString(safeName);
  const keys = escapeAppleScriptString(options.text);
  const appleMods = mods.map(modifierToAppleScript);
  const usingClause =
    appleMods.length > 0 ? ` using {${appleMods.join(", ")}}` : "";

  const script = [
    `tell application "${app}" to activate`,
    "delay 0.2",
    'tell application "System Events"',
    `  keystroke "${keys}"${usingClause}`,
    "end tell",
  ].join("\n");

  await runOsascript(script);
  const modLabel =
    mods.length > 0 ? ` [${mods.join("+")}]` : "";
  return `Sent keystroke to ${safeName}${modLabel}: ${JSON.stringify(options.text)}`;
}

function modifierToAppleScript(mod: KeyModifier): string {
  switch (mod) {
    case "cmd":
      return "command down";
    case "shift":
      return "shift down";
    case "option":
      return "option down";
    case "control":
      return "control down";
    default: {
      const _exhaustive: never = mod;
      return _exhaustive;
    }
  }
}
