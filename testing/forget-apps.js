// Deleting a Mac app so macOS forgets it too. macOS registers every app bundle it finds or starts, wherever it is, and
// never drops a registration, not when the file moves and not when it is deleted (checked on macOS 27 with
// `lsregister -dump`), so every copy of a browser or stand-in app a test makes and deletes stays in macOS's list of apps.
// There it slows every lookup in that list: on 2026-11-22 about 1,700 of them, all from the kit's tests, kept macOS's
// storage scanner at 2 to 3.4 cores. So the copy is deleted first, which leaves macOS no moment to register it again,
// and then each app that was in it is forgotten by its path (`lsregister -u` takes a path that no longer exists).
// Plain JavaScript, typed by forget-apps.d.ts, since testing/playwright-dock.js and Playwright's tests load it under
// Node, which refuses TypeScript inside node_modules, where an app has the kit.

import { spawnSync } from 'node:child_process';
import { readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** macOS's tool for its list of apps, which has no public call that forgets one. */
export const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** @type {typeof import('./forget-apps').appsIn} */
export function appsIn(path) {
  // An app's path is an app's whether or not it is still there.
  /** @type {string[]} */
  const found = [];
  if (path.endsWith('.app')) found.push(path);
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return found;
  }
  // A link is never a directory here, so the walk never leaves the folder it was given.
  for (const entry of entries) if (entry.isDirectory()) found.push(...appsIn(join(path, entry.name)));
  return found;
}

/** @param {string[]} command */
function runCommand(command) {
  return spawnSync(/** @type {string} */ (command[0]), command.slice(1), { stdio: 'ignore' });
}

/** @type {typeof import('./forget-apps').removeAppsNow} */
export function removeAppsNow(paths, run = runCommand) {
  /** @type {{ path: string, error: Error }[]} */
  const failed = [];
  for (const given of paths) {
    // As macOS registered it: a test's folder under /tmp is /private/tmp to macOS. A path already gone stays as given.
    let path = given;
    try {
      path = realpathSync(given);
    } catch {
      // Gone already, or never there.
    }
    const apps = appsIn(path);
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      failed.push({ path: given, error: error instanceof Error ? error : new Error(String(error)) });
      continue;
    }
    if (process.platform !== 'darwin') continue;
    // A path that names an app is one of them even once it is gone, as an app deleted before it was given here is.
    // macOS refuses a path it never registered, which is the usual case and changes nothing.
    for (const app of apps) {
      try {
        run([LSREGISTER, '-u', app]);
      } catch {
        // Forgetting is never worth failing the caller for.
      }
    }
  }
  return failed;
}
