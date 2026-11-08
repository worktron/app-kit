// Playwright's WebKit, run from a copy macOS keeps out of the Dock (testing/playwright-dock.js says why and how). Plain
// JavaScript, typed by playwright-webkit.d.ts, since Playwright's test runner loads nothing written in TypeScript from
// inside node_modules, where an app has the kit.

import { webkit } from '@playwright/test';
import { withoutDockIcon } from '../testing/playwright-dock.js';

/** @type {typeof import('./playwright-webkit').webkitWithoutDockIcon} */
export function webkitWithoutDockIcon(cacheFolder) {
  return withoutDockIcon(webkit, cacheFolder);
}
