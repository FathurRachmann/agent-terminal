import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  resolveWorkingAwarePath,
  resolveWorkingScope,
  slugifyProjectName,
  workingScopeAbs,
} from "./working-paths.js";

describe("working-paths", () => {
  it("slugifies project names", () => {
    assert.equal(slugifyProjectName("SIMKOPDES Frontend"), "simkopdes-frontend");
    assert.equal(slugifyProjectName(""), "unnamed");
  });

  it("maps global / bots / project / workspace", () => {
    assert.equal(resolveWorkingScope({}).relDir, "working/global");
    assert.equal(
      resolveWorkingScope({ threadId: "bot-coder" }).relDir,
      "working/bots",
    );
    assert.equal(
      resolveWorkingScope({ botId: "coder" }).relDir,
      "working/bots",
    );
    assert.equal(
      resolveWorkingScope({
        projectId: "p1",
        projectName: "SIMKOPDES",
      }).relDir,
      "working/project/simkopdes",
    );
    assert.equal(
      resolveWorkingScope({
        workspaceId: "it",
        projectName: "SIMKOPDES",
        botId: "cto",
      }).relDir,
      "working/project/simkopdes",
    );
    assert.equal(
      resolveWorkingScope({
        threadId: "ws-it-general",
        projectName: "SIMKOPDES",
      }).relDir,
      "working/project/simkopdes",
    );
    assert.equal(
      resolveWorkingScope({ workspaceId: "finance" }).relDir,
      "working/project/finance",
    );
    assert.notEqual(
      resolveWorkingScope({ workspaceId: "finance" }).relDir,
      resolveWorkingScope({ workspaceId: "hr" }).relDir,
    );
  });

  it("parses hyphenated workspace thread ids", async () => {
    const { workspaceThreadId, parseWorkspaceThreadId } = await import(
      "./workspaces/chats.js"
    );
    const id = workspaceThreadId("it-team", "general");
    assert.equal(id, "ws-it-team__general");
    assert.deepEqual(parseWorkspaceThreadId(id), {
      workspaceId: "it-team",
      chatId: "general",
    });
    assert.deepEqual(parseWorkspaceThreadId("ws-it-team-general"), {
      workspaceId: "it-team",
      chatId: "general",
    });
    const weird = workspaceThreadId("dev__prod", "general");
    assert.equal(weird, "ws-dev_prod__general");
    assert.deepEqual(parseWorkspaceThreadId(weird), {
      workspaceId: "dev_prod",
      chatId: "general",
    });
  });

  it("remaps working/ onto artifact home", () => {
    const home = "/Users/me/Agent";
    const cwd = "/Users/me/Documents/project";
    assert.equal(
      resolveWorkingAwarePath(home, cwd, "working/global/a.md"),
      path.resolve(home, "working/global/a.md"),
    );
    assert.equal(
      resolveWorkingAwarePath(home, cwd, "src/app.ts"),
      path.resolve(cwd, "src/app.ts"),
    );
  });

  it("builds absolute dirs", () => {
    const scope = resolveWorkingScope({ projectName: "Foo Bar" });
    const abs = workingScopeAbs("/tmp/Agent", scope);
    assert.equal(abs.absDir, path.join("/tmp/Agent", "working", "project", "foo-bar"));
    assert.equal(
      abs.uploadsAbsDir,
      path.join("/tmp/Agent", "working", "project", "foo-bar", "uploads"),
    );
  });
});
