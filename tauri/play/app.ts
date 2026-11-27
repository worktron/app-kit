/* What `app-kit play` and `app-kit android run` read from a Tauri app's checkout. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ANDROID_PROJECT = 'src-tauri/gen/android';
export const BUILD_GRADLE = `${ANDROID_PROJECT}/app/build.gradle.kts`;

/**
 * The app's name, its identifier from its tauri.conf.json, and its Android package name, which Google Play and the
 * emulator know it by.
 */
export function readApp(cwd: string): { productName: string; identifier: string; packageName: string } | string {
  const config = join(cwd, 'src-tauri/tauri.conf.json');
  if (!existsSync(config)) return `${cwd} has no src-tauri/tauri.conf.json: run it from a Tauri app's checkout`;
  const { productName, identifier } = JSON.parse(readFileSync(config, 'utf8')) as { productName?: string; identifier?: string };
  if (!productName || !identifier) return `${config} names no productName or identifier`;
  return { productName, identifier, packageName: applicationId(cwd, identifier) };
}

/** The Android app's package name, from its build.gradle.kts: Tauri writes the identifier there, with `-` made `_`. */
export function applicationId(cwd: string, identifier: string): string {
  const file = join(cwd, BUILD_GRADLE);
  const written = existsSync(file) ? /applicationId\s*=\s*"([^"]+)"/.exec(readFileSync(file, 'utf8'))?.[1] : undefined;
  return written ?? identifier.replace(/-/g, '_');
}
