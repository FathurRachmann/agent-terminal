# Agent Terminal — Codebase Directory & Modular Architecture Map

Dokumen arsitektur ini memetakan seluruh modul, direktori, dan batasan tanggung jawab (*Separation of Concerns*) pada codebase Agent Terminal untuk memudahkan navigasi kode, pemeliharaan (*maintenance*), dan referensi skills/tools.

---

## 1. Top-Level Directory Layout

```text
Agent/
├── .agent/                 # Konfigurasi runtime, skills katalog, templates, & local memory
├── scripts/                # Script build, bootstrap, ABI native switcher, dan test helper
├── dist/                   # Build output untuk Electron & CLI
├── src/                    # Source code utama (TypeScript)
│   ├── agent/              # Core Agent orchestrator, presets, middleware, & tool registry
│   ├── cli/                # Terminal CLI & Ink TUI interface
│   ├── decision/           # LLM decision loop, HITL run mode classifiers, approval guards
│   ├── desktop/            # Desktop automation bindings (macOS / Chrome)
│   ├── desktop-app/        # Electron main process, IPC handlers, preload, & React renderer
│   ├── memory/             # Persistent SQLite store, vector embeddings, & long-term memory
│   ├── model/              # Model provider adapters & LangChain model factories
│   ├── model-hub/          # Model catalog & capability profiling
│   ├── prompts/            # System prompts, skill instructions, & template builders
│   └── sandbox/            # PTY sandbox, execution containment, guardrails, & rtk proxy
└── tmp/                    # Output artefak (terisolasi per session/scope: global/bots/project)
```

---

## 2. Module Responsibilities & Boundary Map

| Direktori | Tanggung Jawab Utama | Komponen Kunci |
|---|---|---|
| **`src/agent/`** | Orchestrator ReAct loop, middleware pipeline, skill registry, tool filtering, dan bot session manager. | `create-agent.ts`, `skill-registry.ts`, `capabilities-catalog.ts`, `bot-manager.ts` |
| **`src/sandbox/`** | Eksekusi shell berbasis persistent PTY (`node-pty`), isolasi workspace, path containment, destructive guardrails, dan proxy token optimizer (`rtk`). | `pty-sandbox.ts`, `guardrails.ts`, `rtk-proxy.ts` |
| **`src/memory/`** | Penyimpanan sesi persistent (SQLite), embedding semantic search, ringkasan kontekstual, dan personalisasi jangka panjang (`AGENTS.md`). | `persistent-store.ts`, `embeddings.ts`, `reflection.ts`, `guideline.ts` |
| **`src/decision/`** | Safety decision classification, human-in-the-loop (HITL) approval, auto-review steering, dan command analyzer. | `run-mode-approval.ts`, `classifier.ts` |
| **`src/desktop-app/`** | Desktop GUI (Electron + React), activity canvas, chat composer, file delivery cards, kanban board, dan WhatsApp bridge. | `main.ts`, `preload.cjs`, `renderer/App.tsx`, `file-delivery-shared.ts` |
| **`src/desktop/`** | Otomasi browser native (macOS Chrome automation, keystroke, window inspection). | `desktop-automate.ts` |
| **`src/model/` & `src/model-hub/`** | Integrasi AI Provider (OpenAI/Router compatible), streaming callback, model registry. | `factory.ts`, `catalog.ts` |
| **`src/prompts/`** | Definisi system prompt inti, petunjuk skills on-demand, dan prompt compiler. | `system-prompt.ts`, `guidelines.ts` |
| **`src/cli/`** | Text-based CLI & Ink TUI renderers untuk interaksi langsung lewat terminal. | `index.ts`, `tui.tsx` |

---

## 3. Aturan Pemeliharaan (Maintenance & Extension Guidelines)

1. **Tool & Skill Discovery**:
   - Seluruh skills didefinisikan dalam `.agent/skills/<nama>/SKILL.md`.
   - Tool execution dan guardrails harus selalu melalui layer `src/sandbox/` dan `src/agent/` tanpa mem-bypass containment check.
2. **File Deliverables & Artifacts**:
   - Semua output generate file user harus dialokasikan ke `tmp/` (misal: `tmp/bots/`, `tmp/global/`, `tmp/project/<id>/`).
   - Jangan pernah menulis output transient langsung ke dalam source tree `src/`.
3. **Electron & Native Modules**:
   - `node-pty` dan `better-sqlite3` memerlukan ABI khusus tergantung target runtime (`npm run rebuild:electron` vs `npm run rebuild:node`).
