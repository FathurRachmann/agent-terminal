import { MarkdownBody } from "./MarkdownBody.js";

type Props = {
  markdown: string;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenCanvas?: () => void;
};

/** In-chat plan gate so Approve is visible without hunting the Canvas rail. */
export function PlanApprovalCard({
  markdown,
  busy,
  onApprove,
  onReject,
  onOpenCanvas,
}: Props) {
  return (
    <div className="min-w-0 w-full max-w-[90%] self-start">
      <div className="mb-1 text-[9.5px] text-muted">Plan approval</div>
      <div className="min-w-0 overflow-hidden rounded-2xl rounded-bl-md border border-accent/45 bg-surface-3">
        <div className="border-b border-border/80 bg-surface-2 px-3.5 py-2 text-[11px] font-medium text-fg">
          Review the plan, then approve to continue with todos &amp; coding.
        </div>
        <div className="max-h-[42vh] min-w-0 overflow-y-auto px-3.5 py-3">
          <MarkdownBody text={markdown || "_Plan saved. Approve to continue._"} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-2 px-3 py-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-surface-0 disabled:opacity-50"
          >
            {busy ? "Working…" : "Approve plan"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="rounded-md border border-danger/40 bg-[#2a1518] px-3 py-1.5 text-[11px] text-danger disabled:opacity-50"
          >
            Reject
          </button>
          {onOpenCanvas ? (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenCanvas}
              className="ml-auto rounded-md border border-border px-2.5 py-1.5 text-[10px] text-muted hover:text-fg disabled:opacity-50"
            >
              Open in Canvas
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
