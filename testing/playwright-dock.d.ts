// The types of playwright-dock.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.

/**
 * Launch options that run a Playwright browser from a copy macOS keeps out of the Dock: `withoutDockIcon(chromium)`
 * for a launch that starts Playwright's full Chromium (the `chromium` channel, as every test that loads an extension
 * does), `withoutDockIcon(webkit)` for WebKit. The copy is made once per browser version, in `cacheFolder`
 * (`~/Library/Caches/app-kit/playwright-<browser>` by default). Off macOS, or with the browser not installed, it
 * returns no options and Playwright starts its own browser; a step of making the copy that fails throws.
 */
export function withoutDockIcon(browserType: { name(): string; executablePath(): string }, cacheFolder?: string): { executablePath?: string };
