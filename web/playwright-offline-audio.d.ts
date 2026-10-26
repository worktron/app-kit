// The types of playwright-offline-audio.js, which is plain JavaScript because Playwright's test runner loads nothing
// written in TypeScript from inside node_modules, where an app has the kit.
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Makes every AudioContext the pages of `target` create run on the browser's offline audio engine, paced to the clock,
 * so a page's sound plays through its whole graph and no audio device is ever opened. Call it before the page loads,
 * as with any init script. A context holds ten minutes of sound; past that its graph stops and currentTime holds. Its
 * memory grows with what it renders, about 380 KB a second, and a closed context keeps it until its page goes away.
 */
export function offlineAudio(
  target: Page | BrowserContext,
  options?: {
    /**
     * Follow an iPhone's rule rather than a desktop browser's: a context starts suspended, and `resume()` starts it
     * only during a tap (rejecting with NotAllowedError otherwise), until it has started once. Without it, a context
     * starts running on its own a moment after it is made, as in a browser that lets a page play sound.
     */
    startsOnTap?: boolean;
  },
): Promise<void>;
