/**
 * Model Hub Live — same Usage UI as Settings → Model Hub → Usage
 * (stats, Agent→providers network, recent requests, tokens chart).
 */
import React from "react";
import { ModelHubSettingsPanel } from "./ModelHubSettingsPanel.js";

type Props = { onClose?: () => void };

export function ModelHubLivePanel({ onClose }: Props) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-0 text-fg">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <h1 className="text-[14px] font-semibold tracking-wide text-fg">
            Model Hub · Live
          </h1>
          <p className="mt-0.5 text-[11px] text-muted">
            Sama dengan Settings → Usage — network, recent requests, tokens
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-fg-dim hover:text-fg"
          >
            Close
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5">
        <div className="mx-auto max-w-[1100px]">
          <ModelHubSettingsPanel page="usage" />
        </div>
      </div>
    </div>
  );
}
