---
name: verification-loop
description: >-
  Post-change verification: typecheck, unit tests, lint, and targeted manual
  checks before declaring done. Use after implementation or when builds fail.
---

# Verification Loop

## Before saying "done"

Run the **narrowest** checks that prove the change:

1. Typecheck — `npm run typecheck` / `tsc --noEmit`
2. Unit tests — especially files you touched — `npm run test:unit`
3. Lint if the project has it
4. For UI/desktop — smoke the exact user path once

## Loop

```
change → verify → if fail: diagnose → minimal fix → verify again
```

- Do not claim success if verification was skipped
- Prefer fixing root cause over deleting tests
- If verification is blocked (missing deps), say so explicitly

## Evidence in the reply

- What you ran
- Pass / fail
- What remains unverified (if any)

## Related

- Build/type errors → fix surgically; avoid unrelated refactors
- Flaky tests → isolate; don't ignore
