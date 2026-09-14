import { tool } from "langchain";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/* ── web_search ──────────────────────────────────────────────── */

type SearchResult = { title: string; url: string; snippet: string };

async function ddgSearch(query: string, limit: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  let html = "";
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=us-en`, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      html = await res.text();
    }
  } catch {
    // Fallback to curl if Node fetch fails or gets blocked
  }

  if (!html) {
    try {
      const { stdout } = await execAsync(
        `curl -sL -A "${userAgent}" "https://html.duckduckgo.com/html/?q=${encodedQuery}&kl=us-en"`,
        { timeout: 12_000 }
      );
      html = stdout;
    } catch (err) {
      throw new Error(`Web search request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const results: SearchResult[] = [];
  const blocks = html.split(/class="result(?:\s|")/);
  for (const block of blocks) {
    if (results.length >= limit) break;
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)/);
    if (!titleMatch) continue;
    let url = titleMatch[1] ?? "";
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg && uddg[1]) url = decodeURIComponent(uddg[1]);
    const title = titleMatch[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const snippet = snippetMatch
      ? snippetMatch[1]?.replace(/<[^>]+>/g, "").trim() ?? ""
      : "";
    if (title && url && url.startsWith("http")) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

const webSearch = tool(
  async ({ query, limit }: { query: string; limit?: number }) => {
    try {
      const n = Math.min(limit ?? 5, 20);
      const results = await ddgSearch(query, n);
      if (results.length === 0) return "No web search results found for this query.";
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");
    } catch (err) {
      return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "web_search",
    description:
      "Search the web via DuckDuckGo. Returns titles, URLs, and snippets. " +
      "Use for current information, documentation lookup, library/API discovery, " +
      "or any question that benefits from live web search.",
    schema: z.object({
      query: z.string().describe("Search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max results (default 5, max 20)"),
    }),
  }
);

/* ── web_extract ─────────────────────────────────────────────── */

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<(br|hr|p|div|h[1-6]|li|tr)\b[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

const webExtract = tool(
  async ({ url, charLimit }: { url: string; charLimit?: number }) => {
    const maxChars = charLimit ?? 15_000;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const contentType = res.headers.get("content-type") ?? "";
      const html = await res.text();

      if (!contentType.includes("html")) {
        return html.length > maxChars
          ? html.slice(0, maxChars) + `\n\n[truncated at ${maxChars} chars]`
          : html;
      }

      const text = stripHtml(html);
      if (text.length > maxChars) {
        return text.slice(0, maxChars) + `\n\n[truncated at ${maxChars} chars; full text is ${text.length} chars]`;
      }
      return text;
    } catch (err) {
      return `Extract failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "web_extract",
    description:
      "Fetch a URL and return its text content (HTML stripped to plain text). " +
      "Use to read documentation, articles, API specs, or any web page.",
    schema: z.object({
      url: z.string().url().describe("URL to fetch and extract text from"),
      charLimit: z
        .number()
        .int()
        .min(1_000)
        .max(100_000)
        .optional()
        .describe("Max characters to return (default 15000)"),
    }),
  }
);

/* ── export ──────────────────────────────────────────────────── */

export function createWebTools() {
  return [webSearch, webExtract];
}
