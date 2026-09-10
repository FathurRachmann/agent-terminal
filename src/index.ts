#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command as Cli } from "commander";
import { createTerminalAgent } from "./agent/create-agent.js";
import { runAgentTurn } from "./cli/run-agent.js";
import { describeContextPolicy } from "./agent/context-policy.js";

async function main(): Promise<void> {
  const program = new Cli()
    .name("agent")
    .description("Terminal-first AI coding agent (Deep Agents + 9router)")
    .argument("[prompt...]", "User task / prompt")
    .option("-c, --cwd <path>", "Workspace root", process.env.AGENT_WORKSPACE ?? process.cwd())
    .option("-y, --yes", "Auto-approve destructive tool interrupts", false)
    .option("-t, --thread <id>", "Thread id for checkpointed sessions")
    .option("--repl", "Interactive REPL mode", false)
    .option("-v, --verbose", "Echo live PTY output to stderr", false)
    .parse(process.argv);

  const opts = program.opts<{
    cwd: string;
    yes: boolean;
    thread?: string;
    repl: boolean;
    verbose: boolean;
  }>();
  const promptParts = program.args as string[];
  const workspaceRoot = path.resolve(opts.cwd);

  process.stdout.write(`Workspace: ${workspaceRoot}\n`);
  process.stdout.write(`Context:   ${describeContextPolicy()}\n`);

  const bundle = await createTerminalAgent({
    workspaceRoot,
    autoApprove: opts.yes,
    enableCheckpointer: true,
    onPtyOutput: opts.verbose
      ? (chunk) => {
          process.stderr.write(`\x1b[2m${chunk}\x1b[0m`);
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

  process.stdout.write(`Ready (${contextPolicy})\n`);
  if (desktopEnabled) {
    process.stdout.write(`Desktop:   Chrome automation on\n`);
  }
  process.stdout.write("\n");

  const memory = {
    sessionStore,
    memoryStore,
    embedder,
    model,
    workspaceRoot,
    enableReflection,
  };

  const onEvent = (event: Parameters<NonNullable<Parameters<typeof runAgentTurn>[0]["onEvent"]>>[0]) => {
    switch (event.type) {
      case "token":
        process.stdout.write(event.text);
        break;
      case "status":
        if (opts.verbose) {
          process.stderr.write(`\n⏳ ${event.phase}: ${event.detail}\n`);
        }
        break;
      case "tool_start":
        process.stderr.write(
          `\n🔧 ${event.name}(${typeof event.input === "string" ? event.input.slice(0, 120) : JSON.stringify(event.input)?.slice(0, 120) ?? ""})\n`,
        );
        break;
      case "tool_end":
        if (opts.verbose) {
          process.stderr.write(`   ↳ ${event.output.slice(0, 160)}\n`);
        }
        break;
      case "reasoning":
        if (opts.verbose) {
          process.stderr.write(event.text);
        }
        break;
      case "context_compacted":
        process.stdout.write(`\n\n📦 context_compacted: ${event.detail}\n\n`);
        break;
      case "interrupt":
        process.stdout.write("\n");
        break;
      case "done":
        if (event.text) process.stdout.write("\n");
        break;
      case "error":
        process.stderr.write(`\nError: ${event.message}\n`);
        break;
      case "warning":
        process.stderr.write(`\n⚠️  ${event.message}\n`);
        break;
      case "reflection":
        if (opts.verbose) {
          process.stderr.write(
            `\n🧠 reflected → ${event.memoryIds.length} memories\n`,
          );
        }
        break;
      default:
        break;
    }
  };

  try {
    if (opts.repl || promptParts.length === 0) {
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      process.stdout.write("REPL mode. Type 'exit' to quit.\n");
      for (;;) {
        const line = (await rl.question("\n> ")).trim();
        if (!line) continue;
        if (line === "exit" || line === "quit") break;
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
      await runAgentTurn({
        agent,
        prompt: promptParts.join(" "),
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
