---
name: skill-discovery
description: >-
  How to find and load skills on demand via ls /skills/ and selective read_file.
  Use at the start of specialized work. Never activate or read all skills at once.
---

# Skill Discovery (On-Demand)

## Rule

Skills are **opt-in**. Chat must not load every SKILL.md.

## Steps

1. \`ls /skills/\` — list skill directories (names only)
2. Match **1–3** names to the user task
3. \`read_file\` each chosen \`/skills/<name>/SKILL.md\` with a high line limit
4. Pass those names into \`task_plan.skillsUsed\`
5. Follow the skill instructions for the rest of the turn

## Examples

| User ask | Likely skills |
|----------|----------------|
| Fix failing test | plan-first, tdd-workflow, debugging |
| New REST endpoint | plan-first, api-design, backend-patterns, tdd-workflow |
| Chrome/YouTube | desktop-chrome (optional if fast-path already handles) |
| Path outside workspace | workspace-confinement |

## Anti-patterns

- Reading all SKILL.md files "just in case"
- Ignoring ls and guessing skill contents
- Activating skills for "halo" / pure chit-chat
