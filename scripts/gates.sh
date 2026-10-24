#!/usr/bin/env bash
# The gates a landing runs: typecheck, lint, the unit tests, and the fixture app in a hidden Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
bun install --frozen-lockfile >/dev/null
bun run typecheck
bun run lint
bun test
bash scripts/e2e.sh
