---
name: terminal-pty
description: >-
  Runs shell commands in the persistent PTY sandbox. Use for builds, git, package
  managers, tests, logs, and interactive prompts. Prefer execute over guessing;
  handle non-zero exits and awaiting-input states.
---

# Terminal PTY

## When to use

- Build / test / lint / install
- Git status, logs, process inspection
- Any evidence-gathering that needs a real shell

## Rules

1. Use **`execute`** for shell work (stateful PTY — cwd/env persist).
2. Stay inside allowlisted folders (see skill `workspace-confinement`).
3. On **non-zero exit**, read stderr, fix, retry with a different command — do not loop the same failure.
4. If output says awaiting input (`[y/N]`, password), either send stdin on the next call or ask the user.
5. Destructive commands (`rm -rf`, `git reset --hard`, force push) require approval unless `--yes`.
6. Never run `osascript` via execute — use `desktop_automate`.

## Patterns

- Inspect first: `ls`, `git status`, `cat`/`read_file` relevant files
- Prefer project scripts: `npm test`, `npm run lint`, `pytest`, etc.
- Keep commands focused; avoid huge unbounded dumps when a targeted query works

## Tools

- `execute` — primary shell tool (HITL for risky commands)
- Filesystem tools for edits; verify with execute after changes
