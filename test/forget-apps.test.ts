// The step that deletes a Mac app and has macOS forget it (testing/forget-apps.js), with lsregister a stand-in that
// records what it was asked to forget and whether that was still on disk then: the real one changes macOS's list.
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appsIn, LSREGISTER, removeAppsNow } from '../testing/forget-apps.js';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-forget-apps-')));
// The link test leaves a stand-in Chromium outside what it removes, which this forgets in turn.
afterAll(() => removeAppsNow([scratch]));
let made = 0;
const folder = () => {
  const path = join(scratch, String(made++));
  mkdirSync(path);
  return path;
};

/** A Chromium laid out as Playwright installs it: helper apps inside the app's framework. */
function chromium(at: string) {
  const app = join(at, 'chrome-mac-arm64', 'Google Chrome for Testing.app');
  const helpers = join(app, 'Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/1.0/Helpers');
  const helper = join(helpers, 'Google Chrome for Testing Helper (GPU).app');
  const alerts = join(helpers, 'Google Chrome for Testing Helper (Alerts).app');
  for (const bundle of [helper, alerts]) mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), '');
  return { app, helper, alerts };
}

/** lsregister that records each path it is asked to forget, and whether it was still on disk then. */
function lsregister() {
  const forgot: string[] = [];
  const run = (command: string[]) => {
    expect(command.slice(0, 2)).toEqual([LSREGISTER, '-u']);
    forgot.push(`${command[2]}${existsSync(command[2]!) ? ' (still on disk)' : ''}`);
  };
  return { forgot, run };
}

describe.if(process.platform === 'darwin')('on macOS', () => {
  test('deletes a folder, then forgets every app that was in it, helper apps inside an app included', () => {
    const copy = folder();
    const { app, helper, alerts } = chromium(copy);
    const stand = lsregister();
    expect(removeAppsNow([copy], stand.run)).toEqual([]);
    expect(existsSync(copy)).toBe(false);
    expect(stand.forgot.sort()).toEqual([app, helper, alerts].sort());
  });

  test('forgets an app given by its path that is already gone, as a release stopped by a signal gives it', () => {
    const gone = join(folder(), 'unpacked', 'Sample.app');
    const stand = lsregister();
    expect(removeAppsNow([gone], stand.run)).toEqual([]);
    expect(stand.forgot).toEqual([gone]);
  });

  test('takes a path as macOS registered it, so a folder under /tmp is forgotten as /private/tmp', () => {
    const real = mkdtempSync('/private/tmp/app-kit-forget-apps-');
    const app = join(real, 'Stand-in.app');
    mkdirSync(app);
    const stand = lsregister();
    removeAppsNow([real.replace(/^\/private/, '')], stand.run);
    expect(existsSync(real)).toBe(false);
    expect(stand.forgot).toEqual([app]);
  });

  test('never follows a link out of the folder it was given, so an app outside it is neither forgotten nor deleted', () => {
    const outside = folder();
    const { app } = chromium(outside);
    const copy = folder();
    symlinkSync(outside, join(copy, 'node_modules'));
    expect(appsIn(copy)).toEqual([]);
    const stand = lsregister();
    removeAppsNow([copy], stand.run);
    expect(stand.forgot).toEqual([]);
    expect(existsSync(app)).toBe(true);
  });

  test('a path that is itself a link is removed as a link, and what it points to is kept', () => {
    const outside = folder();
    const { app } = chromium(outside);
    const link = join(folder(), 'copy');
    symlinkSync(outside, link);
    const stand = lsregister();
    expect(removeAppsNow([link], stand.run)).toEqual([]);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(app)).toBe(true);
    expect(stand.forgot).toEqual([]);
  });

  test('a forget that fails fails nothing, and the next path is still deleted and forgotten', () => {
    const first = join(folder(), 'First.app');
    const second = join(folder(), 'Second.app');
    for (const app of [first, second]) mkdirSync(app);
    const forgot: string[] = [];
    const failed = removeAppsNow([first, second], (command) => {
      forgot.push(command[2]!);
      throw new Error('lsregister: no such registration');
    });
    expect(failed).toEqual([]);
    expect(forgot).toEqual([first, second]);
    expect(existsSync(second)).toBe(false);
  });

  test('hands back a path it could not delete, by the path it was given, and forgets nothing in it', () => {
    const held = folder();
    mkdirSync(join(held, 'Held.app'));
    chmodSync(held, 0o500);
    const stand = lsregister();
    try {
      const failed = removeAppsNow([held], stand.run);
      // Its insides could not be removed, so the folder could not either.
      expect(failed.map(({ path, error }) => [path, (error as NodeJS.ErrnoException).code])).toEqual([[held, 'ENOTEMPTY']]);
    } finally {
      chmodSync(held, 0o700);
    }
    expect(stand.forgot).toEqual([]);
  });
});
