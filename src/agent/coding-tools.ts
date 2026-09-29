/**
 * Claude Code / Cursor-style coding tools: git, symbol nav, targeted tests.
 */
import { tool } from "langchain";
import { z } from "zod";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getTsNavHost } from "./ts-nav.js";

const execFileAsync = promisify(execFile);
const MAX_OUT = 12_000;

function clip(s: string, max = MAX_OUT): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2_000_000,
      env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    });
    return {
      ok: true,
      stdout: clip(String(stdout || "")),
      stderr: clip(String(stderr || "")),
      code: 0,
    };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    return {
      ok: false,
      stdout: clip(String(e.stdout || "")),
      stderr: clip(String(e.stderr || e.message || "")),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

async function ensureGitRepo(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!r.ok || !r.stdout.includes("true")) {
    return "Not a git repository (or git unavailable).";
  }
  return null;
}

function formatGitResult(r: {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}): string {
  const parts = [
    r.stdout,
    r.stderr ? `stderr:\n${r.stderr}` : "",
    r.ok ? "" : `exit_code: ${r.code}`,
  ].filter(Boolean);
  return parts.join("\n") || "(empty)";
}

/** Detect package scripts for typecheck / test. */
export function detectVerifyCommands(workspaceRoot: string): {
  typecheck: string | null;
  test: string | null;
} {
  const pkgPath = path.join(workspaceRoot, "package.json");
  let scripts: Record<string, string> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = raw.scripts ?? {};
  } catch {
    /* no package.json */
  }

  const typecheck =
    scripts.typecheck
      ? "npm run typecheck"
      : scripts["tsc"]
        ? "npm run tsc"
        : fs.existsSync(path.join(workspaceRoot, "tsconfig.json"))
          ? "npx tsc --noEmit"
          : null;

  const test =
    scripts["test:unit"]
      ? "npm run test:unit"
      : scripts.test
        ? "npm test"
        : null;

  return { typecheck, test };
}

export async function runShellCommand(
  cwd: string,
  command: string,
  timeoutMs = 120_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "/bin/zsh",
      ["-lc", command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 4_000_000,
        env: process.env,
      },
    );
    return {
      ok: true,
      stdout: clip(String(stdout || "")),
      stderr: clip(String(stderr || "")),
      code: 0,
    };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    return {
      ok: false,
      stdout: clip(String(e.stdout || "")),
      stderr: clip(String(e.stderr || e.message || "")),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/** Heuristic symbol search (definition-ish) via ripgrep patterns. */
export function buildFindSymbolPatterns(symbol: string): string[] {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    `\\b(function|class|interface|type|enum|const|let|var|def|fn|struct|impl)\\s+${escaped}\\b`,
    `\\b${escaped}\\s*[=:(]`,
    `\\b(export\\s+(async\\s+)?function|export\\s+(default\\s+)?(class|function|const|type|interface))\\s+${escaped}\\b`,
    `#\\[.*\\]\\s*(pub\\s+)?(fn|struct|enum)\\s+${escaped}\\b`,
  ];
}

async function ripgrepSymbol(
  cwd: string,
  symbol: string,
  glob?: string,
): Promise<string> {
  const patterns = buildFindSymbolPatterns(symbol);
  const hits: string[] = [];
  for (const pat of patterns) {
    const args = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "-m",
      "40",
      "-e",
      pat,
    ];
    if (glob) {
      args.push("--glob", glob);
    }
    args.push(".");
    try {
      const { stdout } = await execFileAsync("rg", args, {
        cwd,
        timeout: 20_000,
        maxBuffer: 2_000_000,
      });
      const lines = String(stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (!hits.includes(line)) hits.push(line);
      }
      if (hits.length >= 40) break;
    } catch (err) {
      const e = err as { stdout?: string; code?: number };
      // rg exits 1 when no matches
      if (e.stdout) {
        for (const line of String(e.stdout)
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)) {
          if (!hits.includes(line)) hits.push(line);
        }
      }
    }
  }
  if (hits.length === 0) {
    return `No symbol matches for "${symbol}". Try a shorter name or use grep.`;
  }
  return clip(
    `find_symbol "${symbol}" (${hits.length} hits):\n${hits.slice(0, 40).join("\n")}`,
  );
}

export function createCodingTools(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot);

  const gitStatus = tool(
    async () => {
      const bad = await ensureGitRepo(root);
      if (bad) return bad;
      const branch = await runGit(root, ["branch", "--show-current"]);
      const status = await runGit(root, ["status", "--short", "--branch"]);
      return clip(
        [
          `branch: ${branch.stdout || "(detached)"}`,
          status.stdout || "(clean)",
          status.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    {
      name: "git_status",
      description:
        "Show git branch + short status (staged/unstaged). Prefer this over raw execute('git status').",
      schema: z.object({}),
    },
  );

  const gitDiff = tool(
    async ({ staged, path: filePath }) => {
      const bad = await ensureGitRepo(root);
      if (bad) return bad;
      const args = ["diff", "--no-color"];
      if (staged) args.push("--cached");
      if (filePath?.trim()) args.push("--", filePath.trim());
      return formatGitResult(await runGit(root, args));
    },
    {
      name: "git_diff",
      description:
        "Show git diff (unstaged by default; set staged=true for index). Optional path filter.",
      schema: z.object({
        staged: z.boolean().optional().describe("Diff staged changes only"),
        path: z.string().optional().describe("Limit to a file/dir path"),
      }),
    },
  );

  const gitLog = tool(
    async ({ limit }) => {
      const bad = await ensureGitRepo(root);
      if (bad) return bad;
      const n = Math.min(30, Math.max(1, Number(limit) || 10));
      return formatGitResult(
        await runGit(root, [
          "log",
          `-${n}`,
          "--oneline",
          "--decorate",
          "--no-color",
        ]),
      );
    },
    {
      name: "git_log",
      description: "Recent commit history (oneline).",
      schema: z.object({
        limit: z.number().int().min(1).max(30).optional(),
      }),
    },
  );

  const gitAdd = tool(
    async ({ paths }) => {
      const bad = await ensureGitRepo(root);
      if (bad) return bad;
      const list =
        Array.isArray(paths) && paths.length
          ? paths.map(String).filter(Boolean)
          : ["."];
      return formatGitResult(await runGit(root, ["add", "--", ...list]));
    },
    {
      name: "git_add",
      description:
        "Stage files for commit. Pass paths or omit to stage all (git add .).",
      schema: z.object({
        paths: z.array(z.string()).optional(),
      }),
    },
  );

  const gitCommit = tool(
    async ({ message }) => {
      const bad = await ensureGitRepo(root);
      if (bad) return bad;
      const msg = String(message || "").trim();
      if (!msg) return "Error: commit message required.";
      // Never amend / force — safety rails like Claude Code defaults.
      return formatGitResult(
        await runGit(root, ["commit", "-m", msg], 30_000),
      );
    },
    {
      name: "git_commit",
      description:
        "Create a commit with the given message (no amend, no force). Stage first with git_add.",
      schema: z.object({
        message: z.string().min(1).describe("Commit message"),
      }),
    },
  );

  const findSymbol = tool(
    async ({ symbol, glob, file }) => {
      const name = String(symbol || "").trim();
      if (!name) return "Error: symbol required.";
      const prefer = file?.trim() || undefined;
      // Prefer TypeScript language service when available (Cursor/Claude-style).
      if (!glob && (!prefer || /\.tsx?$/.test(prefer))) {
        const tsNav = getTsNavHost(root);
        if (tsNav) {
          try {
            const out = tsNav.findDefinitions(name, prefer);
            if (!/No TypeScript definition found/i.test(out)) return out;
          } catch {
            /* fall through to rg */
          }
        }
      }
      return ripgrepSymbol(root, name, glob?.trim() || undefined);
    },
    {
      name: "find_symbol",
      description:
        "Go-to-definition style lookup. Uses TypeScript language service when tsconfig exists; otherwise ripgrep heuristics.",
      schema: z.object({
        symbol: z.string().describe("Symbol name, e.g. createTerminalAgent"),
        file: z
          .string()
          .optional()
          .describe("Optional file hint to disambiguate (path relative to project)"),
        glob: z
          .string()
          .optional()
          .describe('Optional rg glob fallback, e.g. "*.ts" or "src/**"'),
      }),
    },
  );

  const findReferences = tool(
    async ({ symbol, file }) => {
      const name = String(symbol || "").trim();
      if (!name) return "Error: symbol required.";
      const prefer = file?.trim() || undefined;
      const tsNav = getTsNavHost(root);
      if (tsNav) {
        try {
          const out = tsNav.findReferences(name, prefer);
          if (!/No TypeScript references found/i.test(out)) return out;
        } catch {
          /* fall through */
        }
      }
      // rg fallback — all identifier occurrences
      try {
        const { stdout } = await execFileAsync(
          "rg",
          [
            "--line-number",
            "--no-heading",
            "--color",
            "never",
            "-m",
            "50",
            "-w",
            name,
            ".",
          ],
          { cwd: root, timeout: 20_000, maxBuffer: 2_000_000 },
        );
        const lines = String(stdout || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (!lines.length) return `No references for "${name}".`;
        return clip(
          `find_references (rg) "${name}" (${lines.length} hits):\n${lines.slice(0, 50).join("\n")}`,
        );
      } catch (err) {
        const e = err as { stdout?: string };
        const lines = String(e.stdout || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length) {
          return clip(
            `find_references (rg) "${name}":\n${lines.slice(0, 50).join("\n")}`,
          );
        }
        return `No references for "${name}".`;
      }
    },
    {
      name: "find_references",
      description:
        "Find all references to a symbol (TypeScript language service when available, else ripgrep -w).",
      schema: z.object({
        symbol: z.string(),
        file: z
          .string()
          .optional()
          .describe("Optional file hint containing a known occurrence"),
      }),
    },
  );

  const runTests = tool(
    async ({ command, path: focusPath }) => {
      const detected = detectVerifyCommands(root);
      let cmd = String(command || "").trim();
      if (!cmd) {
        if (focusPath?.trim() && detected.test) {
          // Prefer vitest/jest path args when user points at a file.
          const p = focusPath.trim();
          if (/vitest/i.test(detected.test) || detected.test.includes("tsx --test")) {
            cmd = `npx tsx --test ${JSON.stringify(p)}`;
          } else {
            cmd = `${detected.test} -- ${JSON.stringify(p)}`;
          }
        } else {
          cmd = detected.test || detected.typecheck || "";
        }
      }
      if (!cmd) {
        return "No test/typecheck script detected. Pass command explicitly (e.g. npm run test:unit).";
      }
      const result = await runShellCommand(root, cmd, 180_000);
      return clip(
        [
          `$ ${cmd}`,
          result.stdout,
          result.stderr ? `stderr:\n${result.stderr}` : "",
          `exit_code: ${result.code}`,
          result.ok
            ? "PASS"
            : "FAIL — fix errors before claiming done.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    {
      name: "run_tests",
      description:
        "Run project tests or typecheck. Auto-detects npm scripts (test:unit / test / typecheck). Prefer after edits.",
      schema: z.object({
        command: z
          .string()
          .optional()
          .describe("Override command; default = detected test/typecheck"),
        path: z
          .string()
          .optional()
          .describe("Optional file/dir to focus tests on"),
      }),
    },
  );

  return [
    gitStatus,
    gitDiff,
    gitLog,
    gitAdd,
    gitCommit,
    findSymbol,
    findReferences,
    runTests,
  ];
}
