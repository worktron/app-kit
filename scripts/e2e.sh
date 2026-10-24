#!/usr/bin/env bash
# The browser tests (e2e/kit.e2e.ts): the fixture app, built as a deploy builds it, in a hidden Chromium on a free port.
# Needs Playwright's Chromium: bunx playwright install chromium. Arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
free_port() { bun -e 'const s = Bun.serve({ port: 0, fetch: () => new Response() }); process.stdout.write(String(s.port)); s.stop(true);'; }
bunx vite build e2e/fixture --logLevel warn
export E2E_PORT=$(free_port)
cd e2e && bunx playwright test --config playwright.config.ts "$@"
