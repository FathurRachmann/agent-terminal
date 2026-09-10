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
import {
  formatAgentDisplayText,
  toDisplayLines,
} from "./format-display.js";

type Props = {
  workspaceRoot: string;
  autoApprove: boolean;
  initialPrompt?: string;
};

type ChatLine = {
  id: string;
  role: "user" | "agent" | "step" | "error" | "system";
  text: string;
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function phaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case "thinking":
      return "thinking";
    case "reasoning":
      return "reasoning";
    case "tool":
      return "tool";
    case "pty":
      return "shell";
    case "waiting_approval":
      return "awaiting approval";
    case "reflecting":
      return "reflecting";
    case "done":
      return "done";
    case "error":
      return "error";
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

function truncateOneLine(text: string, max = 140): string {
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
  const [terminal, setTerminal] = useState("");
  const [status, setStatus] = useState("ready");
  const [phase, setPhase] = useState<AgentPhase>("boot");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [approvalPreview, setApprovalPreview] = useState("");
  const approvalResolver = useRef<((decision: ApprovalDecision) => void) | null>(
    null,
  );
  const [agentReady, setAgentReady] = useState<Awaited<
    ReturnType<typeof createTerminalAgent>
  > | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      setStatus("booting agent…");
      setPhase("boot");
      const bundle = await createTerminalAgent({
        workspaceRoot,
        autoApprove,
        enableCheckpointer: true,
        onPtyOutput: (chunk) => {
          if (disposed) return;
          setTerminal((prev) => (prev + chunk).slice(-8000));
          setPhase("pty");
          setStatus("shell output…");
        },
      });
      if (disposed) {
        bundle.sandbox.dispose();
        bundle.memoryStore.close();
        return;
      }
      setAgentReady(bundle);
      setPhase("done");
      setStatus(`ready · ${describeContextPolicy()}`);
      setChat((prev) => [
        ...prev,
        {
          id: newId("sys"),
          role: "system",
          text: bundle.desktopEnabled
            ? "Desktop automation on (Chrome). Ask to open a URL — approve with y when prompted."
            : "Desktop automation off (non-macOS or DESKTOP_AUTOMATION=0).",
        },
      ]);
      if (initialPrompt?.trim()) {
        void submit(bundle, initialPrompt.trim());
      }
    })().catch((err) => {
      setPhase("error");
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, [busy]);

  function appendLine(line: Omit<ChatLine, "id"> & { id?: string }): void {
    setChat((prev) =>
      [...prev, { id: line.id ?? newId(line.role), ...line }].slice(-80),
    );
  }

  /** Update or insert the latest step/agent line of a given role. */
  function upsertTrailing(
    role: ChatLine["role"],
    text: string,
    matchPrefix?: string,
  ): void {
    setChat((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i -= 1) {
        const line = copy[i]!;
        if (line.role !== role) continue;
        if (matchPrefix && !line.text.startsWith(matchPrefix)) continue;
        copy[i] = { ...line, text };
        return copy;
      }
      return [...copy, { id: newId(role), role, text }].slice(-80);
    });
  }

  function requestApproval(payload: unknown): Promise<ApprovalDecision> {
    const preview = truncateOneLine(
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload) ?? "tool interrupt",
      160,
    );
    setApprovalPreview(preview);
    setPendingApproval(true);
    setStatus("approval required · press y / n");
    appendLine({
      role: "system",
      text: `⏸ approval required — press y to approve, n to reject`,
    });
    if (preview) {
      appendLine({
        role: "step",
        text: `⚠ ${preview}`,
      });
    }
    return new Promise((resolve) => {
      approvalResolver.current = (decision) => {
        setPendingApproval(false);
        setApprovalPreview("");
        approvalResolver.current = null;
        appendLine({
          role: "system",
          text:
            decision.decisions[0]?.type === "approve"
              ? "✓ approved — continuing"
              : "✖ rejected — stopping tool",
        });
        resolve(decision);
      };
    });
  }

  async function submit(
    bundle: NonNullable<typeof agentReady>,
    prompt: string,
  ) {
    setBusy(true);
    setTurnStartedAt(Date.now());
    appendLine({ role: "user", text: prompt });
    setPhase("thinking");
    setStatus("thinking…");
    appendLine({ role: "step", text: "⏳ thinking…" });

    let assistant = "";
    let reasoning = "";
    let agentLineStarted = false;

    const onEvent = (event: AgentUiEvent) => {
      if (event.type === "status") {
        setPhase(event.phase);
        setStatus(`${phaseLabel(event.phase)} · ${event.detail}`);
        if (event.phase === "thinking" || event.phase === "waiting_approval") {
          upsertTrailing(
            "step",
            `⏳ ${phaseLabel(event.phase)} · ${truncateOneLine(event.detail, 100)}`,
            "⏳",
          );
        } else if (event.phase === "reflecting") {
          // Always append after the answer — never rewrite the earlier thinking step.
          appendLine({
            role: "step",
            text: `⏳ reflecting · ${truncateOneLine(event.detail, 100)}`,
          });
        }
      }

      if (event.type === "reasoning") {
        reasoning += event.text;
        const preview = truncateOneLine(
          formatAgentDisplayText(reasoning),
          110,
        );
        setStatus(`reasoning · ${preview || "…"}`);
        upsertTrailing("step", `💭 ${preview || "…"}`, "💭");
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
          typeof event.input === "string"
            ? event.input
            : JSON.stringify(event.input) ?? "",
          100,
        );
        appendLine({
          role: "step",
          text: `▶ ${event.name}(${args})`,
        });
        setStatus(`tool · ${event.name}`);
      }

      if (event.type === "tool_end") {
        appendLine({
          role: "step",
          text: `✓ ${event.name} → ${truncateOneLine(event.output, 100)}`,
        });
      }

      if (event.type === "context_compacted") {
        appendLine({ role: "system", text: `📦 ${event.detail}` });
      }

      if (event.type === "warning") {
        appendLine({ role: "system", text: `⚠ ${event.message}` });
      }

      if (event.type === "error") {
        appendLine({ role: "error", text: event.message });
      }

      if (event.type === "reflection" && event.memoryIds.length > 0) {
        appendLine({
          role: "step",
          text: `🧠 reflected (${event.memoryIds.length} memories)`,
        });
      }

      if (event.type === "interrupt") {
        // requestApproval() already adds the chat lines.
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
        threadId: "ink-tui",
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
      setStatus("ready");
    } catch (err) {
      setPhase("error");
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setTurnStartedAt(null);
      setInputLine("");
    }
  }

  useInput((input, key) => {
    if (key.escape) {
      if (pendingApproval && approvalResolver.current) {
        approvalResolver.current({
          decisions: [{ type: "reject" }],
        });
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
        approvalResolver.current?.({
          decisions: [{ type: "approve" }],
        });
      } else if (answer === "n") {
        approvalResolver.current?.({
          decisions: [{ type: "reject" }],
        });
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
  const elapsed =
    busy && turnStartedAt ? formatElapsed(Date.now() - turnStartedAt) : null;

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box>
        <Text bold>Agent TUI</Text>
        <Text> · {workspaceRoot}</Text>
      </Box>
      <Text dimColor>
        {spinner} {status}
        {elapsed ? ` · ${elapsed}` : ""} · Esc to quit
      </Text>

      <Box flexDirection="row" marginTop={1} flexGrow={1}>
        <Box
          flexDirection="column"
          width="70%"
          borderStyle="single"
          paddingX={1}
          marginRight={1}
        >
          <Text bold>Chat</Text>
          {chat.length === 0 ? (
            <Text dimColor>
              (ask something — steps appear here before the answer)
            </Text>
          ) : (
            chat.slice(-36).map((line) => (
              <Box key={line.id} flexDirection="column" marginBottom={line.role === "agent" ? 1 : 0}>
                {line.role === "user" && (
                  <Text>
                    <Text color="cyan" bold>
                      You:{" "}
                    </Text>
                    {line.text}
                  </Text>
                )}
                {line.role === "step" && (
                  <Text dimColor color="yellow">
                    {"  "}
                    {line.text}
                  </Text>
                )}
                {line.role === "system" && (
                  <Text dimColor>
                    {"  "}
                    {line.text}
                  </Text>
                )}
                {line.role === "agent" && (
                  <Box flexDirection="column">
                    <Text color="green" bold>
                      Agent:
                    </Text>
                    {toDisplayLines(line.text).map((row, i) =>
                      row.length === 0 ? (
                        <Text key={`${line.id}-b-${i}`}> </Text>
                      ) : (
                        <Text key={`${line.id}-r-${i}`}>{row}</Text>
                      ),
                    )}
                  </Box>
                )}
                {line.role === "error" && (
                  <Text color="red">Error: {line.text}</Text>
                )}
              </Box>
            ))
          )}
        </Box>

        <Box flexDirection="column" width="30%" borderStyle="single" paddingX={1}>
          <Text bold>Terminal</Text>
          <Text>
            {terminal.slice(-2800) || "(pty output will appear here)"}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        {pendingApproval ? (
          <Text color="yellow" bold>
            Approval? [y]es / [n]o · Esc=reject
            {approvalPreview ? ` · ${approvalPreview.slice(0, 60)}` : ""}
          </Text>
        ) : (
          <>
            <Text>
              {busy ? `${SPINNER[tick % SPINNER.length]} working… ` : "> "}
            </Text>
            <Text>{busy ? "(wait for turn to finish)" : inputLine}</Text>
            {!busy && <Text inverse> </Text>}
          </>
        )}
      </Box>
    </Box>
  );
}

async function main() {
  const program = new Cli()
    .name("agent-tui")
    .argument("[prompt...]", "Optional initial prompt")
    .option(
      "-c, --cwd <path>",
      "Workspace root",
      process.env.AGENT_WORKSPACE ?? process.cwd(),
    )
    .option("-y, --yes", "Auto-approve interrupts", false)
    .parse(process.argv);

  const opts = program.opts<{ cwd: string; yes: boolean }>();
  const prompt = (program.args as string[]).join(" ");

  const instance = render(
    <App
      workspaceRoot={path.resolve(opts.cwd)}
      autoApprove={opts.yes}
      initialPrompt={prompt || undefined}
    />,
  );

  await instance.waitUntilExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
