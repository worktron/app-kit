#!/usr/bin/env bun
// The apps on the kit, for the apps round (.claude/skills/apps-round): each git checkout directly inside the folders
// given whose landed package.json files install the kit from GitHub, with the tag it names, what its bun.lock installs,
// how many releases it is behind, what CHANGES.md asks of it since its tag, and its open backlog tickets that name the
// kit. It changes no app: it fetches each checkout's origin, which moves only that checkout's remote branches, and
// reads what landed there (origin/HEAD, else HEAD).
//
//   bun scripts/apps.ts <folder>... [--no-fetch]
//
// Prints one JSON object: the kit's newest version, when it read, and the apps. The kit's tags are read from GitHub
// (git ls-remote), never made or fetched into the local repository, which every worktree shares.

import { readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type Ticket = { id: string; title: string }
export type App = {
  project: string
  /** Each landed package.json that installs the kit, with the tag it names. */
  installs: { file: string; tag: string }[]
  /** The commit bun.lock installs, when it names one, and whether it is the commit of the tag package.json names. */
  locked: { commit: string; matchesTag: boolean } | null
  /** Releases since the oldest tag the app names, up to the newest. */
  behind: number
  /** CHANGES.md's entries newer than that tag, newest first. */
  changes: { version: string; lines: string[] }[]
  /** Open sections of its backlog that name app-kit. */
  tickets: Ticket[]
  /** Whether the standing update ticket, app-kit-update, is open. */
  updateTicketOpen: boolean
  /** When its origin was last fetched, or why it could not be. */
  fetched: string
}

/** The standing ticket the round leaves in an app that has none. */
export const UPDATE_TICKET = 'app-kit-update'
const INSTALL = /github:worktron\/app-kit#(v\d+\.\d+\.\d+)/
const LOCKED = /app-kit@github:worktron\/app-kit#([0-9a-f]{7,40})/

/** Versions compared as numbers, so v0.9.0 comes before v0.10.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** CHANGES.md's entries for versions after `from`, newest first, as the file lists them. */
export function changesSince(text: string, from: string): { version: string; lines: string[] }[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const [heading, ...body] = section.split('\n')
      return { version: heading.trim(), lines: body.filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()) }
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

/** One checkout as it landed, or null when nothing it landed installs the kit. */
export function readApp(dir: string, kitTags: Map<string, string>, changes: string, fetch: boolean): App | null {
  let fetched = 'not fetched'
  if (fetch) {
    const done = git(dir, ['fetch', '-q', 'origin'])
    fetched = done.ok ? new Date().toISOString() : `fetch failed: ${done.out.split('\n')[0]}`
  }
  const ref = git(dir, ['rev-parse', '-q', '--verify', 'refs/remotes/origin/HEAD']).ok ? 'origin/HEAD' : 'HEAD'
  const files = git(dir, ['ls-tree', '-r', '--name-only', ref]).out.split('\n')
  const show = (file: string) => {
    const done = git(dir, ['show', `${ref}:${file}`])
    return done.ok ? done.out : ''
  }
  const installs = files
    .filter((file) => (file === 'package.json' || file.endsWith('/package.json')) && !file.includes('node_modules/'))
    .flatMap((file) => {
      const tag = show(file).match(INSTALL)?.[1]
      return tag ? [{ file, tag }] : []
    })
  if (!installs.length) return null
  const oldest = installs.map((install) => install.tag).sort(compareVersions)[0]
  const lock = files.filter((file) => (file === 'bun.lock' || file.endsWith('/bun.lock')) && !file.includes('node_modules/')).map((file) => show(file).match(LOCKED)?.[1]).find(Boolean)
  const tagCommit = kitTags.get(oldest)
  const backlog = files.includes('.claude/plans/backlog.md') ? show('.claude/plans/backlog.md') : ''
  const tickets = kitTickets(backlog)
  return {
    project: dir.split('/').pop() ?? dir,
    installs,
    locked: lock ? { commit: lock, matchesTag: !!tagCommit && tagCommit.startsWith(lock) } : null,
    behind: [...kitTags.keys()].filter((tag) => compareVersions(tag, oldest) > 0).length,
    changes: changesSince(changes, oldest),
    tickets,
    updateTicketOpen: tickets.some((ticket) => ticket.id === UPDATE_TICKET),
    fetched,
  }
}

/** The kit's tags on GitHub, each to its commit (a tag's own object peeled to the commit it names). */
export function tagsOnGitHub(kit: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const line of git(kit, ['ls-remote', '--tags', 'origin']).out.split('\n')) {
    const [sha, ref] = line.split(/\s+/)
    const tag = ref?.replace('refs/tags/', '').replace('^{}', '')
    if (tag && /^v\d+\.\d+\.\d+$/.test(tag) && (ref.endsWith('^{}') || !tags.has(tag))) tags.set(tag, sha)
  }
  return tags
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
  const kitTags = tagsOnGitHub(kit)
  git(kit, ['fetch', '-q', '--no-tags', 'origin', 'main'])
  const shown = git(kit, ['show', 'origin/main:CHANGES.md'])
  const changes = shown.ok ? shown.out : ''
  const newest = [...kitTags.keys()].sort(compareVersions).pop() ?? null
  const apps = folders
    .flatMap((folder) => readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(folder, entry.name)))
    .filter((dir) => existsSync(join(dir, '.git')) && resolve(dir) !== kit)
    .map((dir) => readApp(dir, kitTags, changes, fetch))
    .filter((app): app is App => app !== null)
  console.log(JSON.stringify({ newest, read: new Date().toISOString(), apps }, null, 2))
}
