---
name: error-handling
description: >-
  Robust error handling across TypeScript/Node and similar stacks: typed
  failures, no silent catches, user-safe messages, structured logs. Use when
  adding try/catch, Result types, or fixing swallowed errors.
---

# Error Handling

## Principles

1. **Fail visibly** — never empty `catch {}`
2. **Classify** — validation vs not-found vs conflict vs infrastructure
3. **Safe UX** — users see actionable messages; logs get detail
4. **Preserve cause** — wrap with context; don't lose stack when rethrowing

## Patterns

```ts
// Prefer explicit handling
try {
  await work();
} catch (err) {
  logger.error({ err, op: "work" }, "work failed");
  throw new AppError("Could not complete work", { cause: err });
}
```

- Return `Result`/`Either` for expected domain failures when the codebase does
- Use exceptions for unexpected infrastructure failures
- Retry only idempotent ops with backoff; don't retry bad input

## Anti-patterns

- Swallow + return `null` without reason
- Catch-all that shows "Something went wrong" with no log correlation id
- Catching to "keep going" when state is corrupt
