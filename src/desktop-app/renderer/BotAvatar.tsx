import React from "react";

/** Stable circular avatar for workspace bots (initials + color from id). */

const AVATAR_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
  "#f97316",
];

export function botAvatarColor(idOrName: string): string {
  let hash = 0;
  const s = idOrName || "?";
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function botAvatarInitials(name: string, id?: string): string {
  const raw = (name || id || "?").trim();
  const parts = raw.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
}

export function BotAvatar({
  name,
  id,
  size = 28,
  className = "",
}: {
  name: string;
  id?: string;
  size?: number;
  className?: string;
}) {
  const label = botAvatarInitials(name, id);
  const bg = botAvatarColor(id || name);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        background: bg,
      }}
      title={name}
      aria-hidden
    >
      {label}
    </span>
  );
}
