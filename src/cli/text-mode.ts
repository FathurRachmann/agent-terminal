#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { createTerminalAgent } from "../agent/create-agent.js";
import { runAgentTurn } from "./run-agent.js";
import { describeContextPolicy } from "../agent/context-policy.js";

export type TextModeOptions = {
  cwd: string;
  yes: boolean;
  thread?: string;
  repl: boolean;
  verbose: boolean;
  promptParts: string[];
};

/* ── ANSI Color Helpers (Zero dependencies) ─────────────────── */

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  bgCyan: "\x1b[46m\x1b[30m",
  bgBlue: "\x1b[44m\x1b[37m",
  bgYellow: "\x1b[43m\x1b[30m",
  bgGreen: "\x1b[42m\x1b[30m",
};

function banner(workspace: string, policy: string, desktop: boolean): string {
  return [
    "",
    `${c.bgCyan}${c.bold} AGENT TERMINAL ${c.reset} ${c.dim}v0.1.0${c.reset}`,
    `${c.gray}─`.repeat(55) + c.reset,
    ` ${c.bold}Workspace:${c.reset} ${c.cyan}${workspace}${c.reset}`,
    ` ${c.bold}Context:${c.reset}   ${c.gray}${policy}${c.reset}`,
    ` ${c.bold}Desktop:${c.reset}   ${desktop ? `${c.green}Chrome Automation Enabled${c.reset}` : `${c.gray}Disabled${c.reset}`}`,
    `${c.gray}─`.repeat(55) + c.reset,
    "",
  ].join("\n");
}

export async function runTextMode(opts: TextModeOptions): Promise<void> {
  const workspaceRoot = path.resolve(opts.cwd);

  const bundle = await createTerminalAgent({
    workspaceRoot,
    autoApprove: opts.yes,
    enableCheckpointer: true,
    onPtyOutput: opts.verbose
      ? (chunk) => {
          process.stderr.write(`${c.dim}${chunk}${c.reset}`);
        }
      : undefined,
  });

  const {
    agent,
    sandbox,
    memoryStore,
    sessionStore,
    embedder,
    model,
    contextPolicy,
    enableReflection,
    desktopEnabled,
  } = bundle;

  process.stdout.write(banner(workspaceRoot, contextPolicy, desktopEnabled));

  const memory = {
    sessionStore,
    memoryStore,
    embedder,
    model,
    workspaceRoot,
    enableReflection,
  };

  const onEvent = (
    event: Parameters<NonNullable<Parameters<typeof runAgentTurn>[0]["onEvent"]>>[0],
  ) => {
    switch (event.type) {
      case "token":
        process.stdout.write(event.text);
        break;
      case "status":
        if (opts.verbose) {
          process.stderr.write(`\n${c.dim}⚡ [${event.phase}] ${event.detail}${c.reset}\n`);
        }
        break;
      case "tool_start": {
        const inputStr =
          typeof event.input === "string"
            ? event.input.slice(0, 100)
            : JSON.stringify(event.input)?.slice(0, 100) ?? "";
        process.stderr.write(
          `\n${c.cyan}⚙ ${c.bold}${event.name}${c.reset}${c.dim}(${inputStr})${c.reset}\n`
        );
        break;
      }
      case "tool_end":
        if (opts.verbose) {
          process.stderr.write(
            `  ${c.green}✔ ${c.dim}${event.output.slice(0, 140).replace(/\n/g, " ")}${c.reset}\n`
          );
        }
        break;
      case "reasoning":
        if (opts.verbose) {
          process.stderr.write(`${c.magenta}${c.italic}${event.text}${c.reset}`);
        }
        break;
      case "context_compacted":
        process.stdout.write(`\n\n${c.yellow}📦 [Context Compacted] ${event.detail}${c.reset}\n\n`);
        break;
      case "interrupt":
        process.stdout.write("\n");
        break;
      case "done":
        if (event.text) process.stdout.write("\n");
        break;
      case "error":
        process.stderr.write(`\n${c.red}${c.bold}✖ Error:${c.reset} ${c.red}${event.message}${c.reset}\n`);
        break;
      case "warning":
        process.stderr.write(`\n${c.yellow}⚠️  ${event.message}${c.reset}\n`);
        break;
      case "reflection":
        if (opts.verbose) {
          process.stderr.write(
            `\n${c.blue}🧠 Memory updated (${event.memoryIds.length} records)${c.reset}\n`
          );
        }
        break;
      default:
        break;
    }
  };

  try {
    if (opts.repl || opts.promptParts.length === 0) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      process.stdout.write(`${c.dim}Type 'exit' or 'quit' to close.${c.reset}\n`);
      for (;;) {
        const line = (await rl.question(`\n${c.cyan}${c.bold}User>${c.reset} `)).trim();
        if (!line) continue;
        if (line === "exit" || line === "quit") break;

        process.stdout.write(`\n${c.green}${c.bold}Agent>${c.reset} `);
        await runAgentTurn({
          agent,
          prompt: line,
          threadId: opts.thread ?? "repl",
          autoApprove: opts.yes,
          onEvent,
          desktopEnabled,
          memory,
        });
      }
      rl.close();
    } else {
      process.stdout.write(`${c.cyan}${c.bold}User>${c.reset} ${opts.promptParts.join(" ")}\n\n${c.green}${c.bold}Agent>${c.reset} `);
      await runAgentTurn({
        agent,
        prompt: opts.promptParts.join(" "),
        threadId: opts.thread,
        autoApprove: opts.yes,
        onEvent,
        desktopEnabled,
        memory,
      });
    }
  } finally {
    sandbox.dispose();
    memoryStore.close();
  }
}