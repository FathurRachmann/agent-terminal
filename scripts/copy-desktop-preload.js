import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/desktop-app/preload.cjs");
const destDir = path.join(root, "dist/desktop-app");
const dest = path.join(destDir, "preload.cjs");

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("[build] copied preload.cjs → dist/desktop-app/");
