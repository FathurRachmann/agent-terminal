/**
 * Workspace group-chat supervisor — judges whether the team turn is complete.
 */
import type { WorkspaceBot } from "./bots.js";

export type SupervisorStatus = "done" | "needs_more" | "blocked";

export type SupervisorVerdict = {
  status: SupervisorStatus;
  summary: string;
  gaps: string[];
  nextActions: string[];
  raw: string;
  parsed: boolean;
};

export type WorkerReplySnippet = {
  botId: string;
  botName: string;
  content: string;
};

/** Prefer leadership / delivery roles as default supervisor. */
const SUPERVISOR_ID_PRIORITY: Record<string, number> = {
  cto: 0,
  "senior-developer": 1,
  "software-architect": 2,
  "engineering-manager": 3,
  "tech-lead": 4,
  "project-manager": 5,
  "product-manager": 6,
  pm: 6,
  "system-analyst": 7,
  sa: 7,
};

const SUPERVISOR_ROLE_RE =
  /\b(cto|chief technology|tech\s*lead|engineering manager|software architect|senior (dev|engineer)|project manager|product manager|program manager|scrum master|delivery)\b/i;

export function pickSupervisorBot(
  bots: WorkspaceBot[],
  preferredId?: string | null,
): WorkspaceBot | null {
  const active = bots.filter((b) => b.active !== false);
  if (active.length === 0) return null;

  if (preferredId) {
    const hit = active.find((b) => b.id === preferredId);
    if (hit) return hit;
  }

  const scored = active.map((bot) => {
    const idRank = SUPERVISOR_ID_PRIORITY[bot.id];
    if (idRank !== undefined) return { bot, score: idRank };
    const hay = `${bot.id} ${bot.name} ${bot.role ?? ""} ${bot.description}`;
    if (SUPERVISOR_ROLE_RE.test(hay)) return { bot, score: 20 };
    return { bot, score: 100 };
  });

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.bot.id.localeCompare(b.bot.id);
  });
  return scored[0]?.bot ?? null;
}

/** Drop supervisor from worker queue so they review instead of answering twice. */
export function excludeSupervisorFromQueue(
  botIds: string[],
  supervisorId: string | null | undefined,
): string[] {
  if (!supervisorId) return botIds;
  return botIds.filter((id) => id !== supervisorId);
}

export function buildSupervisorInstruction(bot: WorkspaceBot): string {
  return [
    `You are "${bot.name}"${bot.role ? ` (${bot.role})` : ""} acting as the WORKSPACE SUPERVISOR.`,
    bot.description ? `Background: ${bot.description}` : "",
    "Your ONLY job this turn: decide if the team's replies fully satisfy the user's request.",
    "Do NOT redo the teammates' work. Do NOT call tools unless a concrete claim needs a 1-line fact check.",
    "Be skeptical of vague agreement, empty plans, or claims without evidence.",
    "Reply in Indonesian for summary/gaps/nextActions text.",
    "Output MUST be a single JSON object (no markdown fences) with this shape:",
    '{"status":"done"|"needs_more"|"blocked","summary":"...","gaps":["..."],"nextActions":["..."]}',
    "- done: user request is adequately answered or deliverable exists",
    "- needs_more: missing work / evidence / unresolved questions — list gaps + nextActions",
    "- blocked: cannot proceed without user input or external dependency",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSupervisorUserPrompt(options: {
  userPrompt: string;
  workerReplies: WorkerReplySnippet[];
  round: number;
  maxRounds: number;
}): string {
  const { userPrompt, workerReplies, round, maxRounds } = options;
  const body =
    workerReplies.length === 0
      ? "(no teammate replies)"
      : workerReplies
          .map((r, i) => {
            const clipped = r.content.trim().slice(0, 2500);
            return `### ${i + 1}. ${r.botName} (${r.botId})\n${clipped || "(empty)"}`;
          })
          .join("\n\n");

  return [
    "[SUPERVISOR REVIEW]",
    `Round ${round}/${maxRounds}.`,
    "",
    "## User request",
    userPrompt.trim() || "(empty)",
    "",
    "## Teammate replies",
    body,
    "",
    "Decide status now. JSON only.",
  ].join("\n");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeStatus(raw: unknown): SupervisorStatus {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "done" || s === "complete" || s === "completed" || s === "ok") {
    return "done";
  }
  if (s === "blocked" || s === "block" || s === "stuck") return "blocked";
  return "needs_more";
}

/** Extract first JSON object from model text (tolerates fences / prose). */
export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through */
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseSupervisorVerdict(raw: string): SupervisorVerdict {
  const text = String(raw || "").trim();
  const parsed = extractJsonObject(text);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const summary =
      String(obj.summary ?? obj.reason ?? obj.message ?? "").trim() ||
      "Supervisor meninjau balasan tim.";
    return {
      status: normalizeStatus(obj.status ?? obj.verdict ?? obj.state),
      summary: summary.slice(0, 800),
      gaps: asStringArray(obj.gaps ?? obj.missing),
      nextActions: asStringArray(obj.nextActions ?? obj.next_actions ?? obj.actions),
      raw: text,
      parsed: true,
    };
  }

  // Heuristic fallback when the model ignored JSON.
  const lower = text.toLowerCase();
  let status: SupervisorStatus = "needs_more";
  if (
    /\b(blocked|terblokir|butuh input user|cannot proceed)\b/i.test(text)
  ) {
    status = "blocked";
  } else if (
    /\b(done|selesai|complete|sudah cukup|sudah selesai|adequately)\b/i.test(
      lower,
    ) &&
    !/\b(belum|not yet|needs? more|kurang|masih perlu)\b/i.test(lower)
  ) {
    status = "done";
  }

  return {
    status,
    summary: text.slice(0, 800) || "Supervisor tidak mengembalikan JSON valid.",
    gaps: [],
    nextActions: [],
    raw: text,
    parsed: false,
  };
}

/** Force completion when discussion budget is exhausted. */
export function applyRoundBudget(
  verdict: SupervisorVerdict,
  round: number,
  maxRounds: number,
): SupervisorVerdict {
  if (round < maxRounds) return verdict;
  if (verdict.status === "done") return verdict;
  return {
    ...verdict,
    status: "done",
    summary: `${verdict.summary} (batas putaran ${maxRounds} tercapai — ditutup).`.trim(),
    nextActions: [],
  };
}

export function formatSupervisorSystemNote(
  verdict: SupervisorVerdict,
  botName: string,
): string {
  const label =
    verdict.status === "done"
      ? "SELESAI"
      : verdict.status === "blocked"
        ? "TERBLOKIR"
        : "PERLU LANJUT";
  const lines = [
    `Supervisor (${botName}): ${label}`,
    verdict.summary,
  ];
  if (verdict.gaps.length) {
    lines.push(`Gaps: ${verdict.gaps.join("; ")}`);
  }
  if (verdict.nextActions.length && verdict.status !== "done") {
    lines.push(`Next: ${verdict.nextActions.join("; ")}`);
  }
  return lines.filter(Boolean).join("\n");
}
