/** Pure WhatsApp identity / allowlist helpers (safe for renderer + main). */

import type { WhatsAppAccessRole } from "./messaging-roles.js";

export type WhatsAppMessagingConfig = {
  enabled: boolean;
  /**
   * Full-access owners (role: user).
   * Migrated from legacy `allowedUsers` when present.
   */
  users: string[];
  /** Guardrailed guests (role: friend) — workspace help only, no PC folder access. */
  friends: string[];
  /** Keep replies short when answering via WhatsApp. */
  conciseReplies: boolean;
};

export type MessagingConfig = {
  version: 1;
  whatsapp: WhatsAppMessagingConfig;
};

export const DEFAULT_MESSAGING_CONFIG: MessagingConfig = {
  version: 1,
  whatsapp: {
    enabled: false,
    users: [],
    friends: [],
    conciseReplies: true,
  },
};

/** Digits-only phone (country code, no +). */
export function normalizePhoneDigits(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

/** Normalize user input or JID into comparable phone digits. */
export function normalizeWhatsAppIdentity(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const at = s.indexOf("@");
  const userPart = at >= 0 ? s.slice(0, at) : s;
  const beforeDevice = userPart.split(":")[0] || userPart;
  return normalizePhoneDigits(beforeDevice);
}

export function isWhatsAppIdentityAllowed(
  identity: string,
  allowedUsers: string[],
): boolean {
  if (!allowedUsers.length) return false;
  const target = normalizeWhatsAppIdentity(identity);
  if (!target || target.length < 8) return false;
  return allowedUsers.some((entry) => {
    const n = normalizeWhatsAppIdentity(entry);
    // Exact match only — avoid suffix collisions (e.g. "890" matching many numbers).
    return Boolean(n) && n.length >= 8 && n === target;
  });
}

/** Union of user + friend allowlists (empty = deny all). */
export function allMessagingAllowlist(
  config: Pick<WhatsAppMessagingConfig, "users" | "friends">,
): string[] {
  return [...config.users, ...config.friends];
}

/**
 * Resolve role for an inbound identity.
 * If listed in both, prefer **user** (full access).
 */
export function resolveWhatsAppAccessRole(
  identity: string,
  config: Pick<WhatsAppMessagingConfig, "users" | "friends">,
): WhatsAppAccessRole | null {
  if (isWhatsAppIdentityAllowed(identity, config.users)) return "user";
  if (isWhatsAppIdentityAllowed(identity, config.friends)) return "friend";
  return null;
}

export function parseAllowedUsersCsv(csv: string): string[] {
  return String(csv || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAllowedUsersCsv(users: string[]): string {
  return users.join(", ");
}

export function threadIdForWhatsAppJid(jid: string): string {
  const phone = normalizeWhatsAppIdentity(jid) || "unknown";
  return `wa-${phone}`;
}

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).map((s) => s.trim()).filter(Boolean);
}

export function coerceMessagingConfig(raw: unknown): MessagingConfig {
  const base = structuredClone(DEFAULT_MESSAGING_CONFIG);
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const wa = (obj.whatsapp && typeof obj.whatsapp === "object"
    ? obj.whatsapp
    : {}) as Record<string, unknown>;

  const legacyAllowed = asStringList(wa.allowedUsers);
  const usersRaw = asStringList(wa.users);
  const friends = asStringList(wa.friends);
  // Migrate legacy allowedUsers → users when users not set.
  const users = usersRaw.length ? usersRaw : legacyAllowed;

  // Drop accidental duplicates: prefer user over friend.
  const userSet = new Set(users.map(normalizeWhatsAppIdentity).filter(Boolean));
  const friendsDeduped = friends.filter((f) => {
    const n = normalizeWhatsAppIdentity(f);
    return n && !userSet.has(n);
  });

  return {
    version: 1,
    whatsapp: {
      enabled: Boolean(wa.enabled),
      users,
      friends: friendsDeduped,
      conciseReplies:
        wa.conciseReplies === undefined
          ? base.whatsapp.conciseReplies
          : Boolean(wa.conciseReplies),
    },
  };
}
