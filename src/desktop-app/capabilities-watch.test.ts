import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCapabilitiesWatch } from "./capabilities-watch.js";

describe("startCapabilitiesWatch", () => {
  const roots: string[] = [];
  after(() => {
    for (const root of roots) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("fires when a new SKILL.md appears", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caps-watch-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".agent", "skills"), { recursive: true });

    let hits = 0;
    const handle = startCapabilitiesWatch(root, () => {
      hits += 1;
    });

    const skillDir = path.join(root, ".agent", "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo\ndescription: x\n---\n# Demo\n",
      "utf8",
    );

    await new Promise((r) => setTimeout(r, 600));
    handle.close();
    assert.ok(hits >= 1, `expected ≥1 watch hit, got ${hits}`);
  });
});
