#!/usr/bin/env node
/**
 * Render Mermaid source to PNG via Playwright (for PDF embedding).
 * Usage: node mermaid_to_png.mjs --input diagram.mmd --output diagram.png
 *    or: node mermaid_to_png.mjs --code "flowchart TD; A-->B" --output out.png
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

function findPlaywrightRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "node_modules", "playwright");
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const codeArg = arg("--code");
  const input = arg("--input");
  const output = arg("--output");
  if (!output) {
    console.error("Missing --output path");
    process.exit(2);
  }
  let code = codeArg || "";
  if (input) {
    code = fs.readFileSync(input, "utf8");
  }
  code = String(code || "").trim();
  if (!code) {
    console.error("Empty Mermaid source");
    process.exit(2);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = findPlaywrightRoot(process.cwd()) || findPlaywrightRoot(scriptDir);
  if (!root) {
    console.error(
      "playwright not found — run from Agent repo root (npm install) or set cwd",
    );
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });

  const escaped = JSON.stringify(code);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 16px; background: #ffffff; }
    #wrap { display: inline-block; }
  </style>
</head>
<body>
  <div id="wrap"></div>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "strict",
      flowchart: { htmlLabels: true },
    });
    const code = ${escaped};
    try {
      const { svg } = await mermaid.render("mmd-" + Date.now(), code);
      document.getElementById("wrap").innerHTML = svg;
      window.__ok = true;
    } catch (e) {
      window.__err = String(e && e.message ? e.message : e);
      window.__ok = false;
    }
  </script>
</body>
</html>`;

  let browser;
  const launchErrors = [];
  for (const opts of [
    { channel: "chrome" },
    { channel: "msedge" },
    { channel: "chromium" },
    {},
  ]) {
    try {
      browser = await chromium.launch({ headless: true, ...opts });
      break;
    } catch (e) {
      launchErrors.push(
        `${JSON.stringify(opts)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (!browser) {
    console.error(
      "Could not launch a browser for Mermaid render. Install Chrome or run: npx playwright install chromium\n" +
        launchErrors.join("\n"),
    );
    process.exit(1);
  }
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 1400, height: 900 },
    });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ok === true || window.__ok === false, {
      timeout: 60_000,
    });
    const err = await page.evaluate(() => window.__err || null);
    if (err) {
      console.error(`Mermaid render failed: ${err}`);
      process.exit(1);
    }
    const el = page.locator("#wrap");
    await el.screenshot({ path: path.resolve(output), type: "png" });
    console.log(JSON.stringify({ output: path.resolve(output), ok: true }));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
