import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_OUT = 14_000;

export function graphifyOutDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), "graphify-out");
}

export function graphifyGraphPath(workspaceRoot: string): string {
  return path.join(graphifyOutDir(workspaceRoot), "graph.json");
}

export function hasGraphifyGraph(workspaceRoot: string): boolean {
  try {
    const p = graphifyGraphPath(workspaceRoot);
    return fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

export function resolveGraphifyBin(): string | null {
  const fromEnv = process.env.GRAPHIFY_BIN?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = [
    path.join(process.env.HOME || "", ".local", "bin", "graphify"),
    "/usr/local/bin/graphify",
    "/opt/homebrew/bin/graphify",
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "graphify"; // rely on PATH
}

function clip(s: string, max = MAX_OUT): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

export async function runGraphifyCommand(
  args: string[],
  options: { cwd: string; timeoutMs?: number },
): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  const bin = resolveGraphifyBin() || "graphify";
  const timeoutMs = options.timeoutMs ?? 90_000;
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PATH: [
          path.join(process.env.HOME || "", ".local", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          process.env.PATH || "/usr/bin:/bin",
        ].join(":"),
      },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({
        ok: false,
        code: null,
        stdout: clip(stdout),
        stderr: clip(`${stderr}\n(timeout after ${timeoutMs}ms)`),
      });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > MAX_OUT * 2) stdout = stdout.slice(-MAX_OUT * 2);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > MAX_OUT) stderr = stderr.slice(-MAX_OUT);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout: clip(stdout),
        stderr: err.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: clip(stdout),
        stderr: clip(stderr),
      });
    });
  });
}

function missingGraphHelp(workspaceRoot: string): string {
  return [
    `No project knowledge graph at ${graphifyGraphPath(workspaceRoot)}.`,
    "This graph is project-scoped (like Cursor): build once per project, reuse across sessions.",
    "Call graphify_update to build/refresh it (AST-only, no LLM), then retry graphify_query.",
  ].join("\n");
}

/**
 * Project-scoped Graphify tools (Cursor-style).
 * Graph lives at <workspaceRoot>/graphify-out/ — not per chat session.
 */
export function createGraphifyTools(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot);
  const graphPath = graphifyGraphPath(root);

  const graphifyStatus = tool(
    async () => {
      const outDir = graphifyOutDir(root);
      const exists = hasGraphifyGraph(root);
      let size = 0;
      let mtime: string | null = null;
      if (exists) {
        try {
          const st = fs.statSync(graphPath);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          /* ignore */
        }
      }
      const wiki = path.join(outDir, "wiki", "index.md");
      const report = path.join(outDir, "GRAPH_REPORT.md");
      return JSON.stringify(
        {
          workspaceRoot: root,
          graphPath,
          ready: exists,
          sizeBytes: size,
          updatedAt: mtime,
          hasWiki: fs.existsSync(wiki),
          hasReport: fs.existsSync(report),
          tip: exists
            ? "For codebase/architecture questions, prefer graphify_query before broad grep."
            : "Run graphify_update to build the project graph.",
        },
        null,
        2,
      );
    },
    {
      name: "graphify_status",
      description:
        "Check whether this project has a Graphify knowledge graph (graphify-out/graph.json). Project-scoped, not session-scoped.",
      schema: z.object({}),
    },
  );

  const graphifyQuery = tool(
    async ({
      question,
      mode,
      budget,
    }: {
      question: string;
      mode?: "bfs" | "dfs";
      budget?: number;
    }) => {
      const q = String(question || "").trim();
      if (!q) return "Error: question required";
      if (!hasGraphifyGraph(root)) return missingGraphHelp(root);
      const args = ["query", q, "--graph", graphPath];
      if (mode === "dfs") args.push("--dfs");
      if (budget && budget > 0) args.push("--budget", String(Math.floor(budget)));
      const res = await runGraphifyCommand(args, { cwd: root, timeoutMs: 60_000 });
      if (!res.ok && !res.stdout.trim()) {
        return `graphify_query failed: ${res.stderr || `exit ${res.code}`}`;
      }
      return res.stdout || res.stderr || "(empty graphify output)";
    },
    {
      name: "graphify_query",
      description:
        "Query the project knowledge graph (BFS by default) for architecture / 'how does X work?' / 'what calls Y?' questions. Prefer this over dumping GRAPH_REPORT.md when graphify-out/graph.json exists. Project-scoped.",
      schema: z.object({
        question: z.string().describe("Natural-language codebase question"),
        mode: z.enum(["bfs", "dfs"]).optional().describe("Traversal mode (default bfs)"),
        budget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional token/budget cap for the answer"),
      }),
    },
  );

  const graphifyPath = tool(
    async ({ from, to }: { from: string; to: string }) => {
      const a = String(from || "").trim();
      const b = String(to || "").trim();
      if (!a || !b) return "Error: from and to required";
      if (!hasGraphifyGraph(root)) return missingGraphHelp(root);
      const res = await runGraphifyCommand(
        ["path", a, b, "--graph", graphPath],
        { cwd: root, timeoutMs: 60_000 },
      );
      if (!res.ok && !res.stdout.trim()) {
        return `graphify_path failed: ${res.stderr || `exit ${res.code}`}`;
      }
      return res.stdout || res.stderr || "(empty)";
    },
    {
      name: "graphify_path",
      description:
        "Shortest path between two concepts/symbols in the project graph (e.g. AuthModule → Database).",
      schema: z.object({
        from: z.string().describe("Start node / concept"),
        to: z.string().describe("End node / concept"),
      }),
    },
  );

  const graphifyExplain = tool(
    async ({ concept }: { concept: string }) => {
      const c = String(concept || "").trim();
      if (!c) return "Error: concept required";
      if (!hasGraphifyGraph(root)) return missingGraphHelp(root);
      const res = await runGraphifyCommand(
        ["explain", c, "--graph", graphPath],
        { cwd: root, timeoutMs: 60_000 },
      );
      if (!res.ok && !res.stdout.trim()) {
        return `graphify_explain failed: ${res.stderr || `exit ${res.code}`}`;
      }
      return res.stdout || res.stderr || "(empty)";
    },
    {
      name: "graphify_explain",
      description:
        "Plain-language explanation of a node and its neighbors in the project knowledge graph.",
      schema: z.object({
        concept: z.string().describe("Concept, symbol, or module name"),
      }),
    },
  );

  const graphifyUpdate = tool(
    async ({ force }: { force?: boolean }) => {
      // ponytail: graphify update only supports --force / --no-cluster (no --no-viz)
      const args = ["update", root];
      if (force) args.push("--force");
      const res = await runGraphifyCommand(args, {
        cwd: root,
        timeoutMs: 5 * 60_000,
      });
      const ready = hasGraphifyGraph(root);
      if (!res.ok && !ready) {
        return `graphify_update failed: ${res.stderr || res.stdout || `exit ${res.code}`}`;
      }
      return [
        ready ? "Project graph updated." : "Update finished but graph.json not found.",
        `graph: ${graphPath}`,
        clip(res.stdout || res.stderr || "", 4000),
      ]
        .filter(Boolean)
        .join("\n");
    },
    {
      name: "graphify_update",
      description:
        "Build or refresh this project's Graphify graph (AST-only incremental update, no LLM). Run after significant code changes or when graphify_status says not ready. Writes to <project>/graphify-out/.",
      schema: z.object({
        force: z
          .boolean()
          .optional()
          .describe("Overwrite even if rebuild has fewer nodes"),
      }),
    },
  );

  return [
    graphifyStatus,
    graphifyQuery,
    graphifyPath,
    graphifyExplain,
    graphifyUpdate,
  ];
}
