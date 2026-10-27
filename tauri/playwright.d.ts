// The types of playwright.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.
import type { Page } from '@playwright/test';

/** An iPhone's user agent, which the kit's iPhone halves need to run: `test.use({ userAgent: IPHONE_USER_AGENT })`. */
export const IPHONE_USER_AGENT: string;

export interface FakeTauriOptions {
  /** The iPhone notifications plugin: permission `granted` (true by default), and the token and Apple environment it gives. */
  iphoneNotifications?: { granted?: boolean; token?: string; environment?: 'development' | 'production' };
  /**
   * The iPhone sign-in plugin's sheet, which closes on the app's sign-in link carrying `ticket` and the nonce the page
   * asked with (`asked`), another one (`other`), or is closed by the person (`cancel`), which the plugin rejects.
   */
  iphoneSignIn?: { ticket?: string; nonce: 'asked' | 'other' | 'cancel' };
  /** The Mac app: `window.open` goes to the default browser, so it opens nothing here and only records the address. */
  macApp?: boolean;
  /** What other commands answer, by their full name, such as `{ 'plugin:haptics|impact_feedback': null }`. */
  answers?: Record<string, unknown>;
}

/** A command the page sent the bridge, with its arguments. */
export interface TauriCall {
  command: string;
  args: Record<string, unknown> | null;
}

/**
 * Runs the page as the app's Tauri build, called before the page loads: a stand-in for the shell's bridge
 * (`window.__TAURI_INTERNALS__`) that answers the kit's plugins as they answer, and the commands in `answers`; every
 * other command is refused with "no <command> here". Every call is recorded. The iPhone plugins need an iPhone user
 * agent and throw without one. The window's redeem of the code its sign-in link carries is answered with that code as
 * the ticket, so a test hands over a ticket where the code goes, through the sheet, `handOverSignIn` or
 * `loadWithSignIn`; the app's own server tests hold the real route.
 */
export function fakeTauri(page: Page, options?: FakeTauriOptions): Promise<void>;

/** The commands the page has sent the bridge so far. */
export function tauriCalls(page: Page): Promise<TauriCall[]>;

/** A notification tapped with the app open: the plugin keeps its address and tells the page. */
export function tapNotification(page: Page, address: string): Promise<void>;

/**
 * A notification tapped while the app was closed: the next load of the page, in this tab, starts with its address held,
 * as the plugin holds a tap that launched the app. Called on a page already on the app's address.
 */
export function launchedByTap(page: Page, address: string): Promise<void>;

/**
 * Continue with Google in the app's window, which asks the browser to open the kit's sign-in page with the nonce the
 * window keeps; resolves to that nonce. `click` presses the app's own button. With `fakeTauri(page, { macApp: true })`
 * the nonce is read from the address the page asked the shell to open; otherwise the sign-in page's load, in this page
 * or a window it opened, is cancelled, so the window's page stays put. A click that asks for none waits as long as Playwright
 * waits for an event, and the error then says the click opened no sign-in page.
 */
export function windowAsksForSignIn(page: Page, click: () => Promise<void>): Promise<string>;

/**
 * The shell handing the browser's sign-in to a page that listens for it, as its window event: `ticket` is the field
 * the link's code goes in, here the ticket itself, which `fakeTauri`'s redeem answers with.
 */
export function handOverSignIn(page: Page, link: { ticket: string; nonce: string }): Promise<void>;

/**
 * The shell handing the browser's sign-in to a page that does not listen for it: loads `path` (`/` by default) with the
 * sign-in in its fragment, as the shell loads a page still on its way.
 */
export function loadWithSignIn(page: Page, link: { ticket: string; nonce: string }, path?: string): Promise<void>;
