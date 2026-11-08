// A Playwright browser run from a copy macOS keeps out of the Dock. Playwright's WebKit and its full Chromium (Google
// Chrome for Testing, which the `chromium` channel and every test that loads an extension start) are Mac apps whose
// Info.plist does not say they are background apps, so macOS puts each in the Dock as it starts, and a moment later its
// own startup code turns it into one: an icon that flashes for every browser a test run starts. No launch option or
// environment setting changes that. The copy says so in its Info.plist, which macOS reads before the app runs: WebKit's
// with LSUIElement, Chromium's with LSBackgroundOnly, since Chromium takes an app marked LSUIElement for one of its own
// helper processes and looks for its framework where a helper's is, failing to start ("icudtl.dat not found in
// bundle"). Plain JavaScript, typed by playwright-dock.d.ts, since Playwright's test runner loads nothing written in
// TypeScript from inside node_modules, where an app has the kit; it imports no Playwright package, taking the browser
// type from its caller.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';

/** How the copy is made; a change to the steps below takes the next number, so an old copy is never reused. */
const RECIPE = 1;
/** Playwright writes this last when it installs a browser, so a folder without it is missing or half extracted. */
const INSTALLED = 'INSTALLATION_COMPLETE';
const MAKING = '.making-';
/** The folder Playwright installs a browser into, under its browsers folder: `webkit-2388`, `chromium-1248`. */
const INSTALL_FOLDER = /^[a-z_]+-\d+$/;
/** The browsers' names in what this file prints. */
const LABELS = { webkit: 'WebKit', chromium: 'Chromium', firefox: 'Firefox' };
/** The Info.plist key that keeps each browser's copy out of the Dock, LSUIElement unless named here. */
const KEYS = { chromium: 'LSBackgroundOnly' };

/** @type {typeof import('./playwright-dock').withoutDockIcon} */
export function withoutDockIcon(browserType, cacheFolder) {
  if (process.platform !== 'darwin') return {};
  const name = browserType.name();
  const label = `Playwright's ${LABELS[/** @type {keyof typeof LABELS} */ (name)] ?? name}`;
  const executable = browserType.executablePath();
  const source = installFolder(executable);
  if (!source || !existsSync(join(source, INSTALLED))) {
    console.error(`app-kit: ${label} is not installed at ${source ?? dirname(executable)}, so Playwright starts it as it would without the kit`);
    return {};
  }
  // One folder per Playwright browsers folder, which PLAYWRIGHT_BROWSERS_PATH can move per project, so a cleanup
  // measured against one project's browsers never takes another project's copy.
  const browsers = createHash('sha256').update(dirname(source)).digest('hex').slice(0, 12);
  const cache = cacheFolder ?? join(homedir(), 'Library/Caches/app-kit', `playwright-${name}`);
  const copy = join(cache, browsers, `${basename(source)}-${RECIPE}`);
  const key = KEYS[/** @type {keyof typeof KEYS} */ (name)] ?? 'LSUIElement';
  if (!existsSync(copy) && !makeCopy(source, copy, relative(source, executable), key, label)) return {};
  return { executablePath: join(copy, relative(source, executable)) };
}

/**
 * The folder Playwright installed the browser into, the executable's nearest folder named as Playwright names one, or
 * null when it is in none.
 * @param {string} executable
 */
function installFolder(executable) {
  for (let folder = dirname(executable); folder !== dirname(folder); folder = dirname(folder)) {
    if (INSTALL_FOLDER.test(basename(folder))) return folder;
  }
  return null;
}

/**
 * The app bundle the browser runs as, relative to its install folder: the one its executable is inside (Chromium's
 * `chrome-mac-arm64/Google Chrome for Testing.app`), or the one beside it (WebKit's `Playwright.app`, beside its run script).
 * @param {string} folder
 * @param {string} executable relative to `folder`
 */
function appIn(folder, executable) {
  const parts = executable.split(sep);
  const inside = parts.findIndex((part) => part.endsWith('.app'));
  if (inside !== -1) return parts.slice(0, inside + 1).join(sep);
  const beside = dirname(executable);
  const app = readdirSync(join(folder, beside)).find((entry) => entry.endsWith('.app'));
  return app ? join(beside, app) : null;
}

/**
 * Clones `source`, marks its app a background one with `key` and signs it again, all before it takes its place at `copy`.
 * @param {string} source
 * @param {string} copy
 * @param {string} executable relative to `source`
 * @param {string} key
 * @param {string} label
 */
function makeCopy(source, copy, executable, key, label) {
  const cache = dirname(copy);
  mkdirSync(cache, { recursive: true });
  const making = join(cache, `${MAKING}${basename(copy)}.${process.pid}.${Date.now()}`);
  try {
    // A copy-on-write clone, so the copy takes no space while Playwright's original is there.
    run('cp', '-cR', source, making);
    const app = appIn(making, executable);
    if (!app) throw new Error(`app-kit: no app bundle in ${label} at ${source}`);
    run('plutil', '-replace', key, '-bool', 'true', join(making, app, 'Contents/Info.plist'));
    // Playwright's own signatures are ad hoc too; the edit breaks the app's, and WebKit keeps its one entitlement.
    run('codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements', join(making, app));
    run('codesign', '--verify', join(making, app));
    // The marker was there before the clone; missing from it, Playwright was reinstalling the browser mid-clone.
    if (!existsSync(join(making, INSTALLED))) {
      console.error(`app-kit: ${label} at ${source} changed while it was copied, so Playwright starts it as it would without the kit`);
      return false;
    }
    try {
      renameSync(making, copy);
    } catch (error) {
      // Another run moved its own copy into place first, and it is as good as this one.
      if (!['ENOTEMPTY', 'EEXIST'].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) throw error;
      return true;
    }
    console.error(`app-kit: made a copy of ${label} that stays out of the Dock, at ${copy}`);
    removeOrphans(cache, dirname(source), label);
    return true;
  } finally {
    rmSync(making, { recursive: true, force: true });
  }
}

/**
 * Removes copies, and copies being made, whose Playwright original is gone: Playwright removes a browser only once no
 * installed Playwright uses it. Anything not named as this file names a copy is left as it is.
 * @param {string} cache
 * @param {string} browsers
 * @param {string} label
 */
function removeOrphans(cache, browsers, label) {
  for (const name of readdirSync(cache)) {
    const original = name.match(/^(?:\.making-)?([a-z_]+-\d+)-\d+(?:\.\d+\.\d+)?$/)?.[1];
    if (!original || existsSync(join(browsers, original))) continue;
    rmSync(join(cache, name), { recursive: true, force: true });
    console.error(`app-kit: removed ${join(cache, name)}, whose ${label} is gone`);
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
