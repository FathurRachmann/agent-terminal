import { checkCommand, checkCommandWorkspaceAccess, ensureLsLongListing, type GuardrailDecision } from "./guardrails.js";

export function validateSandboxCommand(
  cmd: string,
  autoApproveDestructive = false
): { command: string; decision: GuardrailDecision } {
  const adjusted = ensureLsLongListing(cmd);
  const decision = checkCommand(adjusted);
  return { command: adjusted, decision };
}

export function validatePathAccess(
  cmd: string,
  allowedRoots: string[],
  artifactHome: string
): GuardrailDecision {
  return checkCommandWorkspaceAccess(cmd, allowedRoots, artifactHome);
}
