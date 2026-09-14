import { tool } from "langchain";
import { z } from "zod";
import { chromium, type Browser, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";

let browser: Browser | null = null;
let page: Page | null = null;

async function ensureBrowser(): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  }
  if (!page) throw new Error("Playwright page not initialized");
  return page;
}

/** Open a URL in a headless browser and return page text/content. */
const browserOpen = tool(
  async ({ url }: { url: string }) => {
    const pg = await ensureBrowser();
    try {
      await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const title = await pg.title();
      const bodyText = await pg.innerText("body");
      const sample = bodyText.slice(0, 3000);
      return `Opened ${url}\nTitle: ${title}\n\nContent sample (first 3000 chars):\n${sample}`;
    } catch (e) {
      return `Failed to open ${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "browser_open",
    description: "Open a web page in a headless Chromium browser with full JS execution and return page content.",
    schema: z.object({ url: z.string().url().describe("URL to open") }),
  }
);

/** Click an element specified by CSS selector or text on the current page. */
const browserClick = tool(
  async ({ selector }: { selector: string }) => {
    const pg = await ensureBrowser();
    try {
      await pg.waitForSelector(selector, { timeout: 10000 });
      await pg.click(selector);
      const title = await pg.title();
      return `Clicked element '${selector}'. Current page title: ${title}`;
    } catch (e) {
      return `Failed to click '${selector}': ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "browser_click",
    description: "Click a DOM element on the current page using a CSS selector or text matcher.",
    schema: z.object({ selector: z.string().describe("CSS selector or text matcher (e.g. 'button:has-text(\"Submit\")')") }),
  }
);

/** Type text into an element specified by CSS selector. */
const browserType = tool(
  async ({ selector, text }: { selector: string; text: string }) => {
    const pg = await ensureBrowser();
    try {
      await pg.waitForSelector(selector, { timeout: 10000 });
      await pg.fill(selector, text);
      return `Typed into '${selector}': ${text}`;
    } catch (e) {
      return `Failed to type into '${selector}': ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "browser_type",
    description: "Fill an input field identified by CSS selector with text.",
    schema: z.object({
      selector: z.string().describe("CSS selector of input field"),
      text: z.string().describe("Text to fill"),
    }),
  }
);

/** Evaluate custom JavaScript in the browser context. */
const browserEval = tool(
  async ({ code }: { code: string }) => {
    const pg = await ensureBrowser();
    try {
      const result = await pg.evaluate((expr) => {
        // eslint-disable-next-line no-eval
        return eval(expr);
      }, code);
      return `JS Execution Result: ${JSON.stringify(result, null, 2)}`;
    } catch (e) {
      return `JS Execution Failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "browser_eval",
    description: "Execute arbitrary JavaScript code inside the active Playwright browser page and return the result.",
    schema: z.object({
      code: z.string().describe("JavaScript expression or code block to evaluate"),
    }),
  }
);

/** Take a screenshot of the active browser page. */
const browserScreenshot = tool(
  async ({ path: filePath }: { path?: string }) => {
    const pg = await ensureBrowser();
    try {
      const data = await pg.screenshot({ fullPage: true });
      if (filePath) {
        const abs = path.resolve(filePath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, data);
        return `Screenshot saved to ${abs}`;
      }
      return `Screenshot captured (${data.length} bytes, base64 length ${data.toString("base64").length})`;
    } catch (e) {
      return `Screenshot failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a full-page screenshot of the current active Playwright browser page.",
    schema: z.object({
      path: z.string().optional().describe("Optional file path to save PNG screenshot"),
    }),
  }
);

/** Close the active browser instance. */
const browserClose = tool(
  async () => {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
      return "Playwright browser closed.";
    }
    return "Browser was not running.";
  },
  {
    name: "browser_close",
    description: "Close the active Playwright headless browser instance.",
    schema: z.object({}),
  }
);

export function createPlaywrightTools() {
  return [browserOpen, browserClick, browserType, browserEval, browserScreenshot, browserClose];
}
