---
name: agent-tool-extension
description: "Use when extending a Node.js LangGraph agent with new tools."
category: software-development
tags: [langgraph, deepagents, agent-builder, tool-integration, typescript, nodejs]
agent:
  name: agent-tool-extender
  description: "Design and wire new LangChain tools into create-agent (HITL, tests, parity)."
  systemPrompt: |
    You are an agent-tool extension specialist for this Node.js Deep Agents codebase.
    Prefer surgical diffs in src/agent/, follow existing tool() + interruptOn patterns,
    and return: files to touch, schema sketch, and test cases. Do not invent new deps.
---

# Agent Tool Extension

Patterns for adding tools, desktop control, web capabilities, orchestration, and skill mounts to a Node.js/TypeScript agent built on LangGraph + deepagents.

## Always-On Rules

- **Feature parity is the bar.** When extending an agent to match another agent's capabilities, implement the missing feature — don't explain why the current set is "good enough."
- **Zero new deps when possible.** DuckDuckGo HTML scraping for search, native `fetch` for extraction, `osascript` for macOS control. Only add a package if the stdlib/native approach genuinely fails.
- **HITL for anything destructive or global.** Add every new tool that modifies state or controls the UI to the `interruptOn` map in `createDeepAgent()`. The user approves before execution.
- **Build before finish.** After every tool addition, run `npm run build` (tsc) and `npm run test:unit` to catch type errors and regressions.
- **Tools follow the langchain `tool()` pattern.** Import `tool` from `"langchain"`, define with `z.object` schema, export a `createXxxTools()` factory returning `Tool[]`.

## Procedure: Adding a New Tool Set

1. Create `src/<category>/<name>.ts` exporting `createXxxTools(): Tool[]`.
2. Each tool uses `tool(async (args) => { ... }, { name, description, schema: z.object({...}) })`.
3. In `src/agent/create-agent.ts`:
   - Import `createXxxTools`.
   - Spread into the `tools: [...]` array in `createDeepAgent()`.
   - If tool requires approval: add `tool_name: true` to the `interruptOn` object.
4. Update `src/prompts/system.ts` to list the new tools in the `Tools:` section.
5. Run `npm run build && npm run test:unit`.

## Reference: Skill Authoring Tool (skill_manage)

Allows the agent to programmatically create, patch, or delete skills under `.agent/skills/<name>/SKILL.md`:
- **create**: write new `SKILL.md` with YAML frontmatter + markdown body.
- **patch**: targeted `oldString`/`newString` replacement or full overwrite of an existing skill.
- **delete**: remove skill directory.

## Reference: Process Supervisor (process_manage)

Manage long-lived dev servers or background workers using `node:child_process.exec`:
- **start**: spawn child process, buffer stdout/stderr (cap at 200 lines to prevent memory leaks), store PID.
- **list**: show active managed PIDs and commands.
- **poll**: return recent log buffer for a specific PID.
- **kill**: send SIGTERM or `kill -9` to PID and remove from managed map.

## Reference: Vault & Credentials Manager (vault_store / vault_get)

Secure credential management encrypting secrets at rest with AES-256-GCM:
- PBKDF2 sync key derivation (`crypto.pbkdf2Sync`) with salt and master secret.
- **vault_store**: Encrypt credentials into JSON payload (IV + Auth Tag + Encrypted Hex Data) and write to `.agent/vault/credentials.enc`.
- **vault_list**: Return service and identifier list with secret values masked (`[MASKED N chars]`).
- **vault_get**: Decrypt AES-256-GCM payload and return secret value for runtime tool execution.
- **vault_delete**: Remove target credential entries.

## Reference: Full Playwright Browser Engine (playwright-tools)

Headless browser automation via `@playwright/test` or `playwright`:
- **browser_open**: Open URL in headless Chromium, await `domcontentloaded`, return title & innerText content sample.
- **browser_click**: Click CSS selectors (`button:has-text("...")`).
- **browser_type**: Fill input elements via `page.fill(selector, text)`.
- **browser_eval**: Evaluate custom JS expressions in page context (`page.evaluate()`).
- **browser_screenshot**: Capture full-page PNG screenshot and output base64 or save to path.

## Reference: Multimodal Vision Tools (vision_analyze)

Inspect local PNG/JPEG/WebP images and screenshots:
- Convert local file to base64 `data:image/png;base64,...` data URL.
- Send payload via `@langchain/openai` `ChatOpenAI` using `HumanMessage` with `{ type: "image_url", image_url: { url } }`.
- Supports vision-capable 9router models (`gemini-2.0-flash`, `gpt-4o`).

## Reference: Electron Desktop App Architecture (main + preload.cjs + React)

Porting a Node.js agent engine (`createTerminalAgent`) into a native desktop GUI:
- **Main Process (`main.ts`)**: Boots Electron window (`BrowserWindow`), imports agent engine directly in Node.js main thread, registers IPC handles (`agent:sendPrompt`, `agent:getStatus`, `agent:getBots`).
- **Preload Bridge (`preload.cjs`)**: CommonJS script exposing `window.electronAgent` to renderer via `contextBridge.exposeInMainWorld`.
- **React Renderer (`renderer/App.tsx`)**: React UI with Sidebar, Message Stream, and Input bar.
- **Build Chain**: `tsc -p tsconfig.json && vite build && node scripts/copy-desktop-preload.js`. `main.ts` loads static `dist/renderer/index.html` directly via `mainWindow.loadFile()`.

## Reference: Bots & Personas System (.agent/bots.json)

Manage custom agent roles/personas with system prompts and tool subsets:
- Store bot definitions in `.agent/bots.json` (`id`, `name`, `description`, `systemPrompt`, `tools`).
- Expose IPC handlers `agent:getBots` and `agent:setActiveBot`.
- When active bot has `systemPrompt`, prepend to prompt before invoking model: `[SYSTEM INSTRUCTION FROM BOT "${bot.name}"]: ${bot.systemPrompt}\n\n[USER PROMPT]: ${prompt}`.
- Separate UI concerns cleanly: Use top-level tab navigation (`SESSIONS` vs `BOTS`) in the desktop sidebar rather than mixing persona configuration directly inside active chat session lists.
- Thread isolation per bot & session: Isolate memory threads (`threadId`) per session/bot combination (e.g. `desktop-${Date.now()}` or `desktop-session-${activeBotId}`) so custom persona turns do not pollute general session execution history.

## Pitfalls

- **Mixing persona dropdown with session history in desktop UI.** Combining bot configuration controls into the active session panel confuses persona configuration with chat thread execution. Implement a top-level tab toggle (`SESSIONS` | `BOTS`) in the sidebar so session management and bot definitions are isolated into dedicated views.
- **Electron Preload CJS with ES Modules (`"type": "module"`).** When `package.json` specifies `"type": "module"`, Electron preload scripts cannot use ESM `import` statements natively without bundler configuration. Write `preload.cjs` in CommonJS format using `require("electron")` and `contextBridge.exposeInMainWorld()`.
- **Vite Electron Blank Screen on Launch.** Hardcoding `mainWindow.loadURL("http://localhost:5173")` causes a blank screen if Vite dev server is not running. Always pair `vite build` into `dist/renderer/` and load static `dist/renderer/index.html` via `mainWindow.loadFile(...)` in production/fallback mode.
- **Playwright Local Dependency.** When adding Playwright tools to a Node project, ensure `playwright` package is installed locally in `package.json` (`npm install playwright`) so TypeScript imports resolve cleanly. Chromium cache lives in `~/Library/Caches/ms-playwright/`.
- **Vision Data URL MIME Types.** When building base64 data URLs for multimodal LLMs, map file extensions explicitly (`.png` -> `image/png`, `.jpg`/`.jpeg` -> `image/jpeg`, `.webp` -> `image/webp`). Unsupported MIME types cause gateway API rejection.
- **AES-256-GCM Vault Authentication Tag.** Always verify and set the GCM auth tag (`decipher.setAuthTag(...)`) prior to calling `decipher.final()`. Omitting tag validation exposes vault files to tampering.

- **Process management log buffering.** Long-lived background processes started via `child_process.exec` must cap log line arrays (e.g. max 200 lines) to prevent unbounded memory growth while streaming stdout/stderr.
- **Dynamic skill authoring via `skill_manage`.** The agent needs an explicit tool to perform CRUD operations on `.agent/skills/` so it can store procedural learnings programmatically rather than relying solely on memory reflection.
- **TypeScript union narrowing after guards.** When `requireApp()` returns `{ ok: true; name: string } | { ok: false; message: string }` and you guard with `if (!res.ok) return res`, TS still sees the full union in the `else` branch. Fix: destructure with explicit cast `const { name } = res as { ok: true; name: string };`. Do NOT use `app.name` directly — TS will error.
- **CompositeBackend has no direct file methods.** `backend.readDir()`, `backend.readFile()`, `backend.getTools()`, `backend.lsInfo()`, `backend.readFiles()` do NOT exist on `CompositeBackend`. Tools (ls, read_file, etc.) are registered in deepagents' tool registry and invoked by the agent during its loop — not via backend method calls. To test virtual FS mounts, invoke tools through a minimal agent instance, not the backend directly.
- **Deepagents Tool Invocation in Tests.** You cannot directly extract tools from `CompositeBackend`. To test tools programmatically, use `backend.invokeTool(toolName, args)` if available, or test through the agent's invoke/stream methods. Do NOT attempt to read `backend.tools` or `backend.getTools()` directly as they are private or non-existent properties on `CompositeBackend`.
- **Virtual skill mount is passive.** The mount at `/skills/` maps to `.agent/skills/` on disk via `FilesystemBackend({ rootDir, virtualMode: true })`. The agent must call `ls /skills/` and `read_file /skills/<name>/SKILL.md` during its loop — skills are NOT auto-injected into the system prompt. The system prompt must instruct this discovery pattern.
- **DuckDuckGo HTML parsing is fragile & fetch can fail.** DuckDuckGo blocks default Node `fetch` user-agents with `fetch failed`. Always include a Chrome User-Agent header and a `curl -sL` shell fallback. Parse with multiple fallback patterns (`result__a` and `result__snippet`).
- **Upstream model deactivation / rotation errors.** Router gateways (like 9router) can return plain-text errors such as "Model X is no longer available" as assistant text rather than throwing errors. Add regex detection (`isModelAvailabilityError`) and an automatic retry loop with delay (3s+) to wait for gateway rotation instead of terminating the turn.
- **Working directory isolation for agent artifacts.** Enforce in system prompts that all generated files, scratch scripts (e.g. `analyzer.py`), and test outputs MUST be created inside a dedicated `working/` directory, keeping the project root and `src/` clean.
- **Native C++ module version mismatch (better-sqlite3 / node-pty).** Node version upgrades break pre-built `.node` binaries (`NODE_MODULE_VERSION` mismatch). Fix by running `npm install <pkg> --build-from-source` or `npm rebuild`, followed by any project fixup scripts (e.g. `scripts/fix-node-pty.js`).
- **Agent CLI aesthetic for terminal/Ink interfaces.** For clean CLI UI without heavy dependencies: use ANSI color escapes for header banners, badge-style tool call highlights (`[TOOL: name]`), and vertical stream layout instead of fixed split-pane boxes.
- **macOS `computer_use` requires Accessibility permission.** `osascript` System Events keystroke/key code fails silently or throws without it. Prompt the user to grant in System Settings > Privacy > Accessibility for the terminal app.
- **`cliclick` is optional but strongly recommended** for mouse clicks. Without it, the CGEvent fallback via osascript JS is less reliable and coordinate-precise. Install via `brew install cliclick`.

## Reference: deepagents Virtual FS Mount

```typescript
import { CompositeBackend, FilesystemBackend } from "deepagents";
import { PtySandbox } from "../sandbox/pty-sandbox.js";

const sandbox = new PtySandbox({ workingDirectory: workspaceRoot });
const skillsDir = path.join(workspaceRoot, ".agent", "skills");
const backend = new CompositeBackend(sandbox, {
  ["/skills/"]: new FilesystemBackend({ rootDir: skillsDir, virtualMode: true }),
});
```

The agent discovers skills at runtime via system prompt instructions:
1. `ls /skills/` — list available skill folders
2. `read_file /skills/<name>/SKILL.md` — load only needed skills
3. Never bulk-read all skills at once

## Reference: Web Tools (Zero Deps)

- **web_search**: Fetch `https://html.duckduckgo.com/html/?q=<query>`, parse `result__a` and `result__snippet` blocks.
- **web_extract**: `fetch(url)` + strip HTML tags with regex. No DOM parser needed for text extraction.
- Both use native `fetch` (Node 18+). No npm packages required.

## Reference: macOS Computer Use (Zero Deps)

- **Screenshot**: `screencapture -x <path>` — no deps, instant.
- **Type**: `osascript -e 'tell application "System Events" to keystroke "text"'` — needs Accessibility.
- **Key**: `osascript -e 'tell application "System Events" to key code <code>'` — special keys via `key "return"`, `key "tab"`, etc.
- **Click**: `cliclick c:<x>,<y>` if installed; fallback to CGEvent via `osascript -l JavaScript`.

## Reference: Orchestration (delegate_task)

Parallel sub-agent delegation using the same model:
```typescript
const model = createRouterModel(); // same 9router model
const results = await Promise.all(tasks.map(task =>
  model.invoke([new SystemMessage(task.systemPrompt), new HumanMessage(task.goal)])
));
```
No additional model config needed — reuses the existing 9router/OpenAI-compatible endpoint.