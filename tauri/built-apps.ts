/*
 * The apps a build makes, deleted once the command is done with them, and Xcode's build folders of checkouts that are
 * gone, so macOS keeps no copy of an app to hand its links to.
 *
 * macOS registers every app bundle it finds and never drops a registration, not when the file moves and not when it is
 * deleted (checked on macOS 27 with lsregister -dump): a Mac build is registered within a minute, an iPhone or Simulator
 * build in batches minutes to hours after it was made. Every iPhone run, TestFlight upload and Mac release used to leave
 * its app behind, in the checkout and in Xcode's build folder for that checkout, and each one became another registered
 * copy of the app: Argon had 19, and a Mac release left in the Mac release watcher's folder took links meant for the
 * installed app. So each of those commands deletes the bundles its build made once it is done with them, whether it
 * worked or not, and then tells macOS to forget each path (`lsregister -u` takes a path that no longer exists), in case
 * macOS registered it already. Deleting first leaves macOS no moment to register the copy again. What else the build
 * made stays: the .ipa, the Mac update archive, an archive's debug symbols, and the Rust and Xcode caches, though
 * Xcode builds its own copy of the app in place, so the next run relinks and signs it again.
 *
 * Each command also starts with a sweep: Xcode's build folder of a Tauri app whose checkout folder no longer exists can
 * never be used again (Xcode names the folder after the project's path), so it goes, with the apps in it forgotten. It
 * catches what an older kit, a run killed outright, or a build outside the kit left there. Only folders whose
 * info.plist names a Tauri app's Xcode project are touched; one whose checkout still exists is kept, whatever state
 * the checkout is in.
 *
 * Only a run that started a build deletes the apps afterwards; a run refused before its build leaves them.
 *
 * Nothing here fails a command: each line goes to the build's own output, without the command's prefix, since the
 * watchers take the last prefixed line as a run's reason.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Run } from '../command-line/run.ts';
import { LSREGISTER } from '../testing/forget-apps.js';

export { LSREGISTER, removeAppsNow } from '../testing/forget-apps.js';

/**
 * Whether this run has started a build, so only a run that built deletes: one refused before its build, such as a
 * Mac release asked for in a worktree, leaves the apps a build of someone else's left there.
 */
export type BuildStarted = { started: boolean };

/** Xcode's build folders, below the home folder. */
export const XCODE_BUILD_FOLDERS = 'Library/Developer/Xcode/DerivedData';
/** A Tauri app's Xcode project, as Tauri generates it; the part before `/src-tauri/` is the checkout. */
const TAURI_PROJECT = /^(.+)\/src-tauri\/gen\/apple\/[^/]+\.xcodeproj$/;
/** Where a Tauri iPhone build leaves its apps in the checkout: the Simulator copy, and the archive's. */
const APPLE_BUILD = 'src-tauri/gen/apple/build';
/** Where `tauri build` leaves the Mac app, below the app's Tauri folder. */
export const MAC_BUNDLE_FOLDER = 'src-tauri/target/release/bundle/macos';

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The project path an Xcode build folder's info.plist names, or null when it has none or cannot be read. */
export function workspacePath(folder: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(folder, 'info.plist'), 'utf8');
  } catch {
    return null;
  }
  const value = /<key>WorkspacePath<\/key>\s*<string>([^<]*)<\/string>/.exec(text)?.[1];
  return value ? value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name]!) : null;
}

/** The checkout a Tauri app's Xcode build folder was made for, or null for any other folder. */
export function tauriCheckout(folder: string): string | null {
  const project = workspacePath(folder);
  return project ? (TAURI_PROJECT.exec(project)?.[1] ?? null) : null;
}

/** A path as the file system resolves it, so /tmp and /private/tmp, or a trailing slash, name the same checkout. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The entries of `folder` that are app bundles, as full paths; none when it does not exist. */
function appsIn(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.endsWith('.app'))
      .map((name) => join(folder, name));
  } catch {
    return [];
  }
}

/** The subfolders of `folder`, as full paths; none when it does not exist. */
function foldersIn(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(folder, entry.name));
  } catch {
    return [];
  }
}

/** Xcode's build folders under `home`, each with the Tauri checkout it was made for. */
function tauriBuildFolders(home: string): { folder: string; checkout: string }[] {
  return foldersIn(join(home, XCODE_BUILD_FOLDERS)).flatMap((folder) => {
    const checkout = tauriCheckout(folder);
    return checkout ? [{ folder, checkout }] : [];
  });
}

/** The apps in an Xcode build folder: one per configuration, as `Build/Products/debug-iphonesimulator/App.app`. */
export function appsInXcodeFolder(folder: string): string[] {
  return foldersIn(join(folder, 'Build/Products')).flatMap(appsIn);
}

/**
 * The apps an iPhone build of the checkout `cwd` made: in Xcode's build folders for its project, the Simulator copy
 * Tauri moves out (`arm64-sim/App.app`), and the app inside each archive.
 */
export function iphoneApps(cwd: string, home: string): string[] {
  const checkout = resolved(cwd);
  const xcode = tauriBuildFolders(home)
    .filter((entry) => resolved(entry.checkout) === checkout)
    .flatMap((entry) => appsInXcodeFolder(entry.folder));
  const build = join(cwd, APPLE_BUILD);
  const left = foldersIn(build).flatMap((folder) => (folder.endsWith('.xcarchive') ? appsIn(join(folder, 'Products/Applications')) : appsIn(folder)));
  return [...xcode, ...left];
}

/** The apps a Mac build of the Tauri folder `cwd` made. */
export function macApps(cwd: string): string[] {
  return appsIn(join(cwd, MAC_BUNDLE_FOLDER));
}

/**
 * Deletes each app, then tells macOS to forget its path. lsregister exits 0 when it forgot a registration and fails on
 * a path macOS never registered, which is the usual case for a copy deleted before macOS found it.
 */
export async function removeApps(paths: string[], run: Run, output: (chunk: string) => void): Promise<void> {
  for (const path of paths) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      output(`could not delete the built app ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    const forgot = await run([LSREGISTER, '-u', path]);
    output(`deleted the built app ${path}${forgot.code === 0 ? ', and macOS forgot it' : ''}\n`);
  }
}

// The same for a signal handler, which cannot wait on a promise, is removeAppsNow, which tests and apps use too
// (app-kit/testing/forget-apps).

/**
 * Deletes Xcode's build folders under `home` made for a Tauri app whose checkout folder no longer exists, and has macOS
 * forget the apps that were in them. `home` is always the command's own, never the process's, so a test sweeps only
 * the home it made.
 */
export async function sweepGoneCheckouts(home: string, run: Run, output: (chunk: string) => void): Promise<void> {
  for (const { folder, checkout } of tauriBuildFolders(home)) {
    if (existsSync(checkout)) continue;
    const apps = appsInXcodeFolder(folder);
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch (error) {
      output(`could not delete Xcode's build folder ${folder}, whose checkout ${checkout} is gone: ${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }
    output(`deleted Xcode's build folder ${folder}: its checkout ${checkout} is gone\n`);
    await removeApps(apps, run, output);
  }
}
