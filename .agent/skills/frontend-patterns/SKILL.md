---
name: frontend-patterns
description: >-
  Frontend UI patterns: container vs presentational, state location, forms,
  lists/keys, accessibility basics. Use for React/UI components and pages.
---

# Frontend Patterns

## Structure

- **Container**: data fetching + state
- **Presentational**: props in, events out
- Prefer composition over inheritance

## State

1. Local UI → `useState` / signals in the component
2. Shared by nearby tree → lift state
3. App-wide rare reads (theme/auth) → context carefully
4. Server data → query library / RSC fetch — not duplicated in global store

## Lists

- Stable unique `key` (never index if list can reorder)

## Forms

- Uncontrolled + actions when submit-once is enough
- Controlled when live validation/formatting needs it

## A11y

- Label controls; use semantic HTML
- Keyboard operable; don't rely on color alone
- Prefer role/name queries in tests

## Related

- Desktop browser control → `desktop-chrome`
- Verification → `verification-loop`
