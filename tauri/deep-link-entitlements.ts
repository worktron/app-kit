/*
 * Tauri's deep-link plugin rewrites the app's iPhone entitlements file from its build script, which cargo runs on a
 * checkout's first iPhone build and not on later ones (plugins-workspace issue 3596). Before 2.6.3, and in the 3.0.0
 * pre-releases, which never took the fix, it removes the whole associated-domains list when the app configures no
 * iPhone app links, and replaces it with its own applinks entries when it does: either way the webcredentials entry that
 * one-tap iPhone sign-in needs is gone, with no message, and a commit of the file takes it from every later build.
 * 2.6.3 replaces only the applinks entries, which are its own (plugins-workspace pull request 3382). So `iphone run`
 * and the TestFlight upload refuse to start a build that would erase an entry, with the update that fixes it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { belowFloor, readVersion } from './version.ts';

/** The oldest deep-link plugin that keeps the entries it does not own. */
export const DEEP_LINK_FLOOR = [2, 6, 3] as const;
const CRATE = 'tauri-plugin-deep-link';
const DOMAINS = 'com.apple.developer.associated-domains';

/** Each version of the deep-link plugin a Cargo.lock locks. */
export function lockedDeepLink(lock: string): string[] {
  const found: string[] = [];
  for (const block of lock.split(/^\[\[package\]\]$/m)) {
    if (block.match(/^name = "([^"]+)"$/m)?.[1] !== CRATE) continue;
    const version = block.match(/^version = "([^"]+)"$/m)?.[1];
    if (version) found.push(version);
  }
  return found;
}

/** Whether a version of the plugin erases the entries it does not own: before 2.6.3, and the 3.0.0 pre-releases. */
export function erases(version: string): boolean {
  const read = readVersion(version);
  if (read && read.parts[0] === 3 && read.parts[1] === 0 && read.parts[2] === 0 && read.preRelease) return true;
  return belowFloor(version, DEEP_LINK_FLOOR);
}

/** The associated domains an entitlements plist lists, as Xcode and Tauri write it (XML). */
export function associatedDomains(plist: string): string[] {
  const list = plist.match(new RegExp(`<key>${DOMAINS.replaceAll('.', '\\.')}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1] ?? '';
  return [...list.matchAll(/<string>([^<]*)<\/string>/g)].map((entry) => entry[1].trim());
}

/** The iPhone entitlements file the plugin writes, as tauri-plugin's mobile::update_entitlements names it. */
export function entitlementsFile(project: string): string {
  return `src-tauri/gen/apple/${project}_iOS/${project}_iOS.entitlements`;
}

/**
 * Why an iPhone build of the app at `cwd`, whose Xcode project is `<project>.xcodeproj`, would erase entries from its
 * committed entitlements, with the update that stops it, or null.
 */
export function deepLinkProblem(cwd: string, project: string): string | null {
  const lockFile = ['src-tauri/Cargo.lock', 'Cargo.lock'].find((path) => existsSync(join(cwd, path)));
  const file = entitlementsFile(project);
  if (!lockFile || !existsSync(join(cwd, file))) return null;
  const version = lockedDeepLink(readFileSync(join(cwd, lockFile), 'utf8')).find(erases);
  if (!version) return null;
  const erased = associatedDomains(readFileSync(join(cwd, file), 'utf8')).filter((entry) => !entry.startsWith('applinks:'));
  if (!erased.length) return null;
  return `${lockFile} locks ${CRATE} ${version}, whose build script deletes ${erased.join(', ')} from ${file} on a first iPhone build, so the app loses it once that file is committed. Run cargo update -p ${CRATE} in src-tauri (${DEEP_LINK_FLOOR.join('.')} or later keeps it), run one iPhone build, and commit Cargo.lock with the Info.plist change it makes.`;
}
