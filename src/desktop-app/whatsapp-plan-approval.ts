/**
 * WhatsApp plan-approval helpers: send plan text, parse setuju/tolak replies.
 */
import fs from "node:fs";
import path from "node:path";
import {
  extractTodosFromPlanInterrupt,
  formatPlanApprovalMarkdown,
  parseTaskBoardJson,
} from "./renderer/plan-approval.js";

/** Renderer marker: warning message body is plan markdown for chat (turn still waiting). */
export const WA_PLAN_CHAT_PREFIX = "__wa_plan__\n";

export type WaPlanDecision = "approve" | "reject" | null;

/** Match Indonesian / English approval replies over WhatsApp. */
export function parseWhatsAppPlanReply(raw: string): WaPlanDecision {
  const text = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[*"'_]+|[*"'_]+$/g, "");
  if (!text) return null;

  // Exact / short tokens first
  const approveExact = new Set([
    "setuju",
    "approve",
    "approved",
    "ya",
    "y",
    "ok",
    "oke",
    "okay",
    "lanjut",
    "gas",
    "go",
    "yes",
    "/approve",
    "iya",
  ]);
  const rejectExact = new Set([
    "tolak",
    "reject",
    "rejected",
    "tidak",
    "ngga",
    "engga",
    "ga",
    "gak",
    "no",
    "n",
    "batal",
    "batalkan",
    "/reject",
  ]);
  if (approveExact.has(text)) return "approve";
  if (rejectExact.has(text)) return "reject";

  // Soft phrases (whole message still short)
  if (text.length <= 48) {
    if (
      /^(ok\s+)?(saya\s+)?setuju\b/.test(text) ||
      /^approve\b/.test(text) ||
      /^lanjut(kan)?(\s+saja)?$/.test(text)
    ) {
      return "approve";
    }
    if (
      /^(saya\s+)?tolak\b/.test(text) ||
      /^reject\b/.test(text) ||
      /^jangan\b/.test(text) ||
      /^cancel\b/.test(text)
    ) {
      return "reject";
    }
  }
  return null;
}

function loadBoardFromWorkspace(workspaceRoot: string): {
  goal: string;
  plan: string;
  skillsUsed: string[];
  todos: Array<{ id: string; content: string; status: string }>;
} | null {
  const file = path.join(workspaceRoot, ".agent", "task", "board.json");
  if (!fs.existsSync(file)) return null;
  try {
    return parseTaskBoardJson(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Plain-text plan summary suitable for WhatsApp (no heavy markdown). */
export function formatPlanForWhatsApp(input: {
  goal?: string;
  plan?: string;
  skillsUsed?: string[];
  todos?: Array<{ id?: string; content?: string; status?: string }>;
}): string {
  const goal = String(input.goal ?? "").trim();
  const plan = String(input.plan ?? "").trim();
  const skills = (input.skillsUsed ?? []).map(String).filter(Boolean);
  const todos = (input.todos ?? [])
    .map((t) => ({
      id: String(t.id ?? "").trim(),
      content: String(t.content ?? "").trim(),
    }))
    .filter((t) => t.id || t.content);

  const lines: string[] = [
    "📋 *Plan approval*",
    "",
  ];
  if (goal) {
    lines.push(`*Goal:* ${goal}`, "");
  }
  if (skills.length) {
    lines.push(`*Skills:* ${skills.join(", ")}`, "");
  }
  if (plan) {
    lines.push("*Plan:*", plan.slice(0, 2800), "");
  } else {
    lines.push("_(plan kosong — cek board di desktop)_", "");
  }
  if (todos.length) {
    lines.push("*Todos:*");
    for (const t of todos.slice(0, 20)) {
      lines.push(`• ${t.id ? `${t.id}: ` : ""}${t.content}`);
    }
    if (todos.length > 20) lines.push(`• …+${todos.length - 20} lagi`);
    lines.push("");
  }
  lines.push(
    "Balas *setuju* untuk eksekusi, atau *tolak* untuk membatalkan.",
  );
  const body = lines.join("\n").trim();
  return body.length > 3500 ? `${body.slice(0, 3490)}\n…(truncated)` : body;
}

export function buildWhatsAppPlanApprovalMessage(
  workspaceRoot: string,
  interrupt: unknown,
): { waText: string; chatMarkdown: string } {
  const board = loadBoardFromWorkspace(workspaceRoot);
  const interruptTodos = extractTodosFromPlanInterrupt(interrupt);
  const todos = interruptTodos.length
    ? interruptTodos
    : board?.todos ?? [];
  const goal = board?.goal ?? "";
  const plan = board?.plan ?? "";
  const skillsUsed = board?.skillsUsed ?? [];

  const waText = formatPlanForWhatsApp({
    goal,
    plan,
    skillsUsed,
    todos,
  });
  const chatMarkdown = formatPlanApprovalMarkdown({
    goal,
    plan,
    skillsUsed,
    todos,
  });
  return { waText, chatMarkdown };
}
