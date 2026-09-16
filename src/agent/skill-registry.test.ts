import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadSkillAgentSpecs,
  loadSkillSubagents,
  matchSkillAgents,
  parseAgentFrontmatter,
} from "./skill-registry.js";

describe("skill-registry", () => {
  it("parses agent frontmatter with systemPromptFile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-agent-"));
    try {
      fs.writeFileSync(
        path.join(dir, "AGENT_PROMPT.md"),
        "You are a security specialist.\n",
        "utf8",
      );
      const raw = `---
name: security-review
description: OWASP audit
agent:
  name: security-reviewer
  description: Audit diffs for OWASP Top-10.
  systemPromptFile: AGENT_PROMPT.md
---

# Body
`;
      const parsed = parseAgentFrontmatter(raw, dir);
      assert.ok(parsed);
      assert.equal(parsed!.name, "security-reviewer");
      assert.match(parsed!.systemPrompt, /security specialist/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads subagents from skills tree", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-root-"));
    try {
      const skillDir = path.join(root, "security", "owasp");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: owasp
description: Security skill
agent:
  name: owasp-agent
  description: Find auth bugs.
  systemPrompt: |
    Audit for auth flaws.
---

Skill body.
`,
        "utf8",
      );
      const specs = loadSkillAgentSpecs(root);
      assert.equal(specs.length, 1);
      assert.equal(specs[0]!.skillFolder, "security/owasp");
      const subs = loadSkillSubagents(root);
      assert.equal(subs[0]!.name, "owasp-agent");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches skillsUsed to skill folders", () => {
    const specs = [
      {
        skillFolder: "security/owasp",
        name: "owasp-agent",
        description: "x",
        systemPrompt: "y",
      },
    ];
    assert.equal(matchSkillAgents(["owasp"], specs).length, 1);
    assert.equal(matchSkillAgents(["security/owasp"], specs).length, 1);
    assert.equal(matchSkillAgents(["other"], specs).length, 0);
  });
});
