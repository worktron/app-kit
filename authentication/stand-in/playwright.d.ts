// The types of playwright.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.
import type { Locator, Page } from '@playwright/test';

export { STAND_IN_CODE } from './code.js';

/** Brings the page back in front, as a phone does when the home-screen app returns, undoing a `hidePage`. */
export function showPage(page: Page): Promise<void>;

/**
 * Hides the page, as when the person switches to another tab or app: `document.visibilityState` reads `hidden` and
 * `document.hidden` reads true.
 */
export function hidePage(page: Page): Promise<void>;

/**
 * The phone locked for `ms` and unlocked: the page hides, its clock jumps `ms` ahead of the page's own time with no
 * timer fired, as a locked phone runs none, and the page shows again. Needs `page.clock.install()` before the page
 * loads, and throws without it. `performance.now()` and an audio context's time do not move.
 */
export function lockFor(page: Page, ms: number): Promise<void>;

/**
 * Serves the index page as a newer deploy would: the same page, naming another built entry. Throws when the page names
 * no module script under /assets/ to rename. `stop` serves the real page again, as a reload gets once the deploy is live.
 */
export function serveNewerBuild(page: Page): Promise<{ stop: () => Promise<void> }>;

export interface SignInByCodeOptions {
  /** The code to type. `STAND_IN_CODE` by default, which Clerk's development instance takes too, for a +clerk_test address. */
  code?: string;
  /** The app's email field, when it is not a textbox named Email. */
  emailField?: Locator;
  /** The app's code field, when it is not a textbox named Code. */
  codeField?: Locator;
  /** False for a code field that signs in by itself at its last digit. True by default: Enter is pressed after the code. */
  submit?: boolean;
}

/**
 * Signs in on the app's own sign-in screen by emailed code: types the address and presses Enter, then types the code
 * and presses Enter. Against Clerk's development instance the address must have +clerk_test in it, the page needs
 * Clerk's testing token first (`setupClerkTestingToken` from `@clerk/testing/playwright`), and Clerk takes only a few
 * sign-ins a minute.
 */
export function signInByCode(page: Page, email: string, options?: SignInByCodeOptions): Promise<void>;
