# testing/

testing/ what every kind's tests share: start-up.ts (app-kit/testing/start-up), the test start-up file a project names in bunfig.toml's preload, which the kit's own bunfig.toml names too; playwright-dock.js (app-kit/testing/playwright-dock), a Playwright browser run from a copy macOS keeps out of the Dock, which web/playwright-webkit.js and the extension harness use; test/applications.ts watches macOS's application list for the Dock tests, web/e2e/dock.e2e.ts and extension/e2e/dock.e2e.ts
