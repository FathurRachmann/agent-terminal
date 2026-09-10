---
name: tdd-workflow
description: >-
  Test-driven development for features, bugfixes, and refactors. Write failing
  tests first (RED), implement minimal code (GREEN), then refactor. Target 80%+
  coverage on changed behavior. Use after plan-first.
---

# TDD Workflow

## Order

1. **RED** — write the smallest failing test that expresses the desired behavior
2. Run it — confirm it fails for the right reason
3. **GREEN** — minimal implementation to pass
4. Run tests — confirm pass
5. **REFACTOR** — clean up without changing behavior; keep tests green

## Coverage targets (changed areas)

| Layer | Target |
|-------|--------|
| Pure utils / domain | ≥90% |
| Services / hooks | ≥85% |
| API / integration | golden path + errors |
| UI | behavior via Testing Library, not implementation details |

## Test types

- **Unit** — pure functions, mappers, validators
- **Integration** — API + DB/service boundaries
- **E2E** — critical user journeys only (when applicable)

## Rules

- No production code for a behavior change without a failing test first (unless pure typings/docs)
- Fix implementation, not tests, when the test is correct
- Prefer behavior assertions over mocks of internals
- Name tests by scenario: `rejects empty email`, `stores preference when Indonesian chat`

## Commands (adapt to project)

```bash
npm run test:unit
npm run typecheck
# or: npm test / vitest / pytest / etc.
```
