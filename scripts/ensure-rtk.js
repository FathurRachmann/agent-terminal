/**
 * Ensure `rtk` is on PATH for token-optimized shell proxies.
 * Does not auto-brew-install (needs network + user consent) — warns only.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function whichRtk() {
  try {
    return execFileSync("which", ["rtk"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const bin = process.env.RTK_BIN?.trim() || whichRtk();
if (bin && fs.existsSync(bin)) {
  console.log(`[rtk] ok — ${bin} (execute auto-proxy enabled)`);
} else {
  console.warn(
    [
      "[rtk] not found on PATH — execute will run raw commands (larger token usage).",
      "  Install: brew install rtk   # or see https://github.com/ (rtk CLI)",
      "  Then restart the agent. Override path with RTK_BIN=…",
    ].join("\n"),
  );
}

// Drop a short reminder into .agent for operators (idempotent).
const note = path.join(root, ".agent", "RTK.md");
const body = `# RTK (default shell proxy)

Every \`execute\` call goes through \`rtk rewrite\` then \`--ultra-compact\`
(\`src/sandbox/rtk-proxy.ts\` → \`PtySandbox\`). Disable with \`RTK_PROXY=0\`.

Upstream rewrite covers: ls, tree, find, git, gh, npm/npx/pnpm, tsc, lint/eslint,
vitest/jest, docker, kubectl, curl/wget, grep/rg, cat → read, cargo, go, …
`;
try {
  fs.mkdirSync(path.dirname(note), { recursive: true });
  if (!fs.existsSync(note)) fs.writeFileSync(note, body, "utf8");
} catch {
  /* ignore */
}
