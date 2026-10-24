#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, the web fixture app in a hidden Chromium, and the extension
# fixture loaded in a hidden Chromium through the extension harness.
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile >/dev/null
bun run typecheck
bun run lint
bun test
bash scripts/e2e.sh
bun test ./extension/e2e/harness.e2e.ts
