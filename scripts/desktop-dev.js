/**
 * Dev launcher: tsc → Vite (5173) → Electron with VITE_DEV_SERVER_URL.
 * Production path is `npm run desktop:start` (built HTML, no Vite).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function waitForUrl(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

await run("npx", ["tsc", "-p", "tsconfig.json"]);
await run("node", ["scripts/copy-desktop-preload.js"]);

const vite = spawn("npx", ["vite"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env },
});

try {
  await waitForUrl(DEV_URL);
  await run("npx", ["electron", "dist/desktop-app/main.js"], {
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
  });
} finally {
  vite.kill("SIGTERM");
}
