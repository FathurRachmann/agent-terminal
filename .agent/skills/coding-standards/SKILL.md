---
name: coding-standards
description: >-
  Baseline coding conventions: immutability, small focused files, explicit
  errors, input validation at boundaries, no secrets, no drive-by refactors.
  Use while implementing after plan-first and tdd-workflow.
---

# Coding Standards

## Immutability

- Prefer new objects/arrays over in-place mutation
- Use spread / `map` / `filter`; avoid mutating arguments

## Structure

- Many small files > few large ones (aim <400 lines; hard stop ~800)
- Functions do one thing; extract when nesting >3–4 levels
- Match existing project patterns before inventing new ones

## Boundaries

- Validate all external input (user, HTTP, env, files) — fail fast
- Prefer schema validation (Zod / equivalent) at edges
- Never trust client-only checks for authz

## Errors

- Handle errors explicitly; no empty `catch`
- User-facing messages: clear and safe; logs: detailed (no secrets)
- Propagate failures instead of silent fallbacks that hide bugs

## Hygiene

- No hardcoded secrets; use env / secret manager
- No `console.log` noise in production paths — use project logging
- Only modify code required by the plan
- Comments only for non-obvious intent

## Diff discipline

- Minimal working diff
- Delete dead code you replace; don't leave commented-out blocks
- Don't expand scope "while you're there"
