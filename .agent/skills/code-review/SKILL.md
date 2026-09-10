---
name: code-review
description: >-
  Structured code review for quality, maintainability, and correctness after
  writing or changing code. Flags CRITICAL/HIGH issues first. Use before
  finishing a coding task.
---

# Code Review

## When

- After implementing a feature/fix
- Before telling the user the work is complete
- When reviewing a diff the user points at

## Checklist

### Correctness
- [ ] Matches the approved plan / acceptance criteria
- [ ] Edge cases and error paths handled
- [ ] No off-by-one / race / stale state bugs

### Design
- [ ] Fits existing architecture
- [ ] No unnecessary abstraction
- [ ] Dependencies injected at boundaries where needed

### Readability
- [ ] Names clear; functions small
- [ ] No dead code or commented-out blocks

### Tests
- [ ] Behavior covered; failures meaningful
- [ ] Not testing implementation details only

## Severity

| Level | Action |
|-------|--------|
| CRITICAL | Must fix before done |
| HIGH | Fix in this pass |
| MEDIUM | Fix if quick; else note |
| LOW | Optional note |

## Output style

Short findings with file references. Lead with CRITICAL/HIGH only unless asked for a full review.
