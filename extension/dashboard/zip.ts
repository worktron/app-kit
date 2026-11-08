// The check before a package goes up: the zip must hold this extension, at a version the dashboard does not already
// have below it. An equal version is the one already uploaded, which passes and uploads nothing, since the Store
// refuses a version it already has.

import { spawnSync } from 'node:child_process'

/** The name and version in a zip's manifest.json, read with unzip(1). */
export function zipManifest(zip: string): { name?: string; version?: string } {
  const read = spawnSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' })
  if (read.status !== 0 || !read.stdout) throw new Error(`${zip} holds no manifest.json at its top (unzip: ${read.stderr.trim() || `exit ${read.status}`}).`)
  return JSON.parse(read.stdout) as { name?: string; version?: string }
}

/** Negative, zero or positive as dotted version `a` is below, at or above `b`. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let at = 0; at < Math.max(left.length, right.length); at++) {
    const difference = (left[at] ?? 0) - (right[at] ?? 0)
    if (difference) return difference
  }
  return 0
}

/** What to do with the zip: upload it, or not, and the line that says why. */
export type ZipVerdict = { upload: boolean; ok: boolean; line: string }

/**
 * Judges a zip whose manifest is `zipped` for the extension named `name`, against the version the dashboard's Package
 * page shows (undefined when it has none yet).
 */
export function judgeZip(zipped: { name?: string; version?: string }, name: string, dashboard: string | undefined): ZipVerdict {
  if (zipped.name !== name) return { upload: false, ok: false, line: `The zip's manifest names "${zipped.name}", not this extension, "${name}"` }
  if (!zipped.version) return { upload: false, ok: false, line: "The zip's manifest has no version" }
  if (!dashboard) return { upload: true, ok: true, line: `The zip holds ${name} ${zipped.version}, and the dashboard has no package yet` }
  const order = compareVersions(zipped.version, dashboard)
  if (order < 0) return { upload: false, ok: false, line: `The zip holds version ${zipped.version}, below the dashboard's ${dashboard}` }
  if (order === 0) return { upload: false, ok: true, line: `The dashboard already has version ${dashboard}, the zip's; nothing to upload` }
  return { upload: true, ok: true, line: `The zip holds version ${zipped.version}, above the dashboard's ${dashboard}` }
}
