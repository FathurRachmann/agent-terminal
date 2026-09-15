export type SelfHealPromptInput = {
  recentErrors: string;
  userNote?: string;
  maxIterations?: number;
};

/**
 * Repair prompt mirroring the Self-Healing & Self-Repair diagram:
 * pause main turn → diagnose → edit → verify → loop or resume.
 */
export function buildSelfHealPrompt(input: SelfHealPromptInput): string {
  const max = input.maxIterations ?? 3;
  const note = input.userNote?.trim();
  return [
    "SELF-HEAL MODE — you are the Backup / Self-Repair Agent (Terminal 2).",
    "The main agent (Terminal 1) hit a process/code error. Follow this protocol:",
    "",
    "1. Treat Terminal 1 as paused after the failure — do not continue the user's original task until repair is verified.",
    "2. Optionally spawn a log monitor via process_manage (Terminal 3) if live logs help diagnosis.",
    "3. Diagnose root cause from the errors below (missing deps, unsafe property access, tool failures, bad assumptions).",
    "4. Edit the agent codebase with minimal diffs under src/ (and package scripts if needed). Never modify .env secrets or credentials.",
    "5. Verify with: npm run typecheck && npm run test:unit (or a narrower targeted test when clearly sufficient).",
    `6. If verification fails, iterate the repair loop (max ${max} cycles). If it passes, summarize what changed and how to resume.`,
    "7. Never claim success without running verification commands.",
    "",
    "Recent errors:",
    input.recentErrors || "(none captured)",
    note ? `\nOperator note: ${note}` : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export const SELF_HEAL_BOT_INSTRUCTION = [
  "You are operating in SELF-HEAL / self-repair mode.",
  "Prioritize diagnosing and fixing agent process/code failures.",
  "Use execute for verification. Prefer targeted unit tests when possible.",
  "Keep changes minimal and reversible in intent.",
].join(" ");
