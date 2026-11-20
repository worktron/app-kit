// The apps a build made, found in the checkout and in Xcode's build folders, deleted and forgotten; and the sweep of
// Xcode's build folders whose Tauri checkout is gone. Xcode's build folder is made from a real one's info.plist
// (fixtures/xcode-build-folder), its project path put in by each test; lsregister is a stand-in.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appsInXcodeFolder, iphoneApps, LSREGISTER, macApps, removeApps, removeAppsNow, sweepGoneCheckouts, tauriCheckout, workspacePath, XCODE_BUILD_FOLDERS } from '../tauri/built-apps.ts';
import { exit, ok, scratch, standInRunner } from './testflight-stand-in.ts';

let place: ReturnType<typeof scratch>;
let home: string;

const INFO_PLIST = readFileSync(join(import.meta.dir, 'fixtures/xcode-build-folder/info.plist'), 'utf8');
const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Files under `folder`, each made with its folders. */
function write(folder: string, files: string[]) {
  for (const path of files) {
    mkdirSync(join(folder, path, '..'), { recursive: true });
    writeFileSync(join(folder, path), '');
  }
}

/** An Xcode build folder named `name` under the home, made for `project`, holding `apps` (as `debug-iphonesimulator/A.app`). */
function xcodeFolder(name: string, project: string | null, apps: string[] = []): string {
  const folder = join(home, XCODE_BUILD_FOLDERS, name);
  mkdirSync(folder, { recursive: true });
  if (project !== null) writeFileSync(join(folder, 'info.plist'), INFO_PLIST.replace('{{PROJECT}}', escapeXml(project)));
  write(folder, apps.map((app) => `Build/Products/${app}/Contents/Info.plist`));
  return folder;
}

/** A Tauri app's checkout with its committed Xcode project. */
function checkout(name: string): string {
  const folder = join(place.folder, name);
  write(folder, ['src-tauri/gen/apple/sample-shell.xcodeproj/project.pbxproj']);
  return folder;
}

const project = (checkoutFolder: string) => join(checkoutFolder, 'src-tauri/gen/apple/sample-shell.xcodeproj');

/** lsregister as macOS answers: it forgets a path it had registered, and fails on one it never did. */
function lsregister(registered: string[] = []) {
  const forgotten: string[] = [];
  const stand = standInRunner((command) => {
    if (command[0] !== LSREGISTER) return undefined;
    const path = command[2]!;
    // What it forgets is already gone from disk: the app is deleted first.
    forgotten.push(`${path}${existsSync(path) ? ' (still on disk)' : ''}`);
    return registered.includes(path) ? ok() : exit(1, `failed to scan ${path}: -10814 from spotlight`);
  }, []);
  return { ...stand, forgotten };
}

beforeEach(() => {
  place = scratch('built-apps-');
  home = join(place.folder, 'home');
  mkdirSync(home);
});

afterEach(() => place.done());

describe('what a build folder was made for', () => {
  test("reads the project from a real Xcode build folder's info.plist, and the Tauri checkout above it", () => {
    const app = checkout('a&b');
    const folder = xcodeFolder('sample-shell-abc', project(app));
    expect(workspacePath(folder)).toBe(project(app));
    expect(tauriCheckout(folder)).toBe(app);
  });

  test("a project that is not a Tauri app's, or a folder with no info.plist, names no checkout", () => {
    expect(tauriCheckout(xcodeFolder('Beeline-abc', '/somewhere/Beeline/Beeline.xcodeproj'))).toBeNull();
    expect(tauriCheckout(xcodeFolder('ModuleCache.noindex', null))).toBeNull();
    expect(workspacePath(join(home, 'no-such-folder'))).toBeNull();
  });
});

describe('the apps a build made', () => {
  test("an iPhone build's: Xcode's copies for this checkout, the Simulator copy and the archive's app, never its debug symbols or the .ipa", () => {
    const app = checkout('app');
    const other = checkout('other');
    const mine = xcodeFolder('sample-shell-mine', project(app), ['debug-iphonesimulator/Sample App.app', 'release-iphoneos/Sample App.app']);
    xcodeFolder('sample-shell-other', project(other), ['debug-iphonesimulator/Sample App.app']);
    write(app, [
      'src-tauri/gen/apple/build/arm64-sim/Sample App.app/Info.plist',
      'src-tauri/gen/apple/build/arm64/sample-shell.ipa',
      'src-tauri/gen/apple/build/sample-shell_iOS.xcarchive/Products/Applications/Sample App.app/Info.plist',
      'src-tauri/gen/apple/build/sample-shell_iOS.xcarchive/dSYMs/Sample App.app.dSYM/Contents/Info.plist',
    ]);
    expect(iphoneApps(app, home).sort()).toEqual(
      [
        join(mine, 'Build/Products/debug-iphonesimulator/Sample App.app'),
        join(mine, 'Build/Products/release-iphoneos/Sample App.app'),
        join(app, 'src-tauri/gen/apple/build/arm64-sim/Sample App.app'),
        join(app, 'src-tauri/gen/apple/build/sample-shell_iOS.xcarchive/Products/Applications/Sample App.app'),
      ].sort(),
    );
  });

  test('a checkout reached by another path to the same folder, as /tmp is /private/tmp, is the same checkout', () => {
    const app = checkout('app');
    const link = join(place.folder, 'link-to-app');
    symlinkSync(app, link);
    const mine = xcodeFolder('sample-shell-mine', project(link), ['debug-iphonesimulator/Sample App.app']);
    expect(iphoneApps(app, home)).toEqual([join(mine, 'Build/Products/debug-iphonesimulator/Sample App.app')]);
  });

  test("a Mac build's: the app in the bundle folder, never the update archive or its signature", () => {
    const app = checkout('app');
    write(app, ['src-tauri/target/release/bundle/macos/Sample App.app/Contents/Info.plist', 'src-tauri/target/release/bundle/macos/Sample App.app.tar.gz', 'src-tauri/target/release/bundle/macos/Sample App.app.tar.gz.sig']);
    expect(macApps(app)).toEqual([join(app, 'src-tauri/target/release/bundle/macos/Sample App.app')]);
    expect(macApps(join(place.folder, 'never-built'))).toEqual([]);
  });
});

describe('deleting them', () => {
  test('deletes each app, then has macOS forget its path, and says which macOS had registered', async () => {
    const app = checkout('app');
    write(app, ['src-tauri/target/release/bundle/macos/Sample App.app/Contents/Info.plist', 'src-tauri/target/release/bundle/macos/Sample App.app.tar.gz']);
    const registered = join(app, 'src-tauri/target/release/bundle/macos/Sample App.app');
    const never = join(place.folder, 'gone/Never.app');
    const stand = lsregister([registered]);
    const lines: string[] = [];
    await removeApps([registered, never], stand.run, (chunk) => lines.push(chunk));
    expect(existsSync(registered)).toBe(false);
    expect(existsSync(`${registered}.tar.gz`)).toBe(true);
    expect(stand.forgotten).toEqual([registered, never]);
    expect(lines).toEqual([`deleted the built app ${registered}, and macOS forgot it\n`, `deleted the built app ${never}\n`]);
  });

  test("a signal handler's delete does the same without waiting", () => {
    const app = checkout('app');
    write(app, ['src-tauri/target/release/bundle/macos/Sample App.app/Contents/Info.plist']);
    const built = join(app, 'src-tauri/target/release/bundle/macos/Sample App.app');
    const calls: string[][] = [];
    removeAppsNow([built], ((command: string[]) => {
      calls.push(command);
      return { success: true };
    }) as unknown as typeof Bun.spawnSync);
    expect(existsSync(built)).toBe(false);
    expect(calls).toEqual([[LSREGISTER, '-u', built]]);
  });
});

describe('the sweep of build folders whose checkout is gone', () => {
  test("deletes a gone Tauri checkout's folder and forgets its apps, and keeps every other folder", async () => {
    const live = checkout('live');
    const gone = join(place.folder, 'closed-worktree');
    const goneFolder = xcodeFolder('sample-shell-gone', project(gone), ['debug-iphonesimulator/Sample App.app', 'release-iphoneos/Sample App.app']);
    const liveFolder = xcodeFolder('sample-shell-live', project(live), ['debug-iphonesimulator/Sample App.app']);
    const swift = xcodeFolder('Beeline-abc', '/no/such/Beeline/Beeline.xcodeproj', ['Debug/Beeline.app']);
    const cache = xcodeFolder('ModuleCache.noindex', null);
    const stand = lsregister();
    const lines: string[] = [];
    await sweepGoneCheckouts(home, stand.run, (chunk) => lines.push(chunk));
    expect(existsSync(goneFolder)).toBe(false);
    expect(stand.forgotten).toEqual([join(goneFolder, 'Build/Products/debug-iphonesimulator/Sample App.app'), join(goneFolder, 'Build/Products/release-iphoneos/Sample App.app')]);
    expect(lines[0]).toBe(`deleted Xcode's build folder ${goneFolder}: its checkout ${gone} is gone\n`);
    for (const kept of [liveFolder, swift, cache]) expect(existsSync(kept)).toBe(true);
  });

  test('a checkout that still exists keeps its folder even while its Xcode project is missing, as on a branch switch', async () => {
    const live = checkout('live');
    const liveFolder = xcodeFolder('sample-shell-live', project(live), ['debug-iphonesimulator/Sample App.app']);
    rmSync(join(live, 'src-tauri/gen'), { recursive: true });
    const stand = lsregister();
    await sweepGoneCheckouts(home, stand.run, () => {});
    expect(existsSync(liveFolder)).toBe(true);
    expect(stand.forgotten).toEqual([]);
  });

  test('a home with no Xcode build folders has nothing to sweep', async () => {
    const stand = lsregister();
    await sweepGoneCheckouts(home, stand.run, () => {});
    expect(stand.calls).toEqual([]);
    expect(appsInXcodeFolder(join(home, 'nothing'))).toEqual([]);
  });
});
