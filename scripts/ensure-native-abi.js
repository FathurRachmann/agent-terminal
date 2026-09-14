/**
 * Native addons (better-sqlite3, node-pty) must match the runtime ABI:
 * - CLI / tests → system Node (modules 137 on Node 24)
 * - Electron desktop → Electron's Node (modules 149 on Electron 44)
 *
 * Stamp file avoids rebuilding every launch when ABI target is unchanged.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stampPath = path.join(root, ".agent", ".native-abi");
const require = createRequire(import.meta.url);

const target = process.argv[2]; // "electron" | "node"
if (target !== "electron" && target !== "node") {
  console.error("Usage: node scripts/ensure-native-abi.js <electron|node>");
  process.exit(1);
}

function electronVersion() {
  return require("electron/package.json").version;
}

function desiredStamp() {
  if (target === "electron") {
    return `electron@${electronVersion()}`;
  }
  return `node@${process.versions.modules}`;
}

function currentStamp() {
  try {
    return fs.readFileSync(stampPath, "utf8").trim();
  } catch {
    return "";
  }
}

function run(cmd, args) {
  console.log(`[native-abi] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

const want = desiredStamp();
const have = currentStamp();
if (have === want) {
  console.log(`[native-abi] ok (${want})`);
  process.exit(0);
}

console.log(`[native-abi] switching ${have || "(none)"} → ${want}`);

if (target === "electron") {
  run("npx", [
    "electron-rebuild",
    "-f",
    "-w",
    "better-sqlite3",
    "-w",
    "node-pty",
  ]);
} else {
  run("npm", ["rebuild", "better-sqlite3", "node-pty"]);
}

fs.mkdirSync(path.dirname(stampPath), { recursive: true });
fs.writeFileSync(stampPath, `${want}\n`, "utf8");
console.log(`[native-abi] stamped ${want}`);
