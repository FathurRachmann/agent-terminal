---
name: graphify
description: "Use project Graphify knowledge graph (graphify-out/) for architecture and codebase relationship questions — same pattern as Cursor. Prefer graphify_query before broad grep when the graph exists."
---

# Graphify (project-scoped)

This project's knowledge graph lives at **`<project>/graphify-out/`** (not in the chat session).

## When to use

- "How does X work?"
- "What calls Y?"
- "Trace data flow through Z"
- Architecture / module relationship questions

## Workflow (Cursor-style)

1. Call `graphify_status` for the active project.
2. If `ready: false` → `graphify_update` once, then continue.
3. If `ready: true` → **`graphify_query "<question>"` first** (do not start with full `GRAPH_REPORT.md`).
4. Use `graphify_path "A" "B"` for shortest path between concepts.
5. Use `graphify_explain "Concept"` for a node + neighbors.
6. After substantial code edits, call `graphify_update` to refresh (AST-only).

## Do not

- Dump the entire graph or huge GRAPH_REPORT into the user reply
- Treat the graph as session memory — it belongs to the **project**
- Skip the graph when it exists and the question is architectural
