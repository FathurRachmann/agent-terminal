import React, { useEffect, useRef, useState } from "react";

type Props = {
  onCopy: () => boolean | void | Promise<boolean | void>;
  title?: string;
  disabled?: boolean;
  className?: string;
};

/** Compact header control: Copy → Copied feedback. */
export function CopyButton({
  onCopy,
  title = "Copy",
  disabled,
  className = "",
}: Props) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      title={copied ? "Copied" : title}
      aria-label={copied ? "Copied to clipboard" : title}
      disabled={disabled || copied}
      onClick={(e) => {
        e.stopPropagation();
        void (async () => {
          const ok = await onCopy();
          if (ok === false) return;
          setCopied(true);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => setCopied(false), 1500);
        })();
      }}
      className={`rounded border px-2 py-0.5 text-[9.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        copied
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-transparent text-muted hover:border-border hover:bg-surface-2 hover:text-fg"
      } ${className}`}
    >
      {copied ? "Copied" : "Copy"}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
