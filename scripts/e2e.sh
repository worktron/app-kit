#!/usr/bin/env bash
# The browser tests (web/e2e/kit.e2e.ts): the fixture app, built as a deploy builds it, in a hidden Chromium on a free port.
# dock.e2e.ts starts the kit's WebKit too, and offline-audio.e2e.ts starts Chromium and the kit's WebKit with macOS's audio
# service recorded, which needs swiftc (Xcode's command line tools). Needs Playwright's Chromium and WebKit: bunx playwright install chromium webkit.
# Arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
free_port() { bun -e 'const s = Bun.serve({ port: 0, fetch: () => new Response() }); process.stdout.write(String(s.port)); s.stop(true);'; }
bunx vite build web/e2e/fixture --logLevel warn
export E2E_PORT=$(free_port)
cd web/e2e && bunx playwright test --config playwright.config.ts "$@"
