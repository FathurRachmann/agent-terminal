import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readMcpServerMap, mcpConfigPaths } from "./mcp-loader.js";
import { filterMcpServers } from "./capabilities-catalog.js";

describe("mcp-loader", () => {
  it("lists config candidate paths", () => {
    const paths = mcpConfigPaths(["/tmp/a", "/tmp/b"]);
    assert.ok(paths.some((p) => p.endsWith(path.join(".agent", "mcp.json"))));
    assert.ok(paths.some((p) => p.endsWith(".mcp.json")));
  });

  it("reads mcpServers from .agent/mcp.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-load-"));
    try {
      fs.mkdirSync(path.join(root, ".agent"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".agent", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            tradingview: {
              command: "npx",
              args: ["-y", "tradingview-mcp-server@0.7.1"],
              description: "TV screener",
            },
          },
        }),
      );
      const loaded = readMcpServerMap([root]);
      assert.ok(loaded);
      assert.equal(loaded!.servers.tradingview?.command, "npx");
      const filtered = filterMcpServers(loaded!.servers, new Set(["tradingview"]));
      assert.deepEqual(Object.keys(filtered), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
