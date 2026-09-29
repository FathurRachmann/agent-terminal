/**
 * wrapToolCall middleware that runs preToolUse / beforeShellExecution / beforeMCPExecution hooks.
 */
import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { runHooks } from "./run-hooks.js";
import { extractExecuteCommand } from "../run-modes.js";

function resumeApproved(resume: unknown): boolean {
  if (!resume || typeof resume !== "object") return false;
  const decisions = (resume as { decisions?: Array<{ type?: string }> })
    .decisions;
  if (!Array.isArray(decisions)) return false;
  return decisions.some((d) => d?.type === "approve");
}

export function createHooksToolMiddleware(options: {
  workspaceRoot: string;
  profileHome?: string;
}) {
  return createMiddleware({
    name: "AgentHooksToolGate",
    async wrapToolCall(request, handler) {
      const toolCall = request.toolCall;
      const name = toolCall.name;
      const args = toolCall.args;
      const cmd = extractExecuteCommand(args);
      const hay = `${name} ${cmd}`.trim();

      const pre = await runHooks({
        name: "preToolUse",
        workspaceRoot: options.workspaceRoot,
        profileHome: options.profileHome,
        matcherHaystack: hay,
        payload: { tool_name: name, tool_input: args },
      });

      let shell: Awaited<ReturnType<typeof runHooks>> = {};
      if (name === "execute") {
        shell = await runHooks({
          name: "beforeShellExecution",
          workspaceRoot: options.workspaceRoot,
          profileHome: options.profileHome,
          matcherHaystack: cmd || hay,
          payload: { command: cmd, tool_name: name, tool_input: args },
        });
      } else if (name.startsWith("mcp_")) {
        shell = await runHooks({
          name: "beforeMCPExecution",
          workspaceRoot: options.workspaceRoot,
          profileHome: options.profileHome,
          matcherHaystack: hay,
          payload: { tool_name: name, tool_input: args },
        });
      }

      const denied = pre.denied || shell.denied;
      const ask = !denied && (pre.ask || shell.ask);
      const agentMsg =
        pre.agent_message || shell.agent_message || "Blocked by hook";

      if (denied) {
        return new ToolMessage({
          content: `Error: ${agentMsg}`,
          tool_call_id: toolCall.id ?? "",
          name,
          status: "error",
        });
      }

      if (ask) {
        const resume = interrupt({
          actionRequests: [
            {
              name,
              args,
              id: toolCall.id ?? undefined,
              reason: "hook_ask",
            },
          ],
        });
        if (!resumeApproved(resume)) {
          return new ToolMessage({
            content: `Error: user rejected hook approval for ${name}. ${agentMsg}`,
            tool_call_id: toolCall.id ?? "",
            name,
            status: "error",
          });
        }
      }

      const result = await handler(request);

      void runHooks({
        name: "postToolUse",
        workspaceRoot: options.workspaceRoot,
        profileHome: options.profileHome,
        matcherHaystack: hay,
        payload: { tool_name: name, tool_input: args },
      }).catch(() => undefined);

      return result;
    },
  });
}
