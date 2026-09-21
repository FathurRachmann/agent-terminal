import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  createWorkspaceWithSeed,
  loadWorkspaceBots,
  resolveWorkspaceDivision,
} from "./index.js";
import {
  IT_DIVISION_SEED_BOTS,
  loadAgencyAgentsCatalog,
  seedBotsForDivision,
} from "./division-catalog.js";

describe("workspace division seeds (full agency catalog)", () => {
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

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-div-"));
    dirs.push(dir);
    return dir;
  }

  it("loads all agency divisions", () => {
    const catalog = loadAgencyAgentsCatalog();
    const keys = Object.keys(catalog.divisions);
    assert.ok(keys.length >= 18, `expected ≥18 divisions, got ${keys.length}`);
    const total = keys.reduce((n, k) => n + catalog.divisions[k]!.length, 0);
    assert.ok(total >= 200, `expected ≥200 agents, got ${total}`);
  });

  it("resolves division from seedItRoles compat", () => {
    assert.equal(resolveWorkspaceDivision({}), "it");
    assert.equal(resolveWorkspaceDivision({ seedItRoles: false }), "none");
    assert.equal(resolveWorkspaceDivision({ division: "finance" }), "finance");
    assert.equal(
      resolveWorkspaceDivision({ division: "specialized" }),
      "specialized",
    );
  });

  it("IT seed matches engineering roster size", () => {
    const it = seedBotsForDivision("it");
    const eng = seedBotsForDivision("engineering");
    assert.equal(it.length, eng.length);
    assert.ok(it.length >= 50);
    assert.ok(IT_DIVISION_SEED_BOTS.length === it.length);
    assert.ok(it.some((b) => /frontend/i.test(b.id) || /frontend/i.test(b.name)));
  });

  it("seeds finance roster only for finance division", () => {
    const home = tmp();
    const created = createWorkspaceWithSeed(home, {
      name: "Finance",
      division: "finance",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.workspace.division, "finance");
    const bots = loadWorkspaceBots(home, created.workspace.id);
    const finance = seedBotsForDivision("finance");
    assert.equal(bots.length, finance.length);
    assert.ok(bots.every((b) => !["fe", "be", "cto"].includes(b.id)));
  });

  it("seeds sales roster without engineering ids", () => {
    const home = tmp();
    const created = createWorkspaceWithSeed(home, {
      name: "Sales",
      division: "sales",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const bots = loadWorkspaceBots(home, created.workspace.id);
    assert.equal(bots.length, seedBotsForDivision("sales").length);
    assert.ok(bots.length >= 5);
  });

  it("seedBotsForDivision none returns empty", () => {
    assert.deepEqual(seedBotsForDivision("none"), []);
  });
});
