import { tool } from "langchain";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execAsync = promisify(exec);

/* ── helpers ─────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runOsa(script: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`osascript -e "${esc(script)}"`, {
    timeout: 15_000,
  });
  if (stderr.trim()) throw new Error(stderr.trim());
  return stdout.trim();
}

/* ── tools ───────────────────────────────────────────────────── */

const screenshot = tool(
  async ({ path: outPath }: { path?: string }) => {
    const dest = outPath ?? path.join(os.tmpdir(), `screenshot-${Date.now()}.png`);
    await execAsync(`screencapture -x "${dest}"`, { timeout: 10_000 });
    if (!fs.existsSync(dest)) throw new Error("Screenshot failed — file not created");
    const bytes = fs.statSync(dest).size;
    return `Screenshot saved: ${dest} (${bytes} bytes)`;
  },
  {
    name: "computer_screenshot",
    description:
      "Capture a screenshot of the current screen. Returns the file path. " +
      "Use before clicking/typing to understand the current UI state.",
    schema: z.object({
      path: z.string().optional().describe("Output file path (default: /tmp/screenshot-<ts>.png)"),
    }),
  }
);

const mouseClick = tool(
  async ({ x, y, button }: { x: number; y: number; button?: "left" | "right" }) => {
    const btn = button === "right" ? "right" : "left";
    // Use cliclick if available, otherwise fallback to osascript
    try {
      await execAsync(`which cliclick`, { timeout: 3_000 });
      const flag = btn === "right" ? "rc" : "c";
      await execAsync(`cliclick ${flag}:${x},${y}`, { timeout: 10_000 });
    } catch {
      // Fallback: osascript CGEvent (less precise but no extra deps)
      const script = `
        use framework "CoreGraphics"
        set pt to current application's CGPointMake(${x}, ${y})
        set ev to current application's CGEventCreateMouseEvent(missing value, current application's kCGEventLeftMouseDown, pt, current application's kCGMouseButtonLeft)
        current application's CGEventPost(current application's kCGHIDEventTap, ev)
        set ev2 to current application's CGEventCreateMouseEvent(missing value, current application's kCGEventLeftMouseUp, pt, current application's kCGMouseButtonLeft)
        current application's CGEventPost(current application's kCGHIDEventTap, ev2)
      `;
      await execAsync(`osascript -l JavaScript -e ${JSON.stringify(script)}`, { timeout: 10_000 });
    }
    return `Clicked ${btn} at (${x}, ${y})`;
  },
  {
    name: "computer_click",
    description:
      "Click a specific pixel coordinate on the screen. " +
      "Take a screenshot first to get the coordinates. " +
      "Install cliclick (`brew install cliclick`) for best results.",
    schema: z.object({
      x: z.number().int().describe("X coordinate"),
      y: z.number().int().describe("Y coordinate"),
      button: z.enum(["left", "right"]).optional().describe("Mouse button (default: left)"),
    }),
  }
);

const typeText = tool(
  async ({ text, delay }: { text: string; delay?: number }) => {
    const ms = delay ?? 0;
    // Type via osascript System Events (works globally)
    const script = `tell application "System Events" to keystroke "${esc(text)}"`;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    await runOsa(script);
    return `Typed: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`;
  },
  {
    name: "computer_type",
    description:
      "Type text globally using System Events (works in any focused app). " +
      "Requires Accessibility permission for the terminal running this agent.",
    schema: z.object({
      text: z.string().max(2000).describe("Text to type"),
      delay: z.number().int().min(0).optional().describe("Milliseconds to wait before typing"),
    }),
  }
);

const pressKey = tool(
  async ({ key, modifiers }: { key: string; modifiers?: string[] }) => {
    const mods = modifiers?.length
      ? `using {${modifiers.map((m) => `${m} down`).join(", ")}}`
      : "";
    const script = `tell application "System Events" to key code ${key} ${mods}`.trim();
    // If key looks like a name (e.g. "return"), use key name instead
    const isCode = /^\d+$/.test(key);
    const finalScript = isCode
      ? script
      : `tell application "System Events" to keystroke (ASCII character ${key.charCodeAt(0)}) ${mods}`.trim();
    // Simpler: always use key name if it's a known special key
    const specialKeys: Record<string, string> = {
      return: "return", enter: "return", tab: "tab", escape: "escape", esc: "escape",
      space: "space", delete: "delete", backspace: "delete",
      up: "up arrow", down: "down arrow", left: "left arrow", right: "right arrow",
    };
    const named = specialKeys[key.toLowerCase()];
    const osaScript = named
      ? `tell application "System Events" to key code (key code of key "${named}") ${mods}`.trim()
      : `tell application "System Events" to keystroke "${esc(key)}" ${mods}`.trim();
    await runOsa(osaScript);
    return `Pressed: ${modifiers?.join("+") ?? ""}${modifiers?.length ? "+" : ""}${key}`;
  },
  {
    name: "computer_key",
    description:
      "Press a key or key combo globally (return, tab, escape, space, up, down, left, right, or any char). " +
      "Modifiers: command, shift, option, control.",
    schema: z.object({
      key: z.string().describe('Key name: "return", "tab", "escape", "space", "up", "down", or any char'),
      modifiers: z
        .array(z.enum(["command", "shift", "option", "control"]))
        .optional()
        .describe("Modifier keys to hold"),
    }),
  }
);

/* ── export ──────────────────────────────────────────────────── */

export function createComputerUseTools() {
  return [screenshot, mouseClick, typeText, pressKey];
}
