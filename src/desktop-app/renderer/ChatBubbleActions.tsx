import React from "react";

export type BubbleFeedback = "up" | "down" | null;

type ActionBtnProps = {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function ActionBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: ActionBtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent/50 bg-accent/15 text-accent-soft"
          : "border-transparent text-muted hover:border-border hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

type AssistantActionsProps = {
  disabled?: boolean;
  feedback: BubbleFeedback;
  copied?: boolean;
  onCopy: () => void;
  onLike: () => void;
  onDislike: () => void;
  onRetry: () => void;
};

export function AssistantBubbleActions({
  disabled,
  feedback,
  copied,
  onCopy,
  onLike,
  onDislike,
  onRetry,
}: AssistantActionsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-0.5 opacity-70 transition group-hover:opacity-100">
      <ActionBtn
        label={copied ? "Copied" : "Copy"}
        title="Copy response"
        disabled={disabled}
        onClick={onCopy}
      />
      <ActionBtn
        label="Like"
        title="Good response"
        active={feedback === "up"}
        disabled={disabled}
        onClick={onLike}
      />
      <ActionBtn
        label="Dislike"
        title="Bad response"
        active={feedback === "down"}
        disabled={disabled}
        onClick={onDislike}
      />
      <ActionBtn
        label="Retry"
        title="Regenerate from previous prompt"
        disabled={disabled}
        onClick={onRetry}
      />
    </div>
  );
}

type UserActionsProps = {
  disabled?: boolean;
  editing?: boolean;
  onEdit: () => void;
  onRetry: () => void;
  onCancelEdit?: () => void;
};

export function UserBubbleActions({
  disabled,
  editing,
  onEdit,
  onRetry,
  onCancelEdit,
}: UserActionsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-end gap-0.5 opacity-70 transition group-hover:opacity-100">
      {editing ? (
        <ActionBtn
          label="Cancel"
          title="Cancel edit"
          disabled={disabled}
          onClick={() => onCancelEdit?.()}
        />
      ) : (
        <>
          <ActionBtn
            label="Edit"
            title="Edit and resend"
            disabled={disabled}
            onClick={onEdit}
          />
          <ActionBtn
            label="Retry"
            title="Resend this message"
            disabled={disabled}
            onClick={onRetry}
          />
        </>
      )}
    </div>
  );
}
