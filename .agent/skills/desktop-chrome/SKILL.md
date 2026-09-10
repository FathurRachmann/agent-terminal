---
name: desktop-chrome
description: >-
  Controls Google Chrome on macOS via desktop_automate (open_url, keystroke,
  youtube_play_first). Use when the user asks to open Chrome/YouTube/WhatsApp/web
  sites, play videos/songs, type in the browser, or automate desktop UI without a mouse.
---

# Desktop Chrome (macOS)

## When to use

- User says buka / open / setel / play for Chrome, YouTube, WhatsApp Web, etc.
- Any request to control the browser without clicking manually.

## Rules

1. **Never refuse** with "I cannot open Chrome/apps". You have `desktop_automate`.
2. Prefer **structured tools** over raw `osascript` / shell (raw osascript is blocked).
3. Default allowlisted app is **Google Chrome**. Other apps need `request_desktop_app_access` + human **y/n**.
4. Mutating actions need human approval unless `--yes`.

## Tool cheatsheet

| Goal | Call |
|------|------|
| Open a URL | `desktop_automate` `{ action: "open_url", app: "Google Chrome", url: "https://…" }` |
| Open / focus Chrome | `desktop_automate` `{ action: "open_app" \| "activate_app", app: "Google Chrome" }` |
| Type / shortcuts | `desktop_automate` `{ action: "keystroke", app: "Google Chrome", text: "…", modifiers?: ["cmd"] }` |
| Play first YouTube result | `desktop_automate` `{ action: "youtube_play_first", app: "Google Chrome" }` |
| Grant another app | `request_desktop_app_access` `{ appName: "Safari" }` |
| List allowlist | `show_desktop_apps` |

## YouTube + music workflow

1. Prefer search URL: `https://www.youtube.com/results?search_query=<query>`
2. Wait for page load, then `youtube_play_first`
3. If click fails: ask user to enable Chrome **View → Developer → Allow JavaScript from Apple Events**
4. Keystroke needs **Accessibility** permission for Terminal/Cursor

## Multi-step requests

If the user asks "open X **and** do Y", finish **both**. Do not stop after only opening the URL.

## Do not

- Invent mouse coordinates / screenshots as the primary method
- Use `execute` with `osascript`
- Store secrets typed via keystroke into memory
