import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { TerminalService } from "./terminal-service.js";

describe("TerminalService", () => {
  const dirs: string[] = [];
  const services: TerminalService[] = [];

  after(() => {
    for (const svc of services) {
      try {
        svc.disposeAll();
      } catch {
        /* ignore */
      }
    }
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("creates, writes, lists, and kills a session", async () => {
    if (process.platform === "win32") return;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-term-"));
    dirs.push(dir);

    const chunks: string[] = [];
    const exits: Array<{ id: string; code: number }> = [];
    const svc = new TerminalService();
    services.push(svc);
    svc.setHandlers({
      onData: (_id, data) => {
        chunks.push(data);
      },
      onExit: (id, exitCode) => {
        exits.push({ id, code: exitCode });
      },
    });

    const session = svc.create({
      cwd: dir,
      cols: 80,
      rows: 24,
      shell: process.env.SHELL || "/bin/bash",
    });
    assert.ok(session.id);
    assert.equal(session.cwd, dir);
    assert.equal(svc.list().length, 1);

    const marker = `term-svc-${Date.now()}`;
    const wrote = svc.write(session.id, `printf '%s\\n' '${marker}'\n`);
    assert.equal(wrote.ok, true);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (chunks.join("").includes(marker)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(chunks.join(""), new RegExp(marker));

    const resized = svc.resize(session.id, 100, 40);
    assert.equal(resized.ok, true);

    const killed = svc.kill(session.id);
    assert.equal(killed.ok, true);
    assert.equal(svc.list().length, 0);
  });

  it("disposeAll clears every session", () => {
    if (process.platform === "win32") return;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-term-"));
    dirs.push(dir);
    const svc = new TerminalService();
    services.push(svc);

    svc.create({ cwd: dir, cols: 40, rows: 12 });
    svc.create({ cwd: dir, cols: 40, rows: 12 });
    assert.equal(svc.list().length, 2);
    svc.disposeAll();
    assert.equal(svc.list().length, 0);
  });

  it("write/resize/kill return errors for unknown ids", () => {
    const svc = new TerminalService();
    services.push(svc);
    assert.equal(svc.write("missing", "x").ok, false);
    assert.equal(svc.resize("missing", 80, 24).ok, false);
    assert.equal(svc.kill("missing").ok, false);
  });
});
