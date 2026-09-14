import { tool } from "langchain";
import { z } from "zod";
import { createRouterModel } from "../model/9router.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const DEFAULT_WORKER =
  "You are a specialized sub-agent. Complete the assigned goal based on the context provided. Return only the final result — concise, evidence-first.";

const ROLE_PRESETS: Record<string, string> = {
  explorer:
    "You are an explorer worker. Map paths, symbols, and evidence. Read-only. Return a concise path/symbol report.",
  coder:
    "You are a coder worker. Propose concrete edits or command sequences. Prefer minimal diffs. Return files to touch + patch outline.",
  reviewer:
    "You are a reviewer worker. List bugs, risks, and missing tests by severity. Return findings only.",
  researcher:
    "You are a research worker. Gather facts from the given context. Return bullet findings with sources/paths.",
  summarizer:
    "You are a summarizer worker. Compress the context into a short actionable brief.",
};

export type DelegateTaskItem = {
  goal: string;
  context: string;
  systemPrompt?: string;
  role?: string;
};

/**
 * Run worker LLM calls in parallel (capped). Used by delegate_task tool.
 */
export async function runParallelWorkers(
  tasks: DelegateTaskItem[],
  options?: { concurrency?: number },
): Promise<string> {
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, 8));
  const model = createRouterModel();
  const results: string[] = new Array(tasks.length);

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      const task = tasks[i]!;
      const rolePrompt =
        (task.role && ROLE_PRESETS[task.role.toLowerCase()]) ||
        task.systemPrompt ||
        DEFAULT_WORKER;
      try {
        const res = await model.invoke([
          new SystemMessage(rolePrompt),
          new HumanMessage(`Context:\n${task.context}\n\nGoal:\n${task.goal}`),
        ]);
        const content =
          typeof res.content === "string"
            ? res.content
            : JSON.stringify(res.content);
        results[i] =
          `### Worker ${i + 1}${task.role ? ` (${task.role})` : ""}\n` +
          `Goal: ${task.goal}\n\n${content}`;
      } catch (err) {
        results[i] =
          `### Worker ${i + 1}${task.role ? ` (${task.role})` : ""} FAILED\n` +
          `${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  const pool = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(pool);

  return (
    `Ran ${tasks.length} workers in parallel (concurrency=${Math.min(concurrency, tasks.length)}).\n\n` +
    results.join("\n\n---\n\n")
  );
}

export function createOrchestrationTools() {
  const delegateTask = tool(
    async ({ tasks, concurrency }) => {
      if (tasks.length < 3) {
        return (
          "Error: delegate_task requires at least 3 parallel workers. " +
          "Split the work into ≥3 independent goals (e.g. explorer / coder / reviewer, " +
          "or 3 research slices) and call again."
        );
      }
      return runParallelWorkers(tasks, {
        concurrency: concurrency ?? Math.min(3, tasks.length),
      });
    },
    {
      name: "delegate_task",
      description:
        "Spawn ≥3 parallel sub-agent workers in ONE call (Promise pool). " +
        "Use after task_plan when todos/research can run independently — do NOT wait " +
        "one-by-one. Typical split: explorer + coder outline + reviewer, or 3 research slices. " +
        "Each worker is an isolated LLM call (no shared tools). For full tool-using " +
        "subagents (filesystem/PTY), also emit multiple `task` tool calls in the same turn.",
      schema: z.object({
        tasks: z
          .array(
            z.object({
              goal: z.string().describe("What this worker should accomplish"),
              context: z
                .string()
                .describe("Background / excerpts needed for the task"),
              role: z
                .enum([
                  "explorer",
                  "coder",
                  "reviewer",
                  "researcher",
                  "summarizer",
                ])
                .optional()
                .describe("Optional role preset for the worker system prompt"),
              systemPrompt: z
                .string()
                .optional()
                .describe("Optional custom instructions (overrides role preset)"),
            }),
          )
          .max(8),
        concurrency: z
          .number()
          .int()
          .min(3)
          .max(8)
          .optional()
          .describe("Parallel workers at once (default 3, max 8)"),
      }),
    },
  );

  return [delegateTask];
}
