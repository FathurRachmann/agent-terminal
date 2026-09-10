import type { SubAgent } from "deepagents";
import {
  CODER_PROMPT,
  EXPLORER_PROMPT,
  REVIEWER_PROMPT,
} from "../prompts/system.js";

export function createSpecialistSubagents(): SubAgent[] {
  return [
    {
      name: "explorer",
      description:
        "Map the codebase, find files/symbols, and answer location questions. Read-only preferred. Returns a concise path/symbol report.",
      systemPrompt: EXPLORER_PROMPT,
    },
    {
      name: "coder",
      description:
        "Implement code changes, run builds/tests via PTY, and fix failures. Use for multi-file implementation work.",
      systemPrompt: CODER_PROMPT,
    },
    {
      name: "reviewer",
      description:
        "Review diffs for bugs, security issues, and missing tests. Prefer read-only inspection. Returns severity-ordered findings.",
      systemPrompt: REVIEWER_PROMPT,
    },
  ];
}
