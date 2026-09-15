import fs from "node:fs";
import path from "node:path";
import {
  coerceMessagingConfig,
  DEFAULT_MESSAGING_CONFIG,
  type MessagingConfig,
} from "./messaging-shared.js";

export type { MessagingConfig, WhatsAppMessagingConfig } from "./messaging-shared.js";
export {
  formatAllowedUsersCsv,
  allMessagingAllowlist,
  isWhatsAppIdentityAllowed,
  normalizePhoneDigits,
  normalizeWhatsAppIdentity,
  parseAllowedUsersCsv,
  resolveWhatsAppAccessRole,
  threadIdForWhatsAppJid,
} from "./messaging-shared.js";

export function messagingConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "messaging.json");
}

export function whatsappAuthDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "whatsapp-auth");
}

export function defaultMessagingConfig(): MessagingConfig {
  return structuredClone(DEFAULT_MESSAGING_CONFIG);
}

export function loadMessagingConfig(workspaceRoot: string): MessagingConfig {
  const file = messagingConfigPath(workspaceRoot);
  try {
    if (!fs.existsSync(file)) return defaultMessagingConfig();
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return coerceMessagingConfig(raw);
  } catch {
    return defaultMessagingConfig();
  }
}

export function saveMessagingConfig(
  workspaceRoot: string,
  config: MessagingConfig,
): MessagingConfig {
  const next = coerceMessagingConfig(config);
  const dir = path.join(workspaceRoot, ".agent");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    messagingConfigPath(workspaceRoot),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export function hasWhatsAppAuth(workspaceRoot: string): boolean {
  const dir = whatsappAuthDir(workspaceRoot);
  try {
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}
