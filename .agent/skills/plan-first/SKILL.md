---
name: plan-first
description: >-
  Mandatory planning gate after on-demand skill discovery. Use AFTER ls /skills/
  and reading only needed SKILL.md files, and BEFORE task_todos or code edits.
---

# Plan First (Mandatory Gate)

## When to use

After you have:

1. `ls /skills/`
2. `read_file` on **only** the 1–3 relevant skills

Then call \`task_plan\` before any application code edits.

## Do not

- Read every skill in `/skills/`
- Skip straight to coding
- Create todos without a saved plan

## Plan via tool

Call \`task_plan\` with:

- `goal` — one sentence
- `plan` — markdown using the template below
- `skillsUsed` — folder names you actually read

### Plan template

```markdown
## Goal
<one sentence>

## In scope
- …

## Out of scope
- …

## Approach
1. …
2. …

## Files likely touched
- `path/a`

## Risks
- …

## Test plan
- [ ] …
```

## Next

1. `task_todos` — break approach into atomic todos
2. Execute with `task_todo_update` (in_progress → completed)
3. `task_verify` against this plan

Trivial exceptions: user says "skip plan / langsung implement", or pure chit-chat / single desktop open.
