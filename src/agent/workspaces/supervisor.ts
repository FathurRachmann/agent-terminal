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

/** Max automatic worker rounds kicked off after a needs_more verdict (per user turn). */
export const MAX_SUPERVISOR_AUTO_CONTINUE = 3;

export function buildSupervisorInstruction(bot: WorkspaceBot): string {
  return [
    `You are "${bot.name}"${bot.role ? ` (${bot.role})` : ""} acting as the WORKSPACE SUPERVISOR.`,
    bot.description ? `Background: ${bot.description}` : "",
    "Your ONLY job this turn: decide if the team's replies fully satisfy the user's request.",
    "You are a judge — NOT the implementer. Do NOT explore the repo, dump directory trees, or call tools.",
    "Do NOT redo the teammates' work. Do NOT write code or long plans.",
    "Be skeptical of vague agreement, empty plans, ls dumps, audits that only list 'next', or claims without evidence.",
    "If a teammate only listed what should be done next (without doing it), status MUST be needs_more.",
    "When status is needs_more: nextActions must be EXECUTABLE work for named bots — edit/write files, fix contracts, run checks.",
    'GOOD nextActions: "backend-architect: edit backend/src/server.js to use {title,completed} + PUT + todos.json persistence".',
    'BAD nextActions: "tampilkan kode", "show full file", "list structure", "audit again" — never ask to only display code.',
    "The runtime WILL automatically re-run workers with your nextActions — they must DO the work, not re-audit.",
    "Reply in Indonesian for summary/gaps/nextActions text.",
    "Output MUST be a single JSON object (no markdown fences) with this shape:",
    '{"status":"done"|"needs_more"|"blocked","summary":"...","gaps":["..."],"nextActions":["..."]}',
    "- done: user request is adequately answered AND deliverables exist (files written / bugs fixed with evidence)",
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
    /\b(perlu\s*lanjut|needs?_?more|masih kurang|belum selesai|not yet)\b/i.test(
      lower,
    )
  ) {
    status = "needs_more";
  } else if (
    /\b(done|selesai|complete|sudah cukup|sudah selesai|adequately)\b/i.test(
      lower,
    ) &&
    !/\b(belum|not yet|needs? more|kurang|masih perlu|perlu lanjut)\b/i.test(
      lower,
    )
  ) {
    status = "done";
  }

  // Pull crude next-action lines from prose ("Next: …" / "Lanjut: …").
  const nextActions: string[] = [];
  const nextMatch = text.match(
    /(?:^|\n)\s*(?:next(?:\s*actions?)?|lanjut|tindakan)\s*[:：]\s*(.+)/i,
  );
  if (nextMatch?.[1]) {
    for (const part of nextMatch[1].split(/[;•|]|\n/)) {
      const t = part.trim();
      if (t) nextActions.push(t.slice(0, 200));
    }
  }

  return {
    status,
    summary: text.slice(0, 800) || "Supervisor tidak mengembalikan JSON valid.",
    gaps: [],
    nextActions: nextActions.slice(0, 8),
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

/** Follow-up user prompt when supervisor says needs_more (auto-continue). */
export function buildSupervisorContinuePrompt(options: {
  originalPrompt: string;
  verdict: SupervisorVerdict;
  round: number;
  maxRounds: number;
}): string {
  const { originalPrompt, verdict, round, maxRounds } = options;
  const gaps =
    verdict.gaps.length > 0
      ? verdict.gaps.map((g, i) => `${i + 1}. ${g}`).join("\n")
      : "(see summary)";
  const actions =
    verdict.nextActions.length > 0
      ? verdict.nextActions.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "Tutup gaps di atas dengan write_file/edit_file + bukti tool, lalu jawab singkat.";

  return [
    "[AUTO-CONTINUE — EXECUTE NOW, DO NOT ONLY AUDIT]",
    `Round ${round + 1}/${maxRounds}. Original request still open — turn must NOT end until gaps are closed.`,
    "",
    "## Original user request",
    originalPrompt.trim(),
    "",
    "## Supervisor summary",
    verdict.summary,
    "",
    "## Gaps to close",
    gaps,
    "",
    "## Required next actions — DO THESE WITH TOOLS",
    actions,
    "",
    "RULES (mandatory):",
    "1. Call write_file / edit_file / execute NOW to fix the gaps. Reading alone is not enough.",
    "2. FORBIDDEN: ending with another 'Next:' / 'yang perlu dibereskan' list without having edited files.",
    "3. FORBIDDEN: dumping directory trees as your whole answer.",
    "4. FORBIDDEN: re-auditing without applying fixes.",
    "5. After edits, briefly confirm what changed (paths + 1-line each). Stay in your role.",
  ].join("\n");
}

/**
 * True when a worker reply only defers work ("here's what's next") instead of doing it.
 * Used to keep auto-continue going / strengthen the nudge.
 */
export function looksLikeDeferredNextActions(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  const defers =
    /\b(yang perlu (dibereskan|diperbaiki|dilakukan)|next steps?|next actions?|tindakan selanjutnya|perlu dibereskan berikutnya|yang perlu diperbaiki berikutnya)\b/i.test(
      lower,
    ) ||
    /(?:^|\n)\s*(?:next|lanjut|todo)\s*[:：]/i.test(t);
  if (!defers) return false;
  // If they clearly report having written/edited files, don't treat as deferred.
  const didWork =
    /\b(write_file|edit_file|sudah (saya )?(ubah|perbaiki|tulis|update)|updated?|patched|fixed)\b/i.test(
      lower,
    );
  return !didWork;
}

/**
 * Pick workers for an auto-continue round.
 * Prefer bots named in nextActions/gaps; if the supervisor is named as
 * implementer (or no other workers match), include them so they can fix.
 */
export function resolveContinueWorkerIds(options: {
  previousWorkerIds: string[];
  bots: WorkspaceBot[];
  verdict: SupervisorVerdict;
  supervisorId: string | null | undefined;
}): string[] {
  const { previousWorkerIds, bots, verdict, supervisorId } = options;
  const active = bots.filter((b) => b.active !== false);
  const byId = new Map(active.map((b) => [b.id, b]));
  const haystacks = [
    ...verdict.nextActions,
    ...verdict.gaps,
    verdict.summary,
  ].join("\n");
  const lower = haystacks.toLowerCase();

  const named: string[] = [];
  for (const bot of active) {
    const idHit = lower.includes(bot.id.toLowerCase());
    const nameHit =
      bot.name.trim().length >= 3 &&
      lower.includes(bot.name.toLowerCase());
    const roleHit =
      Boolean(bot.role) &&
      String(bot.role).trim().length >= 4 &&
      lower.includes(String(bot.role).toLowerCase());
    if (idHit || nameHit || roleHit) named.push(bot.id);
  }

  let ids = named.length > 0 ? named : [...previousWorkerIds];
  ids = ids.filter((id) => byId.has(id));

  // Keep prior workers if naming failed to resolve anything usable.
  if (ids.length === 0) {
    ids = previousWorkerIds.filter((id) => byId.has(id));
  }

  const supervisorNamed =
    Boolean(supervisorId) && named.includes(supervisorId!);
  const onlySupervisorLeft =
    Boolean(supervisorId) &&
    ids.length === 0 &&
    byId.has(supervisorId!);

  // Default: still exclude supervisor (they judge). Re-include when they
  // were explicitly tasked, or when they are the only available implementer.
  if (supervisorId && !supervisorNamed && !onlySupervisorLeft) {
    ids = ids.filter((id) => id !== supervisorId);
  } else if (supervisorId && (supervisorNamed || onlySupervisorLeft)) {
    if (!ids.includes(supervisorId)) ids.push(supervisorId);
  }

  if (ids.length === 0 && previousWorkerIds.length > 0) {
    ids = previousWorkerIds.filter(
      (id) => byId.has(id) && id !== supervisorId,
    );
  }
  if (ids.length === 0 && supervisorId && byId.has(supervisorId)) {
    ids = [supervisorId];
  }

  // Stable unique
  return [...new Set(ids)];
}

/**
 * Whether another worker round should run after a needs_more verdict.
 * `autoContinueDepth` counts how many auto-continues already ran this user turn
 * (0 = first review). Caps at MAX_SUPERVISOR_AUTO_CONTINUE and chat maxRounds.
 */
export function shouldAutoContinue(
  verdict: SupervisorVerdict | null,
  round: number,
  maxRounds: number,
  autoContinueDepth = 0,
): boolean {
  if (!verdict) return false;
  if (verdict.status !== "needs_more") return false;
  if (round >= maxRounds) return false;
  if (autoContinueDepth >= MAX_SUPERVISOR_AUTO_CONTINUE) return false;
  // Actionable: explicit next steps, gaps, or parseable prose Next: lines.
  // Empty needs_more still continues once with the default action prompt.
  return true;
}
