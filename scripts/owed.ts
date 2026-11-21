#!/usr/bin/env bun
// What one app owes the kit, made for metamax's landing of that app's code to run (exit 1 holds the landing), run from the kit's own checkout so an app far
// behind is held to today's list, never its own old copy's. It reads the app's branch at HEAD (a landing refuses
// uncommitted changes, so HEAD is what lands): the releases since the oldest version it installs that ask something of
// it (urgency now or next round), each with the day it came out, and the kit's features it lacks.
//
// A release asking something of the app holds the landing once it has been out more than HOLD_AFTER_DAYS days, urgent
// ones included, since the kit cannot tell which apps a fix concerns; younger ones are listed, so the thread sees them
// while it works. A release is answered only by moving to a version past it, with every lock file installing that
// version, so a package.json edited without its lock still holds. Features an app lacks are listed and never hold.
//
//   bun scripts/owed.ts <app checkout> [--json]
//
// Exit 0: nothing holds (or the checkout installs no kit). Exit 1: the landing holds, the reasons printed, and --json
// carries `holds: true`. Exit 2: the kit's check could not say, the error printed (GitHub's tags or the kit's main
// unread, the app's tree unread), never read as nothing owed. Any other exit is the check itself failing.

import { resolve } from 'node:path'
import { compareVersions, readApp, tagsOnGitHub, type App } from './apps.ts'
import type { Urgency } from './land.ts'

/** How long a release asking something of an app may go untaken before the app's landings hold. */
export const HOLD_AFTER_DAYS = 14

/** The one ticket an app keeps for catching up with the kit, which an urgent release files (scripts/urgent-tickets.ts). */
export const CATCH_UP = 'app-kit-catch-up'

/** A release asking something of an app; `released` is null when the kit's main has no `Version x.y.z` commit for it. */
export type Owed = { version: string; released: string | null; days: number; urgency: Urgency; lines: string[]; holds: boolean }
export type Owing = {
  project: string
  /** The oldest version any of its package.json files installs. */
  on: string
  releases: Owed[]
  lacks: string[]
  unknown: string[]
  /** Each install whose lock does not install the version it names: a half-done move, which holds. */
  locks: string[]
  /** Whether its backlog holds the catch-up ticket. */
  catchUp: boolean
  holds: boolean
}

/** Whole days from a release's day (YYYY-MM-DD) to `today`. */
function daysSince(released: string, today: Date): number {
  return Math.floor((today.getTime() - new Date(`${released}T00:00:00`).getTime()) / 86_400_000)
}

/** What an app read by readApp owes, by each release's day from `released` (version to YYYY-MM-DD). */
export function owedBy(app: App, released: Map<string, string>, today: Date): Owing {
  const releases = app.changes
    .filter((change): change is App['changes'][number] & { urgency: Urgency } => change.urgency === 'now' || change.urgency === 'next round')
    .map(({ version, urgency, lines }) => {
      // A release with no Version commit on main (released by hand) is counted as old: it holds, and the app's move past
      // it answers it, so it never stops the check for every app behind it.
      const day = released.get(version) ?? null
      const days = day ? daysSince(day, today) : Number.POSITIVE_INFINITY
      return { version, released: day, days, urgency, lines, holds: days > HOLD_AFTER_DAYS }
    })
  const locks = app.installs
    .filter((install) => !install.locked?.matchesTag)
    .map(({ file, tag, locked }) => (locked ? `${file} names ${tag}, but its bun.lock installs ${locked.commit}` : `${file} names ${tag}, but no bun.lock installs it`))
  const on = app.installs.map((install) => install.tag).sort(compareVersions)[0]
  return { project: app.project, on, releases, lacks: app.lacks, unknown: app.unknown, locks, catchUp: app.tickets.some((ticket) => ticket.id === CATCH_UP), holds: locks.length > 0 || releases.some((release) => release.holds) }
}

/** The lines a landing prints for an app's debts. */
export function owedLines(owing: Owing, newest: string): string[] {
  const lines = [`app-kit owed: ${owing.project} is on ${owing.on}; the newest is ${newest}`]
  for (const release of owing.releases) {
    const age = release.released === null ? 'on a day the kit has no record of' : release.days === 1 ? '1 day' : `${release.days} days`
    lines.push(`  ${release.holds ? 'holds ' : 'listed'} ${release.version} (${release.urgency}, out ${age}): ${release.lines.join(' / ')}`)
  }
  for (const lock of owing.locks) lines.push(`  holds  ${lock}`)
  if (owing.lacks.length) lines.push(`  lacks (listed, never holds): ${owing.lacks.join('; ')}`)
  if (owing.unknown.length) lines.push(`  not known: ${owing.unknown.join('; ')}`)
  if (owing.catchUp) lines.push(`  its backlog holds the ${CATCH_UP} ticket; once this catch-up lands, drop it`)
  lines.push(
    owing.holds
      ? `app-kit owed: held: a release asking something of this app has been out more than ${HOLD_AFTER_DAYS} days. Move every package.json to github:worktron/app-kit#${newest} with its bun.lock, taking in what each release above asks; one thread takes this catch-up, after checking the app's threads for one already under way.`
      : owing.releases.length || owing.lacks.length
        ? `app-kit owed: not held; take these with this work, or within ${HOLD_AFTER_DAYS} days of each release.`
        : 'app-kit owed: nothing owed.',
  )
  return lines
}

/** Each release's day, from the "Version x.y.z" commits on the kit's main. */
export function releaseDays(log: string): Map<string, string> {
  const days = new Map<string, string>()
  for (const line of log.split('\n')) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}) Version (\d+\.\d+\.\d+)$/)
    if (match && !days.has(`v${match[2]}`)) days.set(`v${match[2]}`, match[1])
  }
  return days
}

function git(dir: string, args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() || p.stderr.toString().trim() }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const json = args.includes('--json')
  const [target] = args.filter((arg) => !arg.startsWith('--'))
  if (!target) {
    console.error('usage: bun scripts/owed.ts <app checkout> [--json]')
    process.exit(2)
  }
  const fail = (why: string): never => {
    console.error(`app-kit owed: the kit's check could not say: ${why}`)
    process.exit(2)
  }
  try {
    const kit = resolve(import.meta.dir, '..')
    const tags = tagsOnGitHub(kit)
    if (!tags.size) fail('GitHub lists no version tags for the kit')
    // Another thread may be fetching the same branch at the same moment; one retry.
    let fetched = git(kit, ['fetch', '-q', '--no-tags', 'origin', 'main'])
    if (!fetched.ok) fetched = git(kit, ['fetch', '-q', '--no-tags', 'origin', 'main'])
    if (!fetched.ok) fail(`fetching the kit's main: ${fetched.out}`)
    const changes = git(kit, ['show', 'origin/main:CHANGES.md'])
    if (!changes.ok) fail(`reading CHANGES.md on the kit's main: ${changes.out}`)
    const log = git(kit, ['log', 'origin/main', '--format=%cs %s', '--grep', '^Version '])
    if (!log.ok) fail(`reading the kit's release days: ${log.out}`)
    // The app is read with no fetch: HEAD is the branch being landed, and a fetch would race the app's own landing.
    const app = await readApp(resolve(target), tags, changes.out, false, undefined, 'HEAD')
    if (app === null) {
      console.log(json ? JSON.stringify({ installsKit: false, holds: false }) : 'app-kit owed: this checkout installs no app-kit')
      process.exit(0)
    }
    if ('unread' in app) fail(`reading ${app.project}: ${app.unread}`)
    const owing = owedBy(app as App, releaseDays(log.out), new Date())
    const newest = [...tags.keys()].sort(compareVersions).pop()!
    console.log(json ? JSON.stringify({ installsKit: true, newest, ...owing }, null, 2) : owedLines(owing, newest).join('\n'))
    process.exit(owing.holds ? 1 : 0)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
