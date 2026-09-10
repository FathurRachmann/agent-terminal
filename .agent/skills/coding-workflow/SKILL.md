---
name: coding-workflow
description: >-
  Full coding pipeline with on-demand skills: ls /skills/ → read few → task_plan
  → task_todos → execute todos → task_verify. Use for features, bugfixes, and
  refactors after discovering skills (never load all skills).
---

# Coding Workflow

## Pipeline (strict)

| Step | Action | Done when |
|------|--------|-----------|
| 1 | `ls /skills/` | See folders; pick 1–3 by name |
| 2 | `read_file` only those SKILL.md | Needed guidance loaded |
| 3 | `task_plan` | Plan + skillsUsed saved |
| 4 | `task_todos` | Atomic todos from plan |
| 5 | Execute each todo | `task_todo_update` in_progress → completed |
| 6 | `task_verify` | VERIFY PASS vs plan/todos |
| 7 | Final user summary | Only after verify pass |

## Skill picking examples

- Bug / feature → `plan-first`, `tdd-workflow`, `coding-standards`, `verification-loop`
- API → add `api-design`, `backend-patterns`
- UI → add `frontend-patterns`
- Auth/secrets → add `security-review`
- Weird failure → add `debugging`

**Never** read the entire `/skills/` tree.

## Definition of done

- [ ] Only needed skills were read
- [ ] Plan + todos saved via tools
- [ ] Todos completed (or explicitly cancelled with reason)
- [ ] `task_verify` returned VERIFY PASS
- [ ] Tests/typecheck evidence noted when code changed
