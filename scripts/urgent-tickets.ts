#!/usr/bin/env bun
// After an urgent release lands (Urgency: now), one catch-up ticket in the backlog of each app on this machine on an
// older version, so the release is waiting where the app's next thread looks, not only in the landing's log. The
// landing starts it detached once main and the tag are pushed (scripts/land.ts), its output to a log in the kit's git
// folder, since landing a ticket in an app that lands through a pull request waits on that app's checks; run it again
// by hand for a release already out:
//
//   bun scripts/urgent-tickets.ts v<x.y.z>
//
// It files tickets and nothing else: it starts no thread and no upgrade. Each app keeps one catch-up ticket (CATCH_UP),
// and metamax's ticket landing refuses an id the backlog already holds, so a second urgent release before the app has
// moved, or a second run, adds nothing. Each result is one `land-main: urgent ticket:` line in the landing's log.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { changesSince, compareVersions, olderThan } from './apps.ts'
import { CATCH_UP } from './owed.ts'

/** The ticket an app behind an urgent release gets, naming the release and what it asks. */
export function catchUpSection(version: string, lines: string[]): string {
  return `## ${CATCH_UP} · Catch up with app-kit, starting with the urgent ${version}

Goal: this app moves to app-kit ${version} or later, taking in what each release since its version asks of it (CHANGES.md, or \`bun scripts/owed.ts <this checkout>\` in app-kit). ${version} is urgent: ${lines.join(' ')}
Done when: every package.json names app-kit ${version} or later, every bun.lock installs it, the app's gates pass and it has landed; then this ticket is dropped.
`
}

/** What landing one ticket answered: ticket-land's exit code and what it printed. */
export type Landed = { code: number; out: string }

/** Files the catch-up ticket in each project, one after another, and says what became of each. */
export async function fileCatchUps(version: string, lines: string[], projects: string[], land: (project: string, sectionFile: string) => Promise<Landed>): Promise<string[]> {
  const folder = mkdtempSync(join(tmpdir(), 'app-kit-urgent-'))
  const file = join(folder, `${CATCH_UP}.md`)
  writeFileSync(file, catchUpSection(version, lines))
  const said: string[] = []
  try {
    for (const project of projects) {
      const { code, out } = await land(project, file).catch((error): Landed => ({ code: -1, out: error instanceof Error ? error.message : String(error) }))
      const last = out.trim().split('\n').pop() ?? ''
      if (code === 0) said.push(`${project}: filed ${CATCH_UP}`)
      else if (code === 3 && /already/.test(out)) said.push(`${project}: already holds ${CATCH_UP}`)
      else said.push(`${project}: not filed (${last || `exit ${code}`}); again: bun scripts/urgent-tickets.ts ${version}`)
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
  return said
}

if (import.meta.main) {
  const say = (line: string) => console.log(`land-main: urgent ticket: ${line}`)
  const version = `v${(Bun.argv[2] ?? '').replace(/^v/, '')}`
  if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    console.error('usage: bun scripts/urgent-tickets.ts v<x.y.z>')
    process.exit(2)
  }
  const metamax = process.env.METAMAX_HOME
  if (!metamax) {
    say(`not filed, since METAMAX_HOME is not set; run this again with it set to metamax's checkout`)
    process.exit(1)
  }
  const kit = join(import.meta.dir, '..')
  const entry = changesSince(readFileSync(join(kit, 'CHANGES.md'), 'utf8'), 'v0.0.0').find((change) => compareVersions(change.version, version) === 0)
  if (!entry) {
    say(`CHANGES.md has no ${version} entry, so no tickets`)
    process.exit(1)
  }
  // The apps are the checkouts beside the kit's main checkout, the folder the landing's urgent list reads.
  const common = Bun.spawnSync(['git', '-C', kit, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { stdout: 'pipe' }).stdout.toString().trim()
  const main = dirname(common)
  const { older, unread } = await olderThan(version, dirname(main), main)
  for (const { project, unread: why } of unread) say(`${project}: not read (${why}), so not filed`)
  if (!older.length) say(`no app is on a version before ${version}`)
  const land = async (project: string, sectionFile: string): Promise<Landed> => {
    const child = Bun.spawn(['bun', join(metamax, 'scripts/ticket-land.ts'), project, 'backlog.md', '--section-file', sectionFile], { stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, out: `${out}\n${err}` }
  }
  for (const line of await fileCatchUps(version, entry.lines, older.map(({ project }) => project), land)) say(line)
}
