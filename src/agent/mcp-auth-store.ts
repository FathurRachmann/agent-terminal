/**
 * Encrypted MCP credential store under profileHome/.agent/mcp-auth.enc
 * Holds OAuth tokens, bearer tokens, and env maps per server name.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export type McpAuthType = "oauth" | "bearer" | "env";

export type McpAuthRecord = {
  serverName: string;
  type: McpAuthType;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  bearerToken?: string;
  env?: Record<string, string>;
  updatedAt: string;
};

type StoreFile = {
  version: 1;
  servers: Record<string, McpAuthRecord>;
};

function deriveKey(): Buffer {
  const secret =
    process.env.AGENT_MCP_AUTH_KEY ||
    process.env.AGENT_VAULT_KEY ||
    `${os.hostname()}:${os.homedir()}:agent-mcp-auth-v1`;
  return crypto.pbkdf2Sync(secret, "agent-mcp-auth-salt", 100_000, 32, "sha256");
}

function encryptJson(payload: StoreFile, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  });
}

function decryptJson(raw: string, key: Buffer): StoreFile | null {
  try {
    const { iv, tag, data } = JSON.parse(raw) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, "hex")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as StoreFile;
    if (parsed?.version !== 1 || typeof parsed.servers !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mcpAuthStorePath(profileHome: string): string {
  return path.join(profileHome, ".agent", "mcp-auth.enc");
}

function loadStore(profileHome: string): StoreFile {
  const file = mcpAuthStorePath(profileHome);
  if (!fs.existsSync(file)) return { version: 1, servers: {} };
  const parsed = decryptJson(fs.readFileSync(file, "utf8"), deriveKey());
  return parsed ?? { version: 1, servers: {} };
}

function saveStore(profileHome: string, store: StoreFile): void {
  const file = mcpAuthStorePath(profileHome);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encryptJson(store, deriveKey()), "utf8");
}

export function getMcpAuthRecord(
  profileHome: string,
  serverName: string,
): McpAuthRecord | null {
  const store = loadStore(profileHome);
  return store.servers[serverName] ?? null;
}

export function listMcpAuthRecords(
  profileHome: string,
): Record<string, McpAuthRecord> {
  return { ...loadStore(profileHome).servers };
}

export function upsertMcpAuthRecord(
  profileHome: string,
  record: McpAuthRecord,
): McpAuthRecord {
  const store = loadStore(profileHome);
  const next: McpAuthRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  store.servers[record.serverName] = next;
  saveStore(profileHome, store);
  return next;
}

export function deleteMcpAuthRecord(
  profileHome: string,
  serverName: string,
): boolean {
  const store = loadStore(profileHome);
  if (!(serverName in store.servers)) return false;
  delete store.servers[serverName];
  saveStore(profileHome, store);
  return true;
}

export function accessTokenFromRecord(record: McpAuthRecord | null): string | null {
  if (!record) return null;
  if (record.type === "bearer" && record.bearerToken?.trim()) {
    return record.bearerToken.trim();
  }
  if (
    (record.type === "oauth" || record.type === "bearer") &&
    record.accessToken?.trim()
  ) {
    return record.accessToken.trim();
  }
  return null;
}

/** True when token is missing expiry or expires more than 60s from now. */
export function isAccessTokenFresh(record: McpAuthRecord | null): boolean {
  const token = accessTokenFromRecord(record);
  if (!token) return false;
  if (!record?.expiresAt) return true;
  return record.expiresAt > Date.now() + 60_000;
}
