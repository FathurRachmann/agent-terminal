import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { tool } from "langchain";
import { z } from "zod";

/* ── Vault Encryption Helpers (AES-256-GCM) ──────────────────── */

type VaultEntry = {
  id: string;
  service: string;
  identifier: string;
  secret: string;
  notes?: string;
  updatedAt: string;
};

function deriveMasterKey(): Buffer {
  const secretKey = process.env.AGENT_VAULT_KEY || `${os.hostname()}:${os.homedir()}:agent-vault-v1`;
  return crypto.pbkdf2Sync(secretKey, "agent-salt-static", 100_000, 32, "sha256");
}

function encryptVaultData(entries: VaultEntry[], key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(entries);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  });
}

function decryptVaultData(encryptedRaw: string, key: Buffer): VaultEntry[] {
  try {
    const { iv, tag, data } = JSON.parse(encryptedRaw) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, "hex")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as VaultEntry[];
  } catch {
    return [];
  }
}

function vaultPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".agent", "vault", "credentials.enc");
}

function loadVault(workspaceRoot: string): VaultEntry[] {
  const filePath = vaultPath(workspaceRoot);
  if (!fs.existsSync(filePath)) return [];
  const key = deriveMasterKey();
  const raw = fs.readFileSync(filePath, "utf8");
  return decryptVaultData(raw, key);
}

function saveVault(workspaceRoot: string, entries: VaultEntry[]): void {
  const filePath = vaultPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const key = deriveMasterKey();
  const encrypted = encryptVaultData(entries, key);
  fs.writeFileSync(filePath, encrypted, "utf8");
}

/* ── Vault Tools ─────────────────────────────────────────────── */

export function createVaultManagementTools(workspaceRoot: string) {
  const vaultStore = tool(
    async ({
      service,
      identifier,
      secret,
      notes,
    }: {
      service: string;
      identifier: string;
      secret: string;
      notes?: string;
    }) => {
      const entries = loadVault(workspaceRoot);
      const key = `${service.toLowerCase().trim()}:${identifier.toLowerCase().trim()}`;
      const existingIdx = entries.findIndex(
        (e) => `${e.service.toLowerCase()}:${e.identifier.toLowerCase()}` === key
      );

      const newEntry: VaultEntry = {
        id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        service: service.trim(),
        identifier: identifier.trim(),
        secret,
        notes: notes?.trim(),
        updatedAt: new Date().toISOString(),
      };

      if (existingIdx >= 0) {
        entries[existingIdx] = newEntry;
      } else {
        entries.push(newEntry);
      }

      saveVault(workspaceRoot, entries);
      return `Encrypted credential stored in Vault for '${service}' (${identifier}).`;
    },
    {
      name: "vault_store",
      description:
        "Store an encrypted credential (API key, password, token) in the secure local Vault. " +
        "Secrets are encrypted at rest with AES-256-GCM.",
      schema: z.object({
        service: z.string().describe("Service or domain name (e.g. 'github', 'openai', 'aws')"),
        identifier: z.string().describe("Username, email, or key alias (e.g. 'user@example.com', 'default')"),
        secret: z.string().describe("Secret value (API key, password, OAuth token)"),
        notes: z.string().optional().describe("Optional notes/description"),
      }),
    }
  );

  const vaultList = tool(
    async () => {
      const entries = loadVault(workspaceRoot);
      if (entries.length === 0) return "Vault is empty.";
      return [
        "Vault Credentials (secrets masked):",
        ...entries.map(
          (e, i) =>
            `${i + 1}. Service: ${e.service} | Identifier: ${e.identifier} | Secret: [MASKED ${e.secret.length} chars] | Updated: ${e.updatedAt}`
        ),
      ].join("\n");
    },
    {
      name: "vault_list",
      description:
        "List all stored credentials in Vault without revealing secret values. " +
        "Use to check available credentials and service names.",
      schema: z.object({}),
    }
  );

  const vaultGet = tool(
    async ({ service, identifier }: { service: string; identifier?: string }) => {
      const entries = loadVault(workspaceRoot);
      const svc = service.toLowerCase().trim();
      const matches = entries.filter((e) => e.service.toLowerCase() === svc);

      if (matches.length === 0) {
        return `No Vault credentials found for service '${service}'.`;
      }

      let match = matches[0]!;
      if (identifier) {
        const iden = identifier.toLowerCase().trim();
        const found = matches.find((e) => e.identifier.toLowerCase() === iden);
        if (found) match = found;
      }

      return [
        `Vault Secret Retrieved:`,
        `Service: ${match.service}`,
        `Identifier: ${match.identifier}`,
        `Secret: ${match.secret}`,
        match.notes ? `Notes: ${match.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
    {
      name: "vault_get",
      description:
        "Retrieve a decrypted secret from Vault for a specific service and identifier. " +
        "Use when executing code or API requests that require credentials.",
      schema: z.object({
        service: z.string().describe("Service name to look up"),
        identifier: z.string().optional().describe("Optional identifier filter"),
      }),
    }
  );

  const vaultDelete = tool(
    async ({ service, identifier }: { service: string; identifier?: string }) => {
      const entries = loadVault(workspaceRoot);
      const svc = service.toLowerCase().trim();
      const iden = identifier?.toLowerCase().trim();

      const next = entries.filter((e) => {
        if (e.service.toLowerCase() !== svc) return true;
        if (iden && e.identifier.toLowerCase() !== iden) return true;
        return false;
      });

      const removedCount = entries.length - next.length;
      if (removedCount === 0) {
        return `No matching Vault credentials found to delete for '${service}'.`;
      }

      saveVault(workspaceRoot, next);
      return `Deleted ${removedCount} Vault credential(s) for '${service}'.`;
    },
    {
      name: "vault_delete",
      description: "Delete credentials from Vault for a service.",
      schema: z.object({
        service: z.string().describe("Service name"),
        identifier: z.string().optional().describe("Optional identifier filter"),
      }),
    }
  );

  return [vaultStore, vaultList, vaultGet, vaultDelete];
}
