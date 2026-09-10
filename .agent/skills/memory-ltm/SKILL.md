---
name: memory-ltm
description: >-
  Uses long-term cognitive memory (memory_store, memory_recall, remember_rule) and
  respects AGENTS.md preferences. Use after non-obvious fixes, recurring pitfalls,
  or when past sessions may hold relevant lessons. Never store secrets.
---

# Long-Term Memory

## Layers

| Layer | What | Agent action |
|-------|------|----------------|
| Persistent | Session transcript + checkpoints | Automatic — do not dump into replies |
| Long-term | Rules / facts / episodes / preferences | `memory_store`, `memory_recall`, `remember_rule` |
| Always-on | `.agent/AGENTS.md` | Loaded each turn — honor Known Pitfalls + User preferences |

## When to store

- Non-obvious root cause or durable workaround → `remember_rule` / `memory_store(kind="rule")` as `WHEN … → DO …`
- Failed approach worth avoiding → `kind="error"`
- Useful durable fact about this repo → `kind="fact"`
- User tone/language habits → usually auto; explicit `kind="preference"` must be `USER prefers|writes|asks …`

## When to recall

- Before repeating debugging you may have done before → `memory_recall` with symptom keywords
- Prefer **fresh tool evidence** when memory conflicts with the current workspace

## Never store

- API keys, tokens, passwords, cookies, private URLs with secrets
- One-off chat noise or unfinished CoT

## Formats

- Rules: `WHEN <condition> → DO <action>`
- Preferences: `USER prefers …` / `USER writes …` / `USER asks …`
