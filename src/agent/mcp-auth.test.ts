import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import {
  createPkcePair,
  discoverOAuthForResource,
} from "./mcp-oauth.js";
import {
  deleteMcpAuthRecord,
  getMcpAuthRecord,
  isAccessTokenFresh,
  mcpAuthStorePath,
  upsertMcpAuthRecord,
} from "./mcp-auth-store.js";
import {
  applyMcpAuthToConnection,
  disconnectMcpAuth,
  resolveMcpAuthInfo,
  resolveMcpAuthMode,
  saveMcpBearerToken,
  saveMcpEnvCredentials,
} from "./mcp-auth.js";

describe("mcp-auth-store", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("encrypts and round-trips records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-"));
    dirs.push(root);
    upsertMcpAuthRecord(root, {
      serverName: "notion",
      type: "bearer",
      bearerToken: "secret-token",
      updatedAt: new Date().toISOString(),
    });
    assert.ok(fs.existsSync(mcpAuthStorePath(root)));
    const raw = fs.readFileSync(mcpAuthStorePath(root), "utf8");
    assert.equal(raw.includes("secret-token"), false);
    const got = getMcpAuthRecord(root, "notion");
    assert.equal(got?.bearerToken, "secret-token");
    assert.equal(deleteMcpAuthRecord(root, "notion"), true);
    assert.equal(getMcpAuthRecord(root, "notion"), null);
  });

  it("treats missing expiry as fresh", () => {
    assert.equal(
      isAccessTokenFresh({
        serverName: "x",
        type: "bearer",
        bearerToken: "t",
        updatedAt: "",
      }),
      true,
    );
    assert.equal(
      isAccessTokenFresh({
        serverName: "x",
        type: "oauth",
        accessToken: "t",
        expiresAt: Date.now() - 1000,
        updatedAt: "",
      }),
      false,
    );
  });
});

describe("mcp-auth resolve", () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("infers none for stdio without auth block", () => {
    assert.equal(
      resolveMcpAuthMode({ command: "npx", args: ["x"] }),
      "none",
    );
  });

  it("infers oauth for url servers", () => {
    assert.equal(
      resolveMcpAuthMode({ url: "https://mcp.example.com/mcp" }),
      "oauth",
    );
  });

  it("reports needs login until bearer saved", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-"));
    dirs.push(root);
    const cfg = { url: "https://mcp.example.com/mcp" };
    assert.equal(resolveMcpAuthInfo(root, "ex", cfg).status, "required");
    saveMcpBearerToken(root, "ex", "tok");
    assert.equal(resolveMcpAuthInfo(root, "ex", cfg).status, "connected");
    disconnectMcpAuth(root, "ex");
    assert.equal(resolveMcpAuthInfo(root, "ex", cfg).status, "required");
  });

  it("applies bearer header and env credentials", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-"));
    dirs.push(root);
    saveMcpBearerToken(root, "remote", "abc");
    const withHeader = await applyMcpAuthToConnection(
      root,
      "remote",
      { url: "https://mcp.example.com" },
      { transport: "http", url: "https://mcp.example.com" },
    );
    assert.equal(
      (withHeader.headers as Record<string, string>).Authorization,
      "Bearer abc",
    );

    saveMcpEnvCredentials(root, "local", { API_KEY: "k1" });
    const withEnv = await applyMcpAuthToConnection(
      root,
      "local",
      { command: "npx", auth: { type: "env", envKeys: ["API_KEY"] } },
      { transport: "stdio", command: "npx", env: { FOO: "1" } },
    );
    assert.deepEqual(withEnv.env, { FOO: "1", API_KEY: "k1" });
  });
});

describe("mcp-oauth helpers", () => {
  it("creates pkce verifier/challenge", () => {
    const a = createPkcePair();
    assert.ok(a.verifier.length > 20);
    assert.ok(a.challenge.length > 20);
    assert.notEqual(a.verifier, a.challenge);
  });

  it("uses explicit auth url overrides", async () => {
    const d = await discoverOAuthForResource("https://mcp.example.com/mcp", {
      authorizationUrl: "https://auth.example.com/authorize",
      tokenUrl: "https://auth.example.com/token",
      scopes: ["mcp"],
    });
    assert.equal(d.authorizationEndpoint, "https://auth.example.com/authorize");
    assert.equal(d.tokenEndpoint, "https://auth.example.com/token");
  });
});
