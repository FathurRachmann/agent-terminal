/** Shared helpers for Deep Agents / LangGraph interrupt payloads. */

export function extractInterruptActionNames(payload: unknown): string[] {
  const names: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.name === "string") names.push(rec.name);
    if (Array.isArray(rec.actionRequests)) visit(rec.actionRequests);
    if (rec.value != null) visit(rec.value);
    if (rec.actionRequest != null) visit(rec.actionRequest);
    if (Array.isArray(rec.__interrupt__)) visit(rec.__interrupt__);
  };
  visit(payload);
  return [...new Set(names)];
}

export function isPlanApprovalInterrupt(payload: unknown): boolean {
  return extractInterruptActionNames(payload).includes("task_todos");
}
