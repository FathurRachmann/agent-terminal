# Agent Terminal

Terminal-first AI coding agent built with **Deep Agents** (LangGraph harness), **full PTY** (`node-pty`), and **9router** as an OpenAI-compatible model gateway.

## Features

- ReAct / tool-use loop via `createDeepAgent`
- Full PTY sandbox (interactive prompts, stateful shell, timeouts)
- Workspace isolation + destructive-command guardrails
- 256k context budget with auto-summarize and history offload
- Dual memory: Persistent (durability) + Long-Term (semantic/cognitive)
- Always-on guidelines via `.agent/AGENTS.md`
- **Agent skills** under `.agent/skills/*/SKILL.md` (on-demand via `ls`/`read_file` on `/skills/` — not auto-injected)
- Multi-agent orchestration: `explorer` / `coder` / `reviewer`
- Text CLI + Ink TUI; Go + Bubbletea release shell (Phase 5)
- macOS desktop automation (Chrome-first) via `desktop_automate`

## Quick start

```bash
git clone <your-repo-url>
cd Agent
cp .env.example .env
# fill ROUTER_API_KEY, ROUTER_BASE_URL, AGENT_MODEL

npm install   # also bootstraps empty .agent memory/session schema
npm run agent -- "List files in this workspace and summarize the project"
```

Personal chats, SQLite DBs, and `AGENTS.md` stay **local** (gitignored). After clone you get the same schema, empty stores, and project skills under `.agent/skills/`. See [.agent/memory/README.md](.agent/memory/README.md).

### Dev CLI options

```bash
npm run agent -- --cwd /path/to/project "Fix the failing tests"
npm run agent -- --yes "Explain package.json"   # auto-approve execute interrupts
npm run tui                                      # Ink TUI (live activity + PTY)
npm run tui -- --cwd ~/Documents/MyApp           # confine sandbox to that folder only
```

Workspace confinement: the agent can only read/write/exec inside the current allowlist (starts as `--cwd`). To open another laptop folder mid-session, the agent must call `request_folder_access` and you press **y/n**. Without `-y`, execute / edit / write / folder grants always ask approval.

### Environment

| Variable | Default | Description |
| --- | --- | --- |
| `ROUTER_BASE_URL` | `https://api.9router.com/v1` | OpenAI-compatible base URL |
| `ROUTER_API_KEY` | — | API key for 9router |
| `AGENT_MODEL` | `gpt-4o` | Model id (prefer ≥256k context) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings via 9router for LTM |
| `EMBEDDING_TIMEOUT_MS` | `20000` | Abort hung embedding requests |
| `CONTEXT_WINDOW_TOKENS` | `256000` | Effective context budget |
| `PTY_TIMEOUT_MS` | `60000` | Hard timeout per command |
| `AGENT_WORKSPACE` | `cwd` | Sandbox root |

## Memory layers

### 1. Persistent Memory (infrastructure / durability)

Deterministic storage that survives restarts — **not** dumped wholesale into the model context:

| Artifact | Path |
| --- | --- |
| Cognitive records + embedding blobs | `.agent/memory/persistent.sqlite` |
| LangGraph checkpoints | `.agent/memory/checkpoints.sqlite` |
| Active session state | `.agent/session.json` |
| Append-only raw transcripts | `.agent/memory/sessions/<thread>.jsonl` |
| Boot config snapshot | `.agent/memory/config-snapshot.json` |
| Rule mirror | `.agent/AGENTS.md` (local; starter = `AGENTS.md.example`) |
| Project skills | `.agent/skills/<name>/SKILL.md` (virtual `/skills/`) |

**GitHub hygiene:** commit code + skills + `AGENTS.md.example` + empty `.agent/memory` placeholders. Do **not** commit `.env`, `session.json`, `*.sqlite`, transcripts, task boards, or personal `AGENTS.md` — all gitignored. `npm install` runs bootstrap so clones get the same empty schema.

### Skills

Skills are **on-demand only** (not injected into every chat). Agent must `ls /skills/`, pick 1–3 folders, `read_file` those `SKILL.md` files, then `task_plan` → `task_todos` → execute → `task_verify`:

**Ops / this agent**

| Skill | Purpose |
| --- | --- |
| `skill-discovery` | How to ls/read skills without loading all |
| `desktop-chrome` | Chrome / YouTube / web UI via `desktop_automate` |
| `workspace-confinement` | Folder allowlist + `request_folder_access` |
| `terminal-pty` | Shell/`execute` patterns and failure recovery |
| `memory-ltm` | When to store/recall long-term memory |

**ECC-style coding (plan first)**

| Skill | Purpose |
| --- | --- |
| `plan-first` | Plan gate via `task_plan` after selective skill read |
| `coding-workflow` | ls → read few → plan → todos → execute → verify |
| `tdd-workflow` | RED → GREEN → REFACTOR, coverage targets |
| `coding-standards` | Immutability, small files, validation, minimal diffs |
| `verification-loop` | Typecheck/tests before "done" |
| `code-review` | Quality review checklist |
| `security-review` | Secrets, injection, auth, desktop/shell safety |
| `api-design` | REST resources, status codes, envelopes |
| `backend-patterns` | Service / repository layering |
| `frontend-patterns` | UI state, lists, a11y basics |
| `error-handling` | No silent failures; safe UX + logs |
| `debugging` | Reproduce → isolate → prove → fix |

Add more by creating `.agent/skills/<skill-name>/SKILL.md` (frontmatter `name` must match the folder).

### 2. Long-Term Memory (cognitive / selective)

Retrieves **top-K** memories for the current query using **hybrid semantic (cosine) + lexical** ranking, then injects only those into the system prompt.

- Tools: `memory_store`, `memory_recall`, `remember_rule`
- Auto **reflection/compression** after each turn stores episodes (and optional rules) without flooding context
- Falls back to lexical-only if embeddings are unavailable

## Architecture

```
CLI / TUI / Go binary
        │
        ▼
 createDeepAgent ──► ChatOpenAI (9router) + /embeddings
        │
        ├── PtySandbox (node-pty)
        ├── Summarization (85% / 15%)
        ├── Persistent Memory (session.json + JSONL + SQLite + checkpoints)
        ├── Long-Term Memory (hybrid RAG inject + auto-reflection)
        ├── AGENTS.md guidelines
        └── Subagents (explorer, coder, reviewer)
```

## Go binary (optional)

```bash
cd go
go build -o bin/agent ./cmd/agent
./bin/agent --help
```

The Go Bubbletea shell can spawn the TypeScript runtime (`npm run agent`) or an embedded runtime path via `AGENT_RUNTIME`.

## License

MIT
