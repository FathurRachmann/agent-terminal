# Go release shell for Agent Terminal
#
# Build:
#   cd go && go mod tidy && go build -o bin/agent ./cmd/agent
#
# The shell spawns the TypeScript runtime via `npm run agent -- -t` (text mode).
# Override with AGENT_RUNTIME.
# For a single-binary release, compile the TS agent (e.g. bun build --compile)
# and set AGENT_RUNTIME, or embed the runtime under go/runtime/ and point to it.
