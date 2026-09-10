---
name: workspace-confinement
description: >-
  Keeps file and shell access inside the allowlisted folders. Use when the user
  names a path outside the workspace, requests another project folder, or tools
  fail with path/allowlist errors. Guides request_folder_access HITL.
---

# Workspace Confinement

## When to use

- User mentions `~/…`, `/Users/…`, Desktop, Documents, or another project path
- Tools report path outside allowlist / permission denied
- User asks to work on a different folder mid-session

## Rules

1. Shell + filesystem tools only touch **allowlisted roots** (starts as `--cwd`).
2. Before reading/writing/executing outside the current allowlist, call **`request_folder_access`** and **wait for y/n**.
3. After approval, confirm with `show_allowed_folders`.
4. Do not invent workarounds (`cd` outside, `cat /etc/passwd`, symlink tricks).

## Workflow

1. Detect absolute or `~/` path in the user message
2. `request_folder_access({ folderPath: "…" })`
3. Wait for human approval
4. Continue the task inside the granted folder

## Tools

- `request_folder_access` — HITL expand allowlist
- `show_allowed_folders` — current roots + cwd
- `ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep` / `execute` — confined

## Note

Desktop app control (`desktop_automate`) uses a **separate** app allowlist — not the folder allowlist.
