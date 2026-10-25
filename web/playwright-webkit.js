// Playwright's WebKit, run from a copy macOS keeps out of the Dock. Playwright's WebKit is a Mac app whose Info.plist
// does not say it is a background app, so macOS puts it in the Dock as it starts, and a moment later its own startup
// code turns it into one: an icon that flashes for every browser a test run starts. The copy says so in its Info.plist
// (LSUIElement), which macOS reads before the app runs. Plain JavaScript, typed by playwright-webkit.d.ts, since
// Playwright's test runner loads nothing written in TypeScript from inside node_modules, where an app has the kit.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { webkit } from '@playwright/test';

/** How the copy is made; a change to the steps below takes the next number, so an old copy is never reused. */
const RECIPE = 1;
/** Playwright writes this last when it installs a browser, so a folder without it is missing or half extracted. */
const INSTALLED = 'INSTALLATION_COMPLETE';
const MAKING = '.making-';

/** @type {typeof import('./playwright-webkit').webkitWithoutDockIcon} */
export function webkitWithoutDockIcon(cacheFolder = join(homedir(), 'Library/Caches/app-kit/playwright-webkit')) {
  if (process.platform !== 'darwin') return {};
  const executable = webkit.executablePath();
  const source = dirname(executable);
  if (!existsSync(join(source, INSTALLED))) {
    console.error(`app-kit: Playwright's WebKit is not installed at ${source}, so Playwright starts it as it would without the kit`);
    return {};
  }
  const copy = join(cacheFolder, `${basename(source)}-${RECIPE}`);
  if (!existsSync(copy) && !makeCopy(source, copy)) return {};
  return { executablePath: join(copy, basename(executable)) };
}

/**
 * Clones `source`, marks its app a background one and signs it again, all before it takes its place at `copy`.
 * @param {string} source
 * @param {string} copy
 */
function makeCopy(source, copy) {
  const cache = dirname(copy);
  mkdirSync(cache, { recursive: true });
  const making = join(cache, `${MAKING}${basename(copy)}.${process.pid}.${Date.now()}`);
  try {
    // A copy-on-write clone, so the copy takes no space while Playwright's original is there.
    run('cp', '-cR', source, making);
    const app = readdirSync(making).find((name) => name.endsWith('.app'));
    if (!app) throw new Error(`app-kit: no app bundle in Playwright's WebKit at ${source}`);
    run('plutil', '-replace', 'LSUIElement', '-bool', 'true', join(making, app, 'Contents/Info.plist'));
    // Playwright's own signature is ad hoc too; the edit breaks it, and WebKit keeps its one entitlement.
    run('codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements', join(making, app));
    run('codesign', '--verify', join(making, app));
    // The marker was there before the clone; missing from it, Playwright was reinstalling the browser mid-clone.
    if (!existsSync(join(making, INSTALLED))) {
      console.error(`app-kit: Playwright's WebKit at ${source} changed while it was copied, so Playwright starts it as it would without the kit`);
      return false;
    }
    try {
      renameSync(making, copy);
    } catch (error) {
      // Another run moved its own copy into place first, and it is as good as this one.
      if (!['ENOTEMPTY', 'EEXIST'].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) throw error;
      return true;
    }
    console.error(`app-kit: made a copy of Playwright's WebKit that stays out of the Dock, at ${copy}`);
    removeOrphans(cache, dirname(source));
    return true;
  } finally {
    rmSync(making, { recursive: true, force: true });
  }
}

/**
 * Removes copies, and copies being made, whose Playwright original is gone: Playwright removes a browser only once no
 * installed Playwright uses it.
 * @param {string} cache
 * @param {string} browsers
 */
function removeOrphans(cache, browsers) {
  for (const name of readdirSync(cache)) {
    const original = name.replace(MAKING, '').replace(/\.\d+\.\d+$/, '').replace(/-\d+$/, '');
    if (existsSync(join(browsers, original))) continue;
    rmSync(join(cache, name), { recursive: true, force: true });
    console.error(`app-kit: removed ${join(cache, name)}, whose Playwright WebKit is gone`);
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function run(command, ...args) {
  try {
    execFileSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    const stderr = /** @type {{ stderr?: Buffer }} */ (error).stderr?.toString().trim();
    throw new Error(`app-kit: ${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}
