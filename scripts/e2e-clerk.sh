#!/usr/bin/env bash
# The kit's browser test against the App Kit Clerk development instance (authentication/clerk/e2e): five signed-in tests
# on one user the worker signs in once, against the same five making a user each, with the calls to Clerk counted.
# Reads the instance's keys from 1Password's agents vault, which needs no prompt; needs the network and Playwright's
# Chromium. The gates run it when a change touches the Clerk steps or Clerk's packages. Arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
item="op://agents/Clerk secret key app-kit development"
CLERK_SECRET_KEY=$(op read "$item/credential")
CLERK_PUBLISHABLE_KEY=$(op read "$item/publishable key")
export CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY bunx vite build authentication/clerk/e2e/page --logLevel warn
free_port() { bun -e 'const s = Bun.serve({ port: 0, fetch: () => new Response() }); process.stdout.write(String(s.port)); s.stop(true);'; }
export E2E_PORT=$(free_port)
cd authentication/clerk/e2e && bunx playwright test --config playwright.config.ts "$@"
