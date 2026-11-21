/*
 * Versions as package managers write them, major.minor.patch with an optional -pre-release, held against the oldest
 * one a step needs: the Tauri CLI the TestFlight upload signs with (testflight/signing.ts) and the deep-link plugin an
 * iPhone build compiles (deep-link-entitlements.ts).
 */

export type Version = { parts: [number, number, number]; preRelease: boolean };

/** The version's three numbers and whether it is a pre-release, or null when it is not one. */
export function readVersion(text: string): Version | null {
  const match = text.trim().match(/^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], preRelease: match[4] !== undefined };
}

/** Whether `text` is older than `floor`; a pre-release is older than its own release, and an unreadable one than any. */
export function belowFloor(text: string, floor: readonly [number, number, number]): boolean {
  const version = readVersion(text);
  if (!version) return true;
  for (const [at, least] of floor.entries()) {
    if (version.parts[at] > least) return false;
    if (version.parts[at] < least) return true;
  }
  return version.preRelease;
}
