// The types of playwright.js, which is plain JavaScript because Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit.
import type { BrowserContext, Page } from '@playwright/test';

/** Counts the page's loads from now on, a new page in the same tab included. */
export function countLoads(page: Page): { loads: number };

/** One frame as `watchFrames` noted it: the body's background, and whether the app's root had any text in it. */
export interface Frame {
  background: string;
  drawn: boolean;
  text: string;
}

/**
 * Notes, at every frame of every page the context opens from now on, the page's background and whether anything is
 * drawn in the app's root (`#root` unless `root` says otherwise). Called before the page loads.
 */
export function watchFrames(context: BrowserContext, options?: { root?: string }): Promise<void>;

/** The frames noted since the last call, on the page as it is now; a page load starts the list again. */
export function takeFrames(page: Page): Promise<Frame[]>;

/** Fails unless every frame has something drawn, all in the one background given, such as `rgb(244, 239, 230)`. */
export function expectSteady(frames: Frame[], background: string): void;

export interface Point {
  x: number;
  y: number;
}

/**
 * A finger on the screen, through Chrome's debugging protocol, since Playwright's own touch input is taps alone.
 * Chromium only; it throws in WebKit or Firefox. A tap within about a quarter second of a slide's lift makes no click in
 * Chromium, so a test that taps right after a slide clicks instead, as a finger is slower than a test.
 */
export function finger(page: Page): Promise<{
  /**
   * Lands at `from`, holds for `holdMs` (none by default; a hold of a quarter second or more is a long press), moves to
   * `to` in `steps` moves (20 by default), settles there and lifts.
   */
  slide(from: Point, to: Point, options?: { holdMs?: number; steps?: number }): Promise<void>;
}>;

/**
 * A Playwright fixture that fails any test that opens a new window, for `test.extend({ noNewWindows })`. It runs for
 * every test without being named. In the page it refuses a `window.open` and a link that open a new window (a target
 * other than `_self`, `_parent` or `_top`, or a click with a modifier key or the middle button) before the browser sees
 * them, since Playwright's WebKit on a Mac hands such a link to the Mac's own app, such as Maps, in front of the
 * person's work. A window opened any other way still fails the test, after it opened.
 */
export const noNewWindows: [({ context }: { context: BrowserContext }, use: () => Promise<void>) => Promise<void>, { auto: true }];

/**
 * The phone's largest Text Size, for an app that calls `followTextSize()`, called before the page loads. The kit's
 * reading answers 3.12, as an iPhone at its largest accessibility size does, so the root font size, `--text-scale` and
 * `useTextScale()` all grow together. The page also reads the screen as taking touch (`navigator.maxTouchPoints` 5).
 */
export function largestTextSize(target: Page | BrowserContext): Promise<void>;

/**
 * Fails when anything reaches past the screen's right edge, measured against the viewport's width, unless it is inside
 * a box that scrolls sideways on its own, or when the page itself is wider than the screen. The failure names each
 * element and the start of its text.
 */
export function expectFits(page: Page): Promise<void>;
