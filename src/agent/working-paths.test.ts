import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ARTIFACT_ROOT,
  canonicalizeArtifactRelPath,
  isWorkingRelativePath,
  resolveWorkingAwarePath,
  resolveWorkingScope,
  workingScopeAbs,
} from "./working-paths.js";

describe("working-paths (artifact root tmp)", () => {
  it("uses tmp/ as canonical artifact root", () => {
    assert.equal(ARTIFACT_ROOT, "tmp");
    assert.equal(resolveWorkingScope({}).relDir, "tmp/global");
    assert.equal(
      resolveWorkingScope({ botId: "fe" }).relDir,
      "tmp/bots",
    );
    assert.equal(
      resolveWorkingScope({ threadId: "bot-qa" }).relDir,
      "tmp/bots",
    );
    assert.equal(
      resolveWorkingScope({ projectName: "SIMKOPDES" }).relDir,
      "tmp/project/simkopdes",
    );
    assert.equal(
      resolveWorkingScope({
        workspaceId: "ws1",
        projectName: "SIMKOPDES",
      }).relDir,
      "tmp/project/simkopdes",
    );
    assert.equal(
      resolveWorkingScope({
        threadId: "ws-demo__chat1",
        projectName: "Finance",
      }).relDir,
      "tmp/project/finance",
    );
  });

  it("detects tmp/ and legacy working/ paths", () => {
    assert.equal(isWorkingRelativePath("tmp/global/a.md"), true);
    assert.equal(isWorkingRelativePath("tmp/bots/x.md"), true);
    assert.equal(isWorkingRelativePath("src/foo.ts"), false);
    assert.equal(
      canonicalizeArtifactRelPath("tmp/bots/x.md"),
      "tmp/bots/x.md",
    );
  });

  it("remaps tmp/ and legacy working/ onto artifact home", () => {
    const home = "/tmp/AgentHome";
    const cwd = "/tmp/project-cwd";
    assert.equal(
      resolveWorkingAwarePath(home, cwd, "tmp/global/a.md"),
      path.resolve(home, "tmp/global/a.md"),
    );
    assert.equal(
      resolveWorkingAwarePath(home, cwd, "tmp/global/a.md"),
      path.resolve(home, "tmp/global/a.md"),
    );
    assert.equal(
      resolveWorkingAwarePath(home, cwd, "src/a.ts"),
      path.resolve(cwd, "src/a.ts"),
    );
  });

  it("workingScopeAbs joins under agent root", () => {
    const scope = resolveWorkingScope({ projectName: "Foo Bar" });
    const abs = workingScopeAbs("/tmp/Agent", scope);
    assert.equal(
      abs.absDir,
      path.join("/tmp/Agent", "tmp", "project", "foo-bar"),
    );
    assert.equal(
      abs.uploadsAbsDir,
      path.join("/tmp/Agent", "tmp", "project", "foo-bar", "uploads"),
    );
  });
});
