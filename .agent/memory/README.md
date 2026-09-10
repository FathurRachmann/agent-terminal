# Local memory & session (not committed)

This directory is **local-only**. Git ignores `*.sqlite`, session transcripts, and config snapshots so personal chats never land on GitHub.

## What gets created automatically

On `npm install` (postinstall) and on first `npm run agent`:

| Path | Role |
| --- | --- |
| `persistent.sqlite` | Long-term cognitive memory (`memories` table + embeddings) |
| `checkpoints.sqlite` | LangGraph thread checkpoints (created when checkpointer is enabled) |
| `sessions/*.jsonl` | Append-only raw transcripts |
| `config-snapshot.json` | Boot config mirror |
| `../session.json` | Active thread pointer |
| `../AGENTS.md` | Rule/preference mirror (from `AGENTS.md.example` if missing) |

## Schema (same as this project)

`persistent.sqlite` → table `memories`:

- `id`, `kind`, `title`, `content`, `tags`
- `importance`, `created_at`, `updated_at`, `last_accessed_at`, `access_count`
- `embedding` (BLOB, optional)

Created with `CREATE TABLE IF NOT EXISTS` — empty DB, identical schema.

## Fresh clone checklist

```bash
cp .env.example .env   # add your keys
npm install            # bootstrap empty dirs + schema
npm run agent -- "hello"
```
