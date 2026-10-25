// The types of playwright-webkit.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.

/**
 * Launch options that run Playwright's WebKit from a copy macOS keeps out of the Dock, for a WebKit project's
 * `launchOptions`. The copy is made once per WebKit version, in `cacheFolder` (app-kit's own folder under
 * ~/Library/Caches by default). Off macOS, or with WebKit not installed, it returns no options and Playwright starts
 * its own WebKit; a step of making the copy that fails throws.
 */
export function webkitWithoutDockIcon(cacheFolder?: string): { executablePath?: string };
