---
name: api-design
description: >-
  REST API design: resource naming, status codes, pagination, consistent
  response envelopes, and validation. Use when adding or changing HTTP
  endpoints or API contracts.
---

# API Design

## Resources

- Nouns, plural: `/users`, `/users/:id/orders`
- Prefer HTTP verbs on resources over RPC-style `/doCreateUser`
- Nest only when ownership is clear; avoid deep `/a/b/c/d/e`

## Responses

Consistent envelope when the project uses one:

```ts
{ success: boolean, data?: T, error?: string, meta?: { page, limit, total } }
```

- `200`/`201` on success; `400` validation; `401`/`403` auth; `404` missing; `409` conflict; `500` unexpected
- Never return password hashes or raw tokens in JSON bodies

## Validation

- Validate body/query/params at the edge (schema)
- Reject unknown fields when it matters for security
- Idempotency for risky POSTs when appropriate

## Versioning & docs

- Don't break existing clients silently
- Document new fields and deprecations in the plan

## Related

- Auth and threats → `security-review`
- Service layer → `backend-patterns`
- Claude / Anthropic SDK, models, streaming, tools → `/skills/claude-api/SKILL.md`
