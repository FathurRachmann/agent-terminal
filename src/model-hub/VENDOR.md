# Model Hub — copied 9Router engine source

**Upstream:** [decolua/9router](https://github.com/decolua/9router) v0.5.55  
**License:** MIT (see `LICENSE`)

Source copy of the 9Router gateway engine for Agent to own and evolve.
Layout mirrors upstream so relative imports (`open-sse` ↔ `src/lib`) keep working.

## Layout

| Path | Upstream |
|------|----------|
| `open-sse/` | `9router/open-sse` |
| `src/lib/` | `9router/src/lib` |
| `src/sse/` | `9router/src/sse` |
| `src/shared/` | `9router/src/shared` (constants; UI components dropped) |
| `src/models/` | `9router/src/models` |
| `src/app/api/` | `9router/src/app/api/{providers,combos,usage,keys,oauth,v1,…}` |
| `server.mjs` | Agent HTTP entry — **no dashboard login** |
| `register-aliases.mjs` | Resolves `@/*` → `src/*`, `open-sse/*`, `next/*` shims |

## Run

```bash
DATA_DIR=… PORT=27128 node --import ./src/model-hub/register-aliases.mjs ./src/model-hub/server.mjs
```

Desktop Agent starts this automatically and injects `ROUTER_BASE_URL` / `ROUTER_API_KEY`.
