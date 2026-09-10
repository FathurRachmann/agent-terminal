#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command as Cli } from "commander";
import { runTextMode } from "./cli/text-mode.js";
import { startTui } from "./cli/app.js";

async function main(): Promise<void> {
  const program = new Cli()
    .name("agent")
    .description(
      "Terminal-first AI coding agent. Default: Ink TUI. Use -t/--text for CLI without TUI.",
    )
    .argument("[prompt...]", "User task / prompt")
    .option(
      "-c, --cwd <path>",
      "Workspace root",
      process.env.AGENT_WORKSPACE ?? process.cwd(),
    )
    .option("-y, --yes", "Auto-approve destructive tool interrupts", false)
    .option(
      "-t, --text",
      "Run without Ink TUI (plain CLI / REPL)",
      false,
    )
    .option("--thread <id>", "Thread id for checkpointed sessions")
    .option("--repl", "Interactive REPL (text mode only)", false)
    .option("-v, --verbose", "Echo live PTY output to stderr (text mode)", false)
    .parse(process.argv);

  const opts = program.opts<{
    cwd: string;
    yes: boolean;
    text: boolean;
    thread?: string;
    repl: boolean;
    verbose: boolean;
  }>();
  const promptParts = program.args as string[];

  if (opts.text || opts.repl) {
    await runTextMode({
      cwd: opts.cwd,
      yes: opts.yes,
      thread: opts.thread,
      repl: opts.repl || promptParts.length === 0,
      verbose: opts.verbose,
      promptParts,
    });
    return;
  }

  await startTui({
    workspaceRoot: path.resolve(opts.cwd),
    autoApprove: opts.yes,
    initialPrompt:
      promptParts.length > 0 ? promptParts.join(" ") : undefined,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
