#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import React, { useEffect, useRef, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { Command as Cli } from "commander";
import { createTerminalAgent } from "../agent/create-agent.js";
import {
  runAgentTurn,
  type AgentPhase,
  type AgentUiEvent,
  type ApprovalDecision,
} from "./run-agent.js";
import { describeContextPolicy } from "../agent/context-policy.js";
import { formatAgentDisplayText, toDisplayLines } from "./format-display.js";

type Props = {
  workspaceRoot: string;
  autoApprove: boolean;
  initialPrompt?: string;
};

type ChatLine = {
  id: string;
  role: "user" | "agent" | "step" | "tool" | "error" | "system";
  text: string;
  toolName?: string;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function phaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case "thinking":
      return "Thinking";
    case "reasoning":
      return "Reasoning";
    case "tool":
      return "Executing Tool";
    case "pty":
      return "Running Shell";
    case "waiting_approval":
      return "Awaiting Approval";
    case "reflecting":
      return "Reflecting";
    case "done":
      return "Ready";
    case "error":
      return "Error";
    default:
      return phase;
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function truncateOneLine(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function App({ workspaceRoot, autoApprove, initialPrompt }: Props) {
  const { exit } = useApp();
  const [inputLine, setInputLine] = useState(initialPrompt ?? "");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [status, setStatus] = useState("Initializing…");
  const [phase, setPhase] = useState<AgentPhase>("boot");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [approvalPreview, setApprovalPreview] = useState("");
  const approvalResolver = useRef<((decision: ApprovalDecision) => void) | null>(null);
  const [agentReady, setAgentReady] = useState<Awaited<ReturnType<typeof createTerminalAgent>> | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      setStatus("Booting agent harness…");
      setPhase("boot");
      const bundle = await createTerminalAgent({
        workspaceRoot,
        autoApprove,
        enableCheckpointer: true,
      });
      if (disposed) {
        bundle.sandbox.dispose();
        bundle.memoryStore.close();
        return;
      }
      setAgentReady(bundle);
      setPhase("done");
      setStatus("Ready");
      if (initialPrompt?.trim()) {
        void submit(bundle, initialPrompt.trim());
      }
    })().catch((err) => {
      setPhase("error");
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [busy]);

  function appendLine(line: Omit<ChatLine, "id"> & { id?: string }): void {
    setChat((prev) => [...prev, { id: line.id ?? newId(line.role), ...line }].slice(-100));
  }

  function upsertTrailing(role: ChatLine["role"], text: string, matchPrefix?: string): void {
    setChat((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i -= 1) {
        const line = copy[i]!;
        if (line.role !== role) continue;
        if (matchPrefix && !line.text.startsWith(matchPrefix)) continue;
        copy[i] = { ...line, text };
        return copy;
      }
      return [...copy, { id: newId(role), role, text }].slice(-100);
    });
  }

  function requestApproval(payload: unknown): Promise<ApprovalDecision> {
    const preview = truncateOneLine(
      typeof payload === "string" ? payload : JSON.stringify(payload) ?? "Tool execution interrupt",
      120
    );
    setApprovalPreview(preview);
    setPendingApproval(true);
    setStatus("Approval required");
    appendLine({
      role: "system",
      text: `⚠️ Approval required for action: ${preview}`,
    });
    return new Promise((resolve) => {
      approvalResolver.current = (decision) => {
        setPendingApproval(false);
        setApprovalPreview("");
        approvalResolver.current = null;
        appendLine({
          role: "system",
          text:
            decision.decisions[0]?.type === "approve"
              ? "✔ Approved by user"
              : "✖ Rejected by user",
        });
        resolve(decision);
      };
    });
  }

  async function submit(bundle: NonNullable<typeof agentReady>, prompt: string) {
    setBusy(true);
    setTurnStartedAt(Date.now());
    appendLine({ role: "user", text: prompt });
    setPhase("thinking");
    setStatus("Thinking…");

    let assistant = "";
    let reasoning = "";
    let agentLineStarted = false;

    const onEvent = (event: AgentUiEvent) => {
      if (event.type === "status") {
        setPhase(event.phase);
        setStatus(`${phaseLabel(event.phase)} · ${event.detail}`);
      }

      if (event.type === "reasoning") {
        reasoning += event.text;
        const preview = truncateOneLine(formatAgentDisplayText(reasoning), 100);
        upsertTrailing("step", `💭 ${preview || "Thinking…"}`, "💭");
      }

      if (event.type === "token") {
        assistant += event.text;
        const visible = formatAgentDisplayText(assistant);
        if (!agentLineStarted) {
          agentLineStarted = true;
          appendLine({ role: "agent", text: visible });
        } else {
          upsertTrailing("agent", visible);
        }
      }

      if (event.type === "tool_start") {
        const args = truncateOneLine(
          typeof event.input === "string" ? event.input : JSON.stringify(event.input) ?? "",
          90
        );
        appendLine({
          role: "tool",
          toolName: event.name,
          text: args,
        });
        setStatus(`Executing ${event.name}…`);
      }

      if (event.type === "context_compacted") {
        appendLine({ role: "system", text: `📦 Context window compacted: ${event.detail}` });
      }

      if (event.type === "warning") {
        appendLine({ role: "system", text: `⚠️ ${event.message}` });
      }

      if (event.type === "error") {
        appendLine({ role: "error", text: event.message });
      }

      if (event.type === "done" && event.text && !assistant) {
        appendLine({
          role: "agent",
          text: formatAgentDisplayText(event.text),
        });
      }
    };

    try {
      await runAgentTurn({
        agent: bundle.agent,
        prompt,
        threadId: "agent-cli",
        autoApprove,
        onEvent,
        requestApproval: autoApprove ? undefined : requestApproval,
        desktopEnabled: bundle.desktopEnabled,
        memory: {
          sessionStore: bundle.sessionStore,
          memoryStore: bundle.memoryStore,
          embedder: bundle.embedder,
          model: bundle.model,
          workspaceRoot: bundle.workspaceRoot,
          enableReflection: bundle.enableReflection,
        },
      });
      setPhase("done");
      setStatus("Ready");
    } catch (err) {
      setPhase("error");
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setTurnStartedAt(null);
      setInputLine("");
    }
  }

  useInput((input, key) => {
    if (key.escape) {
      if (pendingApproval && approvalResolver.current) {
        approvalResolver.current({ decisions: [{ type: "reject" }] });
        return;
      }
      agentReady?.sandbox.dispose();
      agentReady?.memoryStore.close();
      exit();
      return;
    }

    if (pendingApproval) {
      const answer = input.toLowerCase();
      if (answer === "y") {
        approvalResolver.current?.({ decisions: [{ type: "approve" }] });
      } else if (answer === "n") {
        approvalResolver.current?.({ decisions: [{ type: "reject" }] });
      }
      return;
    }

    if (busy) return;
    if (key.return) {
      const prompt = inputLine.trim();
      if (!prompt || !agentReady) return;
      void submit(agentReady, prompt);
      return;
    }
    if (key.backspace || key.delete) {
      setInputLine((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputLine((v) => v + input);
    }
  });

  const spinner = busy ? SPINNER[tick % SPINNER.length] : "•";
  const elapsed = busy && turnStartedAt ? formatElapsed(Date.now() - turnStartedAt) : null;

  return (
    <Box flexDirection="column" paddingX={1} width="100%">
      {/* Top Header Banner */}
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            AGENT CLI
          </Text>
          <Text dimColor>v0.1.0 · 9router</Text>
        </Box>
        <Box>
          <Text dimColor>Workspace: </Text>
          <Text color="yellow">{workspaceRoot}</Text>
        </Box>
        {agentReady && (
          <Box>
            <Text dimColor>Desktop: </Text>
            <Text color={agentReady.desktopEnabled ? "green" : "gray"}>
              {agentReady.desktopEnabled ? "Chrome Automation Active" : "Disabled"}
            </Text>
          </Box>
        )}
      </Box>

      {/* Main Chat & Event Stream */}
      <Box flexDirection="column" marginBottom={1}>
        {chat.length === 0 ? (
          <Text dimColor italic>
            Ketik pertanyaan atau instruksi tugas untuk memulai...
          </Text>
        ) : (
          chat.map((line) => (
            <Box key={line.id} flexDirection="column" marginBottom={line.role === "agent" ? 1 : 0}>
              {line.role === "user" && (
                <Box marginTop={1}>
                  <Text color="cyan" bold>
                    User ❯{" "}
                  </Text>
                  <Text bold>{line.text}</Text>
                </Box>
              )}

              {line.role === "step" && (
                <Text color="magenta" italic>
                  {line.text}
                </Text>
              )}

              {line.role === "tool" && (
                <Box marginY={0}>
                  <Text color="black" backgroundColor="cyan" bold>
                    {" "}
                    TOOL: {line.toolName}{" "}
                  </Text>
                  <Text dimColor> {line.text}</Text>
                </Box>
              )}

              {line.role === "system" && (
                <Text color="yellow" dimColor>
                  {line.text}
                </Text>
              )}

              {line.role === "agent" && (
                <Box flexDirection="column" marginTop={1}>
                  <Text color="green" bold>
                    Agent ❯
                  </Text>
                  {toDisplayLines(line.text).map((row, i) =>
                    row.length === 0 ? (
                      <Text key={`${line.id}-b-${i}`}> </Text>
                    ) : (
                      <Text key={`${line.id}-r-${i}`}>{row}</Text>
                    )
                  )}
                </Box>
              )}

              {line.role === "error" && (
                <Box marginY={1}>
                  <Text color="black" backgroundColor="red" bold>
                    {" "}
                    ERROR{" "}
                  </Text>
                  <Text color="red"> {line.text}</Text>
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>

      {/* Bottom Status & Input Bar */}
      <Box borderStyle="single" borderColor={pendingApproval ? "yellow" : busy ? "cyan" : "gray"} paddingX={1}>
        {pendingApproval ? (
          <Text color="yellow" bold>
            ⚠️ Approve execution? Press [y] Yes / [n] No {approvalPreview ? `(${approvalPreview})` : ""}
          </Text>
        ) : (
          <Box width="100%">
            <Text color="cyan" bold>
              {busy ? `${spinner} [${status}] ` : "Prompt ❯ "}
            </Text>
            <Text>{busy ? "" : inputLine}</Text>
            {!busy && <Text inverse> </Text>}
            {elapsed && (
              <Box flexGrow={1} justifyContent="flex-end">
                <Text dimColor>{elapsed}</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export async function startTui(options: Props): Promise<void> {
  const instance = render(
    <App
      workspaceRoot={options.workspaceRoot}
      autoApprove={options.autoApprove}
      initialPrompt={options.initialPrompt}
    />
  );
  await instance.waitUntilExit();
}

export async function startTuiFromArgv(argv: string[]): Promise<void> {
  const program = new Cli()
    .name("agent")
    .argument("[prompt...]", "Optional initial prompt")
    .option("-c, --cwd <path>", "Workspace root", process.env.AGENT_WORKSPACE ?? process.cwd())
    .option("-y, --yes", "Auto-approve interrupts", false)
    .allowUnknownOption(true)
    .parse(argv, { from: "node" });

  const opts = program.opts<{ cwd: string; yes: boolean }>();
  const prompt = (program.args as string[]).join(" ");

  await startTui({
    workspaceRoot: path.resolve(opts.cwd),
    autoApprove: opts.yes,
    initialPrompt: prompt || undefined,
  });
}

const isDirectEntry =
  process.argv[1]?.includes(`${path.sep}cli${path.sep}app.`) ||
  process.argv[1]?.endsWith("app.tsx") ||
  process.argv[1]?.endsWith("app.js");

if (isDirectEntry) {
  startTuiFromArgv(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}