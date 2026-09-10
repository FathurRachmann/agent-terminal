import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const prebuilds = path.join(root, "node_modules", "node-pty", "prebuilds");

if (!fs.existsSync(prebuilds)) {
  process.exit(0);
}

for (const platform of fs.readdirSync(prebuilds)) {
  const dir = path.join(prebuilds, platform);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) {
    if (file === "spawn-helper" || file.endsWith(".exe")) {
      const full = path.join(dir, file);
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        /* ignore */
      }
    }
  }
}
