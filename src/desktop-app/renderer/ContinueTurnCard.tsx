/** Shown when a turn failed due to model unavailability / after self-heal. */
import React from "react";

export type ContinueOffer = {
  reason: "model_unavailable" | "self_heal";
  prompt: string;
  suggestedModel?: string | null;
  notice?: string;
};

type Props = {
  offer: ContinueOffer;
  busy?: boolean;
  currentModel?: string;
  onContinue: (opts: { switchToSuggested: boolean }) => void;
  onDismiss: () => void;
};

export function ContinueTurnCard({
  offer,
  busy,
  currentModel,
  onContinue,
  onDismiss,
}: Props) {
  const suggested = offer.suggestedModel?.trim() || null;
  const title =
    offer.reason === "self_heal"
      ? "Self-heal selesai — lanjutkan task?"
      : "Model gagal — lanjutkan tanpa reset chat?";
  const detail =
    offer.reason === "self_heal"
      ? "Riwayat & hasil tool sebelumnya tetap. Continue mengirim ulang task asli di thread yang sama."
      : "Retry model sudah habis. Continue mempertahankan flow sebelumnya (history + tools) dan menjalankan ulang task di thread yang sama.";

  return (
    <div
      className="rounded-[12px] border border-amber-500/35 bg-amber-500/10 px-3.5 py-3"
      role="status"
    >
      <div className="text-[13px] font-semibold text-fg">{title}</div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">{detail}</p>
      {offer.notice ? (
        <p className="mt-2 line-clamp-3 font-mono text-[10.5px] text-muted/90">
          {offer.notice}
        </p>
      ) : null}
      {suggested ? (
        <p className="mt-2 text-[11px] text-fg">
          Saran model:{" "}
          <span className="font-mono text-amber-200">{suggested}</span>
          {currentModel ? (
            <span className="text-muted">
              {" "}
              (sekarang: <span className="font-mono">{currentModel}</span>)
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggested ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
            onClick={() => onContinue({ switchToSuggested: true })}
          >
            Continue dengan {suggested}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-border-strong bg-surface-1 px-3 py-1.5 text-[12px] font-medium text-fg disabled:opacity-50"
          onClick={() => onContinue({ switchToSuggested: false })}
        >
          Continue
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md px-2 py-1.5 text-[11px] text-muted hover:text-fg disabled:opacity-50"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
