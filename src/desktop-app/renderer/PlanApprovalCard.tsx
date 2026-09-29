import { MarkdownBody } from "./MarkdownBody.js";

export type PlanStep = {
  index: number;
  text: string;
  status: "done" | "active" | "pending";
};

/** Parse checklist / numbered steps from plan markdown. */
export function parsePlanSteps(markdown: string): PlanStep[] {
  const lines = String(markdown || "").split(/\r?\n/);
  const steps: PlanStep[] = [];
  for (const line of lines) {
    const check = line.match(/^\s*[-*]\s*\[([ xX])\]\s+(.+)$/);
    if (check) {
      const done = check[1]!.toLowerCase() === "x";
      const text = check[2]!.trim();
      const statusHint = /\(completed|done|finished\)/i.test(text);
      steps.push({
        index: steps.length + 1,
        text: text.replace(/\s*\((completed|done|finished|pending|in[_ ]progress)\)\s*$/i, ""),
        status: done || statusHint ? "done" : "pending",
      });
      continue;
    }
    const num = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (num) {
      const text = num[2]!.trim();
      const struck = /^~~.+~~$/.test(text) || /<del>/i.test(text);
      steps.push({
        index: Number(num[1]) || steps.length + 1,
        text: text.replace(/^~~|~~$/g, ""),
        status: struck ? "done" : "pending",
      });
    }
  }
  if (!steps.length) return [];
  // First pending becomes active
  let activated = false;
  return steps.map((s) => {
    if (s.status === "done") return s;
    if (!activated) {
      activated = true;
      return { ...s, status: "active" };
    }
    return { ...s, status: "pending" };
  });
}

/** Subtitle like "Step 4 of 6: …" from goal / first heading. */
export function planSubtitle(markdown: string, steps: PlanStep[]): string {
  const goal =
    markdown.match(/\*\*Goal:\*\*\s*(.+)/i)?.[1]?.trim() ||
    markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    "";
  if (steps.length) {
    const active = steps.find((s) => s.status === "active");
    const n = active?.index ?? steps.filter((s) => s.status === "done").length + 1;
    const label = goal || active?.text || "Implementation plan";
    return `Step ${n} of ${steps.length}: ${label}`;
  }
  return goal || "Review the plan, then approve to continue with todos & coding.";
}

type Props = {
  markdown: string;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenCanvas?: () => void;
};

/** In-chat plan gate — Figma interrupt card. */
export function PlanApprovalCard({
  markdown,
  busy,
  onApprove,
  onReject,
  onOpenCanvas,
}: Props) {
  const steps = parsePlanSteps(markdown);
  const subtitle = planSubtitle(markdown, steps);

  return (
    <div className="chat-plan">
      <div className="chat-plan-top">
        <div className="chat-plan-title-row">
          <span className="chat-plan-icon" aria-hidden>
            <span className="material-symbols-outlined">fact_check</span>
          </span>
          <div>
            <h4 className="chat-plan-title">Plan Approval Required</h4>
            <p className="chat-plan-sub">{subtitle}</p>
          </div>
        </div>
        <span className="chat-plan-halt">HALTED FOR SIGN-OFF</span>
      </div>
      <div className="chat-plan-body">
        {steps.length > 0 ? (
          <ul className="chat-plan-steps">
            {steps.map((step) => (
              <li
                key={step.index}
                className={`chat-plan-step is-${step.status}`}
              >
                <span className="chat-plan-check" aria-hidden>
                  {step.status === "done" ? (
                    <span className="material-symbols-outlined">check_box</span>
                  ) : (
                    <span className="material-symbols-outlined">
                      check_box_outline_blank
                    </span>
                  )}
                </span>
                <span className="chat-plan-step-text">
                  {step.index}. {step.text}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <MarkdownBody text={markdown || "_Plan saved. Approve to continue._"} />
        )}
      </div>
      <div className="chat-plan-actions">
        {onOpenCanvas ? (
          <button
            type="button"
            disabled={busy}
            onClick={onOpenCanvas}
            className="chat-btn-ghost"
          >
            Open in Canvas
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onReject}
          className="chat-btn-ghost"
        >
          Deny / Edit Plan
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="chat-btn-primary"
        >
          <span className="material-symbols-outlined text-[14px]">
            play_arrow
          </span>
          {busy ? "Working…" : "Approve & Execute (⌘↵)"}
        </button>
      </div>
    </div>
  );
}
