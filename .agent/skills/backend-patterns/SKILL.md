---
name: backend-patterns
description: >-
  Backend layering: controllers thin, services own business logic, repositories
  abstract persistence. Use for server code, services, DB access, and jobs.
---

# Backend Patterns

## Layers

```
HTTP / RPC  →  Service (business rules)  →  Repository (data)
```

- Controllers/routes: parse, auth, call service, map response
- Services: orchestration, invariants, transactions
- Repositories: CRUD/queries only — no business policy

## DI

- Prefer constructor injection
- Depend on interfaces/abstractions at boundaries

## Data

- DTOs at the edge; domain types inside
- Migrations reversible when possible
- No N+1: batch/join thoughtfully

## Async

- Don't block event loops with sync I/O in async handlers
- Propagate `AbortSignal` / cancellation when available

## Related

- API shape → `api-design`
- Failures → `error-handling`
- Tests → `tdd-workflow`
