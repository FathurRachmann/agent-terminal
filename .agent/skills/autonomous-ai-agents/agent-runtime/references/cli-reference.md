# Agent CLI Reference

Live sources when anything looks stale: `agent --help`, `agent <command> --help`,
https://docs.example.com/agent/docs/reference/cli-commands

### Global Flags

```
agent [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
agent chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
agent setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
agent model                Interactive model/provider picker
agent fallback [add|remove|list]  Fallback provider chain
agent config [show|edit|get|set|unset|path|env-path|check|migrate]
agent login / logout       OAuth sign-in / clear stored auth
agent doctor [--fix]       Check dependencies and config
agent status [--all]       Component status
```

### Tools & Skills

```
agent tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

agent skills list|browse|search QUERY|inspect ID
agent skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
agent skills config        Enable/disable skills per platform
agent skills check|update|uninstall|publish PATH
agent skills tap add REPO  Add a GitHub repo as a skill source
agent bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
agent mcp add NAME (--url or --command) | remove | list | test NAME
agent mcp catalog | install NAME     Curated catalog install
agent mcp configure NAME             Toggle tool selection
agent mcp serve                      Run Agent as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
agent gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `agent photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://docs.example.com/agent/docs/user-guide/messaging/

### Sessions

```
agent sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
agent cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
agent webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
agent profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
agent profile rename A B | alias NAME | export NAME | import FILE
```

### Credentials & Pools

```
agent auth                 Interactive credential manager
agent auth add [PROVIDER]  Add OAuth or API-key credential (nous, openai-codex, qwen-oauth, …)
agent auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
agent desktop / gui        Native desktop app
agent dashboard            Web admin panel + embedded chat (--stop / --status)
agent proxy                OpenAI-compatible local proxy backed by an OAuth provider
agent portal               Quick setup / sign in via Nous Portal
agent kanban <verb>        Multi-agent work-queue board
agent project              Named multi-folder workspaces
agent skin list|use|set    Switch/tweak skins (see references/themes.md)
agent pets <verb>          Pet mascots (see references/petdex.md)
agent memory setup|status|off|reset   Memory provider
agent secrets bitwarden|onepassword   External secret stores
agent moa                  Mixture-of-Agents slots
agent hooks / security / backup / import / checkpoints / console
agent logs [-f] [errors]   View agent/error logs
agent send                 One-off message through a gateway platform
agent pairing / plugins / insights / journey / computer-use
agent acp                  ACP server (IDE integration)
agent completion bash|zsh|fish
agent update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `agent photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `agent config edit` · [Configuration docs](https://docs.example.com/agent/docs/user-guide/configuration) |
| Tools / toolsets | `agent tools list` · [Tools reference](https://docs.example.com/agent/docs/reference/tools-reference) |
| Skills catalog | `agent skills browse` · [Skills catalog](https://docs.example.com/agent/docs/reference/skills-catalog) |
| Provider setup | `agent model` · [Providers guide](https://docs.example.com/agent/docs/integrations/providers) |
| Env variables | `agent config env-path` · [Env vars reference](https://docs.example.com/agent/docs/reference/environment-variables) |
| Gateway logs | `~/.agent/logs/gateway.log` (or `agent logs`) |
| Sessions | `agent sessions browse` (reads state.db) |
