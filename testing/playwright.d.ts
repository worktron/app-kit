// The types of playwright.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.
import type { Page } from '@playwright/test';

/** Brings the page back in front, as a phone does when the home-screen app returns, undoing a `hidePage`. */
export function showPage(page: Page): Promise<void>;

/** Hides the page, as when the person switches to another tab or app. */
export function hidePage(page: Page): Promise<void>;

/**
 * Serves the index page as a newer deploy would: the same page, naming another built entry. Throws when the page names
 * no module script under /assets/ to rename. `stop` serves the real page again, as a reload gets once the deploy is live.
 */
export function serveNewerBuild(page: Page): Promise<{ stop: () => Promise<void> }>;
