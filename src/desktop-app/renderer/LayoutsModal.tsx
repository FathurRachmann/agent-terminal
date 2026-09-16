import React from "react";
import {
  LAYOUT_TEMPLATES,
  type LayoutTemplateId,
} from "./layout-prefs.js";

type Props = {
  open: boolean;
  activeTemplate: LayoutTemplateId;
  onSelect: (id: LayoutTemplateId) => void;
  onReset: () => void;
  onDone: () => void;
};

function Wireframe({ id, active }: { id: LayoutTemplateId; active: boolean }) {
  const frame =
    "rounded border " +
    (active ? "border-accent bg-accent/10" : "border-border bg-surface-1");
  const pane = "rounded-[2px] bg-fg/25";
  return (
    <div className={`flex h-14 w-full items-stretch gap-0.5 p-1.5 ${frame}`}>
      {id === "default" ? (
        <>
          <div className={`${pane} w-[18%]`} />
          <div className={`${pane} flex-1`} />
          <div className="flex w-[28%] flex-col gap-0.5">
            <div className={`${pane} flex-1`} />
            <div className={`${pane} flex-1`} />
          </div>
        </>
      ) : null}
      {id === "focus" ? (
        <>
          <div className={`${pane} w-[18%]`} />
          <div className={`${pane} flex-1`} />
        </>
      ) : null}
      {id === "terminal-deck" ? (
        <>
          <div className={`${pane} w-[18%]`} />
          <div className="flex flex-1 flex-col gap-0.5">
            <div className={`${pane} flex-[2]`} />
            <div className={`${pane} flex-1`} />
          </div>
        </>
      ) : null}
      {id === "quad" ? (
        <>
          <div className={`${pane} w-[18%]`} />
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex flex-[2] gap-0.5">
              <div className={`${pane} flex-1`} />
              <div className={`${pane} flex-1`} />
            </div>
            <div className={`${pane} flex-1`} />
          </div>
        </>
      ) : null}
    </div>
  );
}

export function LayoutsModal({
  open,
  activeTemplate,
  onSelect,
  onReset,
  onDone,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[12vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="layouts-modal-title"
        className="w-full max-w-xl rounded-xl border border-border bg-surface-1 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2
              id="layouts-modal-title"
              className="text-[15px] font-semibold text-fg"
            >
              Layouts
            </h2>
            <p className="mt-1 flex items-center gap-2 text-[11px] text-muted">
              Pick a layout, or drag panes between zones.
              <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-dim">
                ⌘ ⇧ \
              </kbd>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg hover:border-accent/40"
            >
              Done
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
            Templates
          </div>
          <div className="grid grid-cols-4 gap-2">
            {LAYOUT_TEMPLATES.map((t) => {
              const active = activeTemplate === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t.id)}
                  className={`rounded-lg border p-2 text-left transition ${
                    active
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-accent/35 hover:bg-surface-2"
                  }`}
                >
                  <Wireframe id={t.id} active={active} />
                  <div
                    className={`mt-2 text-center text-[11px] font-medium ${
                      active ? "text-accent-soft" : "text-fg-dim"
                    }`}
                  >
                    {t.label}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 mb-2 text-[10px] font-semibold tracking-wider text-muted uppercase">
            Custom
          </div>
          <button
            type="button"
            disabled
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-[12px] text-muted opacity-50"
          >
            <span className="text-[16px] leading-none">+</span>
            New grid layout
          </button>
          <button
            type="button"
            disabled
            className="mt-3 flex w-full items-center gap-2 rounded-md px-1 py-2 text-[11px] text-muted opacity-50"
          >
            <span aria-hidden>💾</span>
            Save current arrangement as a template
          </button>
        </div>
      </div>
    </div>
  );
}
