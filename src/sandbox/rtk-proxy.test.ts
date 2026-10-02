import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ensureRtkProxy,
  ensureRtkProxySegment,
  injectUltraCompact,
  resetRtkBinCache,
} from "./rtk-proxy.js";

describe("ensureRtkProxy", () => {
  beforeEach(() => {
    resetRtkBinCache();
    delete process.env.RTK_PROXY;
    delete process.env.RTK_DISABLED;
    // Force "rtk present" without calling which
    process.env.RTK_BIN = "/opt/homebrew/bin/rtk";
  });

  it("injectUltraCompact skips already-flagged rtk", () => {
    assert.equal(
      injectUltraCompact("rtk git status"),
      "rtk --ultra-compact git status",
    );
    assert.equal(
      injectUltraCompact("rtk --ultra-compact git status"),
      "rtk --ultra-compact git status",
    );
    assert.equal(
      injectUltraCompact("cd /tmp && rtk ls && rtk git status"),
      "cd /tmp && rtk --ultra-compact ls && rtk --ultra-compact git status",
    );
  });

  it("wraps ls / git / npm with rtk --ultra-compact via rewrite", () => {
    assert.equal(
      ensureRtkProxy("ls -la"),
      "rtk --ultra-compact ls -la",
    );
    assert.equal(
      ensureRtkProxy("git status"),
      "rtk --ultra-compact git status",
    );
    assert.equal(
      ensureRtkProxy("npm run test"),
      "rtk --ultra-compact npm run test",
    );
  });

  it("maps cat / eslint / rg via rewrite (or fallback)", () => {
    // Upstream rewrite: cat → read; local fallback: *.json → json
    const cat = ensureRtkProxy("cat package.json");
    assert.match(cat, /^rtk --ultra-compact (?:read|json) package\.json$/);
    assert.equal(
      ensureRtkProxySegment("cat app.log"),
      "rtk --ultra-compact log app.log",
    );
    assert.equal(
      ensureRtkProxy("eslint src"),
      "rtk --ultra-compact lint src",
    );
    assert.equal(
      ensureRtkProxy('rg "foo" src'),
      'rtk --ultra-compact grep "foo" src',
    );
  });

  it("does not double-wrap; adds --ultra-compact to bare rtk", () => {
    assert.equal(
      ensureRtkProxy("rtk git status"),
      "rtk --ultra-compact git status",
    );
    assert.equal(
      ensureRtkProxy("rtk --ultra-compact git status"),
      "rtk --ultra-compact git status",
    );
  });

  it("rewrites each side of && via rtk rewrite", () => {
    assert.equal(
      ensureRtkProxy("git status && npm run typecheck"),
      "rtk --ultra-compact git status && rtk --ultra-compact npm run typecheck",
    );
    assert.equal(
      ensureRtkProxy("cd /tmp && git status"),
      "cd /tmp && rtk --ultra-compact git status",
    );
  });

  it("leaves unrelated commands alone", () => {
    assert.equal(ensureRtkProxy("python script.py"), "python script.py");
    assert.equal(ensureRtkProxy("mkdir -p tmp/out"), "mkdir -p tmp/out");
  });

  it("proxies only the supported side of mixed chains", () => {
    assert.equal(
      ensureRtkProxy("python x.py && git status"),
      "python x.py && rtk --ultra-compact git status",
    );
  });

  it("normalizes rtk -u and cleans trailing -u from subcommands", () => {
    assert.equal(
      injectUltraCompact("rtk -u git status"),
      "rtk --ultra-compact git status",
    );
    assert.equal(
      injectUltraCompact("rtk tsc -u"),
      "rtk --ultra-compact tsc",
    );
    assert.equal(
      injectUltraCompact("rtk json package.json -u"),
      "rtk --ultra-compact json package.json",
    );
  });

  it("no-ops when RTK_PROXY=0", () => {
    process.env.RTK_PROXY = "0";
    resetRtkBinCache();
    assert.equal(ensureRtkProxy("git status"), "git status");
  });
});
