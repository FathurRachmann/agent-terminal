import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { loadTaskBoard } from "./task-tools.js";
import {
  boardFingerprint,
  buildFixedWorkerTasks,
  mergeOrchestrationResult,
  shouldRunFixedOrchestration,
} from "./fixed-orchestration.js";
import {
  loadSkillAgentSpecs,
  matchSkillAgents,
} from "./skill-registry.js";
import {
  runParallelWorkers,
  type DelegateTaskItem,
} from "./orchestration.js";

export type MultiTaskInjectOptions = {
  workspaceRoot: string;
  /** Profile skills root (usually `profileHome/.agent/skills`). */
  skillsRoot: string;
  /**
   * When to inject. Default `task_todos` so workers run only after HITL
   * plan approval (interruptOn.task_todos).
   */
  triggerOn?: "task_todos" | "task_plan";
  enabled?: boolean;
  /** Injected for tests. */
  runWorkers?: (
    tasks: DelegateTaskItem[],
    options?: { concurrency?: number },
  ) => Promise<string>;
  loadBoard?: typeof loadTaskBoard;
  loadSkillSpecs?: typeof loadSkillAgentSpecs;
};

function asToolMessage(result: unknown): ToolMessage | null {
  if (ToolMessage.isInstance(result)) return result;
  return null;
}

function withMergedContent(result: ToolMessage, merged: string): ToolMessage {
  return new ToolMessage({
    content: merged,
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: result.status,
    additional_kwargs: result.additional_kwargs,
    response_metadata: result.response_metadata,
    id: result.id,
    artifact: result.artifact,
  });
}

/**
 * Fixed graph: after approved task_todos (or task_plan), run parallel
 * explorer/coder/reviewer (+ skill agents) via runParallelWorkers and merge
 * into the tool result. Model does not decide whether to delegate.
 */
export function createMultiTaskInjectMiddleware(options: MultiTaskInjectOptions) {
  const triggerOn = options.triggerOn ?? "task_todos";
  const enabled = options.enabled !== false;
  const runWorkers = options.runWorkers ?? runParallelWorkers;
  const loadBoard = options.loadBoard ?? loadTaskBoard;
  const loadSkillSpecs = options.loadSkillSpecs ?? loadSkillAgentSpecs;

  let lastFingerprint: string | null = null;

  return createMiddleware({
    name: "MultiTaskInjectMiddleware",
    async wrapToolCall(request, handler) {
      const result = await handler(request);
      if (!enabled) return result;
      if (request.toolCall.name !== triggerOn) return result;

      const msg = asToolMessage(result);
      if (!msg) return result;
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      if (/^Error:/i.test(content.trim())) return result;

      const board = loadBoard(options.workspaceRoot);
      if (!board || !shouldRunFixedOrchestration(board)) return result;
      const fp = boardFingerprint(board);
      if (fp === lastFingerprint) {
        return withMergedContent(
          msg,
          `${content.trimEnd()}\n\n(Parallel worker synthesis skipped — same plan fingerprint ${fp}.)`,
        );
      }

      try {
        const specs = loadSkillSpecs(options.skillsRoot);
        const matched = matchSkillAgents(board.skillsUsed, specs);
        const tasks = buildFixedWorkerTasks(board, matched);
        const workerOutput = await runWorkers(tasks, {
          concurrency: Math.min(3, tasks.length),
        });
        lastFingerprint = fp;
        return withMergedContent(
          msg,
          mergeOrchestrationResult(content, workerOutput),
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return withMergedContent(
          msg,
          `${content.trimEnd()}\n\n---\n\n## Parallel worker synthesis FAILED\n${errMsg}`,
        );
      }
    },
  });
}
