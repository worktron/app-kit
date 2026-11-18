/*
 * The iOS services a test iPhone Simulator boots with switched off: its wallpaper and widgets. A boot starts about 15
 * animated wallpaper extensions at about a core each, and widget extensions with them, for 60 to 90 seconds after
 * `bootstatus` says the device is ready, so they land on top of the test that follows. Nothing an app's check looks at
 * needs them.
 *
 * A Simulator's launch manager (launchd_sim) runs on the Mac and reads the services it keeps off from
 * /private/var/tmp/com.apple.CoreSimulator.SimDevice.<udid>/disabled.plist when the device boots: a flat dictionary of
 * service label to true (off) or false (on), the file `launchctl disable` inside the device writes. iOS writes its own
 * entries there too (the Watch companion services, as false), so a write keeps every entry it does not manage. The file
 * outlives `simctl erase`, and launchd_sim rewrites it while the device runs, so it is written only on a shut-down device.
 *
 * Apple's own `simctl boot --disabledJob=<label>` switches the same services off, measured on iOS 27.2, but only for the
 * boot that passes it: `simctl bootstatus -b`, which `iphone run sim` boots with, takes none, and each app's script would
 * have to change its boot line. The file reaches every boot, whoever starts it.
 *
 * Measured on a Mac Studio with iOS 27.2 (2026-11-17), an iPhone 17's erased boot took 589 and 619 CPU-seconds stock and
 * 356 and 340 with these off, and a boot as it was left 373 and 335 against 179 and 170; every wallpaper extension and
 * every widget extension but one renderer was gone.
 *
 * The labels, and those never to switch off, come from simslim (github.com/MobAI-App/simslim, MIT, LICENSE-simslim
 * beside this file), whose authors measured which ones wedge a Simulator.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from './index.ts';

/** Wallpaper (PosterBoard runs the wallpaper extensions), widgets and Live Activities, and navd, which the Maps widget retries in a loop when it is down. */
export const SWITCHED_OFF = ['com.apple.PosterBoard', 'com.apple.chronod', 'com.apple.liveactivitiesd', 'com.apple.navd'];

/**
 * Services that wedge a Simulator when switched off, or that something an app's check uses needs: simslim's list of
 * labels never to manage, and those it keeps on in every profile (gamed for XCUITest launches, assistantd for
 * dictation, sharingd for share sheets). The kit's list is held to hold none of these.
 */
export const NEVER_SWITCHED_OFF = [
  'com.apple.nanoregistryd',
  'com.apple.nanoregistrylaunchd',
  'com.apple.nanoprefsyncd.2',
  'com.apple.nanotimekitcompaniond',
  'com.apple.nanobackupd',
  'com.apple.sleepd',
  'com.apple.appprotectiond',
  'com.apple.ManagedSettingsAgent',
  'com.apple.managedconfiguration.profiled',
  'com.apple.mobiletimerd',
  'com.apple.routined',
  'com.apple.biomed',
  'com.apple.biomesyncd',
  'com.apple.dmd',
  'com.apple.donotdisturbd',
  'com.apple.gamed',
  'com.apple.assistantd',
  'com.apple.sharingd',
];

/** Where the Simulator's launch manager keeps the services it leaves off. */
export const SERVICES_ROOT = '/private/var/tmp';

export function servicesFile(udid: string, root = SERVICES_ROOT): string {
  return join(root, `com.apple.CoreSimulator.SimDevice.${udid}`, 'disabled.plist');
}

/** The file's entries with the kit's services switched off and every other entry as it was. */
export function switchOff(entries: Record<string, boolean>): Record<string, boolean> {
  return { ...entries, ...Object.fromEntries(SWITCHED_OFF.map((label) => [label, true])) };
}

/**
 * The kit's services a booted Simulator holds off, from `xcrun simctl spawn <udid> launchctl print-disabled system`,
 * whose lines read `"<label>" => disabled` (`=> true` on older runtimes).
 */
export function servicesOff(listing: string): string[] {
  const off = new Set(
    [...listing.matchAll(/^\s*"([^"]+)"\s*=>\s*(disabled|true)\s*$/gm)].map((match) => match[1]),
  );
  return SWITCHED_OFF.filter((label) => off.has(label));
}

const WHAT = 'wallpaper and widgets';

/**
 * The line `iphone run sim` prints after the boot, from the services the booted Simulator holds off (null when they
 * could not be read), so a runtime that ignores the file shows instead of quietly costing the Mac the whole boot.
 */
export function servicesLine(off: string[] | null): string {
  if (!off) return `[iphone-simulator] could not read which services the Simulator holds off`;
  if (off.length === SWITCHED_OFF.length) return `[iphone-simulator] ${WHAT} are switched off in this Simulator, so its boot costs the Mac less`;
  if (!off.length) return `[iphone-simulator] ${WHAT} run in this Simulator: they are switched off only at a boot from shut down, after the quiet step`;
  const on = SWITCHED_OFF.filter((label) => !off.includes(label));
  return `[iphone-simulator] ${off.length} of ${SWITCHED_OFF.length} ${WHAT} services are switched off in this Simulator; still on: ${on.join(', ')}`;
}

/**
 * Saves the kit's services as switched off for the shut-down Simulator `udid`'s next boot. Gives the clause the quiet
 * step's line ends with; it never fails the step, since a Simulator with them on still runs every check, only slower.
 */
export function switchOffServices(udid: string, run: Run, root = SERVICES_ROOT): string {
  const file = servicesFile(udid, root);
  let entries: Record<string, boolean> = {};
  if (existsSync(file)) {
    const read = run(['plutil', '-convert', 'json', '-o', '-', file]);
    try {
      if (!read.ok) throw new Error(read.out);
      entries = JSON.parse(read.out) as Record<string, boolean>;
    } catch {
      return `could not read ${file}, so ${WHAT} run at its boot as usual`;
    }
  }
  if (SWITCHED_OFF.every((label) => entries[label] === true)) return `${WHAT} stay switched off for its boot`;
  // Written whole and moved into place, so the launch manager never reads half a file.
  const temporary = `${file}.app-kit`;
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(temporary, JSON.stringify(switchOff(entries)));
    const converted = run(['plutil', '-convert', 'xml1', temporary]);
    if (!converted.ok) throw new Error(converted.out);
    renameSync(temporary, file);
  } catch {
    rmSync(temporary, { force: true });
    return `could not write ${file}, so ${WHAT} run at its boot as usual`;
  }
  return `${WHAT} switched off for its boot`;
}
