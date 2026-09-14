import fs from "node:fs";
import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";

/* ── skill_manage tool ───────────────────────────────────────── */

function findSkillPath(skillsDir: string, name: string): string | null {
  // Direct check
  const directPath = path.join(skillsDir, name, "SKILL.md");
  if (fs.existsSync(directPath)) return directPath;

  // Recursive search
  const queue: string[] = [skillsDir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === name) {
          const candidate = path.join(full, "SKILL.md");
          if (fs.existsSync(candidate)) return candidate;
        }
        queue.push(full);
      }
    }
  }
  return null;
}

export function createSkillManagementTools(workspaceRoot: string) {
  const skillsDir = path.join(workspaceRoot, ".agent", "skills");

  const skillManage = tool(
    async ({
      action,
      name,
      content,
      oldString,
      newString,
    }: {
      action: "create" | "patch" | "delete";
      name: string;
      content?: string;
      oldString?: string;
      newString?: string;
    }) => {
      fs.mkdirSync(skillsDir, { recursive: true });
      const foundPath = findSkillPath(skillsDir, name);
      const targetDir = foundPath ? path.dirname(foundPath) : path.join(skillsDir, name);
      const skillFile = foundPath || path.join(targetDir, "SKILL.md");

      if (action === "create") {
        if (!content) return "Error: 'content' is required for action=create";
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(skillFile, content, "utf8");
        return `Skill '${name}' created at /skills/${name}/SKILL.md`;
      }

      if (action === "patch") {
        if (!fs.existsSync(skillFile)) {
          return `Error: Skill '${name}' does not exist at /skills/${name}/SKILL.md`;
        }
        const existing = fs.readFileSync(skillFile, "utf8");
        if (oldString && newString !== undefined) {
          if (!existing.includes(oldString)) {
            return `Error: 'oldString' not found in /skills/${name}/SKILL.md`;
          }
          const updated = existing.replace(oldString, newString);
          fs.writeFileSync(skillFile, updated, "utf8");
          return `Skill '${name}' patched successfully.`;
        } else if (content) {
          fs.writeFileSync(skillFile, content, "utf8");
          return `Skill '${name}' updated with new content.`;
        }
        return "Error: For action=patch, provide (oldString + newString) or 'content'.";
      }

      if (action === "delete") {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
          return `Skill '${name}' deleted from /skills/${name}/`;
        }
        return `Skill '${name}' did not exist.`;
      }

      return "Unknown action";
    },
    {
      name: "skill_manage",
      description:
        "Create, update (patch), or delete skills in the virtual /skills/ catalog. " +
        "Use this after solving a difficult problem to record the procedure/learnings " +
        "or to maintain existing skills.",
      schema: z.object({
        action: z.enum(["create", "patch", "delete"]).describe("Action to perform"),
        name: z.string().describe("Skill folder name (lowercase, hyphenated)"),
        content: z
          .string()
          .optional()
          .describe("Full SKILL.md content (for create or full update)"),
        oldString: z
          .string()
          .optional()
          .describe("Target text to replace (for patch)"),
        newString: z
          .string()
          .optional()
          .describe("Replacement text (for patch)"),
      }),
    }
  );

  return [skillManage];
}