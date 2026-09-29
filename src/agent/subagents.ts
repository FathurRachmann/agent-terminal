import type { SubAgent } from "deepagents";
import {
  ARCHITECT_PROMPT,
  CODER_PROMPT,
  DEBUGGER_PROMPT,
  DOCS_PROMPT,
  EXPLORER_PROMPT,
  REVIEWER_PROMPT,
  SECURITY_PROMPT,
  TESTER_PROMPT,
} from "../prompts/system.js";
import { createOfficeBinaryWriteGuardMiddleware } from "./office-binary-write-guard.js";

/** Built-in specialists available via the `task` tool (8). */
export const SPECIALIST_SUBAGENT_NAMES = [
  "explorer",
  "coder",
  "reviewer",
  "tester",
  "security",
  "debugger",
  "docs",
  "architect",
] as const;

export type SpecialistSubagentName = (typeof SPECIALIST_SUBAGENT_NAMES)[number];

/** Shared guard so task→coder/docs cannot plain-text write .docx/.pdf stubs. */
function specialistMiddleware() {
  return [createOfficeBinaryWriteGuardMiddleware()];
}

export function createSpecialistSubagents(): SubAgent[] {
  const middleware = specialistMiddleware();
  return [
    {
      name: "explorer",
      description:
        "Map the codebase, find files/symbols, and answer location questions. Read-only preferred. Returns a concise path/symbol report.",
      systemPrompt: EXPLORER_PROMPT,
      middleware,
    },
    {
      name: "coder",
      description:
        "Implement code changes, run builds/tests via PTY, and fix failures. Use for multi-file implementation work.",
      systemPrompt: CODER_PROMPT,
      middleware,
    },
    {
      name: "reviewer",
      description:
        "Review diffs for bugs, security issues, and missing tests. Prefer read-only inspection. Returns severity-ordered findings.",
      systemPrompt: REVIEWER_PROMPT,
      middleware,
    },
    {
      name: "tester",
      description:
        "Design/run verification: tests, edge cases, regressions. Returns pass/fail with file:line gaps.",
      systemPrompt: TESTER_PROMPT,
      middleware,
    },
    {
      name: "security",
      description:
        "Security review: auth, injection, secrets, unsafe shell/paths. Severity-ordered findings with remediations.",
      systemPrompt: SECURITY_PROMPT,
      middleware,
    },
    {
      name: "debugger",
      description:
        "Root-cause failures from logs/traces. Hypothesis → evidence → smallest fix + verify steps.",
      systemPrompt: DEBUGGER_PROMPT,
      middleware,
    },
    {
      name: "docs",
      description:
        "Write/update README, API notes, changelogs, runbooks. Minimal doc diffs; no drive-by refactors.",
      systemPrompt: DOCS_PROMPT,
      middleware,
    },
    {
      name: "architect",
      description:
        "Structure/tradeoffs before large changes. Mermaid + phased plan for the coder. Analysis-first.",
      systemPrompt: ARCHITECT_PROMPT,
      middleware,
    },
  ];
}
