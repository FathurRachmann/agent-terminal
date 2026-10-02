# RTK (default shell proxy)

Supported `execute` commands are rewritten to `rtk --ultra-compact …` in `PtySandbox`
(`src/sandbox/rtk-proxy.ts`). Disable with `RTK_PROXY=0`.

Covered: ls, tree, find, git, gh, npm/npx/pnpm, tsc, lint/eslint, vitest/jest,
docker, kubectl, curl/wget, grep/rg, cat *.json → json, cat *.log → log, …
