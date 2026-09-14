import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { PtySandbox, resolvePoolSize } from "./pty-sandbox.js";

describe("resolvePoolSize", () => {
  it("defaults to 3 and clamps", () => {
    const prev = process.env.PTY_POOL_SIZE;
    delete process.env.PTY_POOL_SIZE;
    try {
      assert.equal(resolvePoolSize(undefined), 3);
      assert.equal(resolvePoolSize(1), 1);
      assert.equal(resolvePoolSize(3), 3);
      assert.equal(resolvePoolSize(8), 8);
      assert.equal(resolvePoolSize(99), 8);
      assert.equal(resolvePoolSize(0), 1);
    } finally {
      if (prev === undefined) delete process.env.PTY_POOL_SIZE;
      else process.env.PTY_POOL_SIZE = prev;
    }
  });
});

describe("PtySandbox pool", () => {
  const dirs: string[] = [];

  after(() => {
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("exposes pool size 3 by default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pty-pool-"));
    dirs.push(dir);
    const sandbox = new PtySandbox({ workingDirectory: dir, poolSize: 3 });
    assert.equal(sandbox.getPoolSize(), 3);
    sandbox.dispose();
  });

  it("runs independent executes in parallel across slots", async () => {
    if (process.platform === "win32") return;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pty-pool-"));
    dirs.push(dir);
    const sandbox = new PtySandbox({
      workingDirectory: dir,
      poolSize: 3,
      timeoutMs: 15_000,
    });

    const started = Date.now();
    const results = await Promise.all([
      sandbox.execute("sleep 0.6 && echo A"),
      sandbox.execute("sleep 0.6 && echo B"),
      sandbox.execute("sleep 0.6 && echo C"),
    ]);
    const elapsed = Date.now() - started;
    sandbox.dispose();

    assert.equal(results[0]?.exitCode, 0);
    assert.equal(results[1]?.exitCode, 0);
    assert.equal(results[2]?.exitCode, 0);
    assert.match(results[0]?.output ?? "", /A/);
    assert.match(results[1]?.output ?? "", /B/);
    assert.match(results[2]?.output ?? "", /C/);
    // Serial would be ~1.8s+; parallel across 3 slots should finish well under 1.5s.
    assert.ok(
      elapsed < 1500,
      `expected parallel PTY pool (<1500ms), got ${elapsed}ms`,
    );
  });
});
