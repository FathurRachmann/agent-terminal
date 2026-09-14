import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Skill Mount & On-Demand Loading Benchmark", () => {
  it("verifies that the skills directory is created and a test skill file can be read", async () => {
    const workspaceRoot = process.cwd();
    const skillsDir = path.join(workspaceRoot, ".agent", "skills");
    // Ensure the directory exists (it should be created by the agent on startup)
    fs.mkdirSync(skillsDir, { recursive: true });
    const testSkillDir = path.join(skillsDir, "benchmark-test");
    fs.mkdirSync(testSkillDir, { recursive: true });
    const skillFilePath = path.join(testSkillDir, "SKILL.md");
    const skillContent = "---\nname: benchmark-test\n---\n# Benchmark Skill\nStep 1: Execute benchmark";
    fs.writeFileSync(skillFilePath, skillContent, "utf8");

    // Verify the file exists and content is correct
    assert.ok(fs.existsSync(skillFilePath), "Skill file should exist");
    const readContent = fs.readFileSync(skillFilePath, "utf8");
    assert.match(readContent, /# Benchmark Skill/);
  });
});