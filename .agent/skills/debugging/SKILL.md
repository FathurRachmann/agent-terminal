---
name: debugging
description: >-
  Systematic debugging: reproduce, isolate, hypothesize, verify with tools
  (logs, tests, execute). Use when fixing mysterious failures, flaky tests, or
  regressions.
---

# Debugging

## Loop

1. **Reproduce** — exact steps / command / input
2. **Locate** — smallest failing surface (file, test, request)
3. **Hypothesize** — one cause at a time
4. **Prove** — add a failing test or observe with `execute` / logs
5. **Fix** — minimal change
6. **Regress** — ensure nearby tests still pass

## Evidence over guessing

- Read the actual error/stderr
- Prefer bisecting with tests over large speculative rewrites
- Don't change 5 things at once

## Common causes here

- Model refusing tools → use deterministic fast-paths / skills
- Path outside allowlist → `request_folder_access`
- PTY hang → awaiting input / timeout
- Middleware quirks → normalize AIMessage instances

## After fix

- Store durable lesson with `memory-ltm` if non-obvious
- Note verification commands run
