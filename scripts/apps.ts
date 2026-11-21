#!/usr/bin/env bun
// The apps on the kit, read for the apps page (.claude/skills/apps-round, a report the owner asks for; each app keeps
// itself current by reading CHANGES.md when it is next worked on): each git checkout directly inside the folders given
// whose landed package.json files install the kit from GitHub, with the tag it names, what its bun.lock installs, how
// many releases it is behind, what CHANGES.md asks of it since its tag with each release's urgency, the most urgent of
// those, its open backlog tickets that name the kit, and the kit's features it should have and lacks
// (scripts/kit-features.ts). A checkout whose landed tree cannot be read is listed as unread, never as one with no kit.
// It changes no app: it fetches each checkout's origin, which moves only that checkout's remote branches, and reads
// what landed there (origin/HEAD, else HEAD).
//
//   bun scripts/apps.ts <folder>... [--no-fetch]
//
// Prints one JSON object: the kit's newest version, when it read, the apps and the checkouts it could not read. The
// kit's tags are read from GitHub (git ls-remote), never made or fetched into the local repository, which every
// worktree shares. olderThan, the landing's list of apps on a version before an urgent release, reads the same way.

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { URGENCIES, type Urgency } from './land.ts'
import { appleServers, featuresOf, landedAt, type AppleLookup } from './kit-features.ts'

export type Ticket = { id: string; title: string }
export type Change = { version: string; urgency: Urgency | null; lines: string[] }
export type App = {
  project: string
  /**
   * Each landed package.json that installs the kit, with the tag it names, and the commit the bun.lock that serves it
   * (in its folder, else the nearest folder above) installs, with whether that is the tag's commit.
   */
  installs: { file: string; tag: string; locked: { commit: string; matchesTag: boolean } | null }[]
  /** Releases since the oldest tag the app names, up to the newest. */
  behind: number
  /** CHANGES.md's entries newer than that tag, newest first. */
  changes: Change[]
  /** The most urgent of those entries' levels, or null when none is listed. */
  urgency: Urgency | null
  /** Open sections of its backlog that name app-kit. */
  tickets: Ticket[]
  /** The kit's features it should have and lacks (scripts/kit-features.ts). */
  lacks: string[]
  /** The features whose answer could not be read, each with why: never read as lacking or as had. */
  unknown: string[]
  /** When its origin was last fetched, or why it could not be. */
  fetched: string
}

const INSTALL = /github:worktron\/app-kit#(v\d+\.\d+\.\d+)/
const LOCKED = /app-kit@github:worktron\/app-kit#([0-9a-f]{7,40})/

/** Versions compared as numbers, so v0.9.0 comes before v0.10.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** CHANGES.md's entries for versions after `from`, newest first, as the file lists them, each with its Urgency line's level. */
export function changesSince(text: string, from: string): Change[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading, ...body] = section.split('\n')
      const urgency = body.map((line) => line.match(/^Urgency: (.+)$/)?.[1].trim()).find((value) => URGENCIES.includes(value as Urgency)) as Urgency | undefined
      return { version: heading.trim(), urgency: urgency ?? null, lines: body.filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()) }
    })
    .filter((entry) => /^v\d+\.\d+\.\d+$/.test(entry.version) && compareVersions(entry.version, from) > 0)
}

/** The backlog's `## <id> · <title>` sections whose heading or text names app-kit. */
export function kitTickets(backlog: string): Ticket[] {
  return backlog
    .split(/^(?=## )/m)
    .filter((section) => section.startsWith('## ') && /app-kit/i.test(section))
    .map((section) => {
      const heading = section.split('\n')[0].slice(3)
      const [id, ...title] = heading.split(' · ')
      return { id: id.trim(), title: title.join(' · ').trim() }
    })
}

function git(dir: string, args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' })
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() || p.stderr.toString().trim() }
}

/** A checkout whose landed tree could not be read, and why: never read as one that installs no kit. */
export type Unread = { project: string; unread: string }

/** What a checkout landed: the ref read, its files, one file's text ('' when absent), and when its origin was fetched. */
type Tree = { ref: string; files: string[]; show: (file: string) => string; fetched: string }

function projectOf(dir: string): string {
  return dir.split('/').pop() ?? dir
}

/** The tree a checkout landed on its origin (origin/HEAD, else HEAD), or why it could not be read. */
function landedTree(dir: string, fetched: string): Tree | { unread: string } {
  // A broken .git makes git look in the folders above, which would read another repository's tree as this one's.
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  if (!top.ok || realpathSync(top.out) !== realpathSync(dir)) return { unread: `not a git checkout of its own: ${top.ok ? `git reads ${top.out}` : top.out.split('\n')[0]}` }
  const ref = git(dir, ['rev-parse', '-q', '--verify', 'refs/remotes/origin/HEAD']).ok ? 'origin/HEAD' : 'HEAD'
  const listed = git(dir, ['ls-tree', '-r', '--name-only', ref])
  if (!listed.ok) return { unread: `reading what landed: ${listed.out.split('\n')[0] || 'git ls-tree failed'}` }
  const show = (file: string) => {
    const done = git(dir, ['show', `${ref}:${file}`])
    return done.ok ? done.out : ''
  }
  return { ref, files: listed.out.split('\n').filter(Boolean), show, fetched }
}

/** Each landed package.json that installs the kit, with its tag and the bun.lock commit that serves it. */
function installsIn({ files, show }: Tree, kitTags: Map<string, string>): App['installs'] {
  const tracked = new Set(files)
  /** The commit app-kit is locked to for a package.json: its folder's bun.lock, else the nearest one above. */
  const lockFor = (file: string, tag: string) => {
    const folders = file.split('/').slice(0, -1)
    for (let depth = folders.length; depth >= 0; depth--) {
      const lockFile = [...folders.slice(0, depth), 'bun.lock'].join('/')
      if (!tracked.has(lockFile)) continue
      const commit = show(lockFile).match(LOCKED)?.[1]
      return commit ? { commit, matchesTag: !!kitTags.get(tag)?.startsWith(commit) } : null
    }
    return null
  }
  return files
    .filter((file) => (file === 'package.json' || file.endsWith('/package.json')) && !file.includes('node_modules/'))
    .flatMap((file) => {
      const tag = show(file).match(INSTALL)?.[1]
      return tag ? [{ file, tag, locked: lockFor(file, tag) }] : []
    })
}

/** The oldest tag any of these installs names: an app with installs on two versions is on the older. */
function oldestOf(installs: App['installs']): string {
  return installs.map((install) => install.tag).sort(compareVersions)[0]
}

/** Fetches a checkout's origin, which moves only its remote branches; when, or why it failed. */
function fetchOrigin(dir: string): string {
  const done = git(dir, ['fetch', '-q', 'origin'])
  return done.ok ? new Date().toISOString() : `fetch failed: ${done.out.split('\n')[0]}`
}

/**
 * One checkout as it landed; unread when its landed tree cannot be read; null when nothing it landed installs the kit.
 */
export async function readApp(dir: string, kitTags: Map<string, string>, changes: string, fetch: boolean, apple: AppleLookup = appleServers): Promise<App | Unread | null> {
  const tree = landedTree(dir, fetch ? fetchOrigin(dir) : 'not fetched')
  if ('unread' in tree) return { project: projectOf(dir), unread: tree.unread }
  const { ref, files, show, fetched } = tree
  const installs = installsIn(tree, kitTags)
  if (!installs.length) return null
  const oldest = oldestOf(installs)
  const backlog = files.includes('.claude/plans/backlog.md') ? show('.claude/plans/backlog.md') : ''
  const pending = changesSince(changes, oldest)
  const levels = pending.flatMap((change) => (change.urgency ? [URGENCIES.indexOf(change.urgency)] : []))
  return {
    project: projectOf(dir),
    installs,
    behind: [...kitTags.keys()].filter((tag) => compareVersions(tag, oldest) > 0).length,
    changes: pending,
    urgency: levels.length ? URGENCIES[Math.max(...levels)] : null,
    tickets: kitTickets(backlog),
    ...(await featuresOf(landedAt(dir, ref), apple)),
    fetched,
  }
}

/** The kit's tags on GitHub, each to its commit (a tag's own object peeled to the commit it names). */
export function tagsOnGitHub(kit: string): Map<string, string> {
  const tags = new Map<string, string>()
  const listed = git(kit, ['ls-remote', '--tags', 'origin'])
  if (!listed.ok) throw new Error(`reading the kit's tags from GitHub: ${listed.out}`)
  for (const line of listed.out.split('\n')) {
    const [sha, ref] = line.split(/\s+/)
    const tag = ref?.replace('refs/tags/', '').replace('^{}', '')
    if (tag && /^v\d+\.\d+\.\d+$/.test(tag) && (ref.endsWith('^{}') || !tags.has(tag))) tags.set(tag, sha)
  }
  return tags
}

/** The git checkouts directly inside a folder, apart from the one given. */
export function checkoutsIn(folder: string, apart?: string): string[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(folder, entry.name))
    .filter((dir) => existsSync(join(dir, '.git')) && (!apart || resolve(dir) !== resolve(apart)))
}

/** How long one app's fetch may take before the urgent list names it unread: main and the tag are pushed by then. */
export const FETCH_LIMIT_MS = 60_000

/**
 * The apps in a folder on a version before `version`, each by the oldest tag it installs, and the checkouts that could
 * not be read, for the landing of an urgent release. Every checkout with an origin is fetched first, all at once and
 * each within `limitMs`, so an app that took up the kit since its last fetch is read too, and the list is of what each
 * app has landed now. One whose fetch fails or runs out of time is named unread, never listed by a tree that may be
 * stale; a checkout with no origin is read as it is.
 */
export async function olderThan(version: string, folder: string, apart?: string, limitMs = FETCH_LIMIT_MS): Promise<{ older: { project: string; tag: string }[]; unread: Unread[] }> {
  const older: { project: string; tag: string }[] = []
  const unread: Unread[] = []
  const fetched = await Promise.all(
    checkoutsIn(folder, apart).map(async (dir) => {
      if (!git(dir, ['remote', 'get-url', 'origin']).ok) return { dir, failed: null }
      const child = Bun.spawn(['git', '-C', dir, 'fetch', '-q', 'origin'], { stdout: 'ignore', stderr: 'pipe', timeout: limitMs })
      const err = new Response(child.stderr).text()
      const status = await child.exited
      if (status === 0) return { dir, failed: null }
      // A child git started (such as the remote's side) can keep stderr open after git is stopped, so a stopped fetch is
      // not waited on for its message.
      if (child.signalCode) return { dir, failed: `fetch did not finish within ${limitMs / 1000} seconds` }
      return { dir, failed: `fetch failed: ${(await err).trim().split('\n')[0] || `git exited ${status}`}` }
    }),
  )
  for (const { dir, failed } of fetched) {
    const tree = failed ? { unread: failed } : landedTree(dir, 'fetched')
    if ('unread' in tree) {
      unread.push({ project: projectOf(dir), unread: tree.unread })
      continue
    }
    const installs = installsIn(tree, new Map())
    if (installs.length && compareVersions(oldestOf(installs), `v${version.replace(/^v/, '')}`) < 0) older.push({ project: projectOf(dir), tag: oldestOf(installs) })
  }
  const byName = (a: { project: string }, b: { project: string }) => a.project.localeCompare(b.project)
  return { older: older.sort(byName), unread: unread.sort(byName) }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const fetch = !args.includes('--no-fetch')
  const folders = args.filter((arg) => !arg.startsWith('--'))
  if (!folders.length) {
    console.error('usage: bun scripts/apps.ts <folder>... [--no-fetch]')
    process.exit(2)
  }
  const kit = resolve(import.meta.dir, '..')
  // A report must never read missing data as an app being up to date, so the kit's tags and CHANGES.md are required.
  const kitTags = tagsOnGitHub(kit)
  if (!kitTags.size) throw new Error('GitHub lists no version tags for the kit')
  const fetched = git(kit, ['fetch', '-q', '--no-tags', 'origin', 'main'])
  if (!fetched.ok) throw new Error(`fetching the kit's main: ${fetched.out}`)
  const shown = git(kit, ['show', 'origin/main:CHANGES.md'])
  if (!shown.ok) throw new Error(`reading CHANGES.md on the kit's main: ${shown.out}`)
  const changes = shown.out
  const newest = [...kitTags.keys()].sort(compareVersions).pop() ?? null
  const dirs = folders.flatMap((folder) => checkoutsIn(folder, kit))
  const read = (await Promise.all(dirs.map((dir) => readApp(dir, kitTags, changes, fetch)))).filter((app) => app !== null)
  const apps = read.filter((app): app is App => !('unread' in app))
  const unread = read.filter((app): app is Unread => 'unread' in app)
  console.log(JSON.stringify({ newest, read: new Date().toISOString(), apps, unread }, null, 2))
}
