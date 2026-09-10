---
name: security-review
description: >-
  Security checklist for auth, input validation, secrets, injection, XSS, and
  unsafe shell/desktop automation. Use when touching credentials, user input,
  HTTP APIs, or desktop keystroke flows.
---

# Security Review

## Always check

- [ ] No secrets in source, logs, memory, or AGENTS.md
- [ ] Input validated/sanitized at trust boundaries
- [ ] Parameterized queries / no string-built SQL
- [ ] Authn + authz on sensitive operations (server-side)
- [ ] Errors don't leak stack traces or tokens to users
- [ ] Dependencies not obviously malicious / abandoned for sensitive paths

## Web / API

- XSS: don't render unsanitized HTML
- CSRF: cookie sessions need protection
- SSRF: don't fetch user-controlled URLs without allowlists
- Path traversal: resolve + confine to allowlisted roots

## This agent specifically

- Workspace confinement: no bypass of folder allowlist
- Desktop: no arbitrary AppleScript; only `desktop_automate` actions
- Keystrokes: never type secrets into memory stores
- `execute`: blocked patterns (rm -rf /, curl|sh, raw osascript)

## If CRITICAL found

1. Stop feature work
2. Fix or gate the issue
3. Rotate any exposed secret (tell the user)
