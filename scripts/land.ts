#!/usr/bin/env bun
// Lands the current branch on main and releases it, run by scripts/land-main.sh, which /metamax:land runs. A branch
// never writes a version number: its commits say what kind of change it is with a `Release: minor`, `Release: patch`
// or `Release: none` line beside Co-Authored-By, and the number is worked out here from main at the moment of landing,
// the one moment only one thread can pass. So two threads landing at once never take the same number.
//
//   1. refuse main, a detached head, a rebase in progress, uncommitted changes; fetch and pin main's commit
//   2. main's version untagged on GitHub (a release landed by hand, or a push whose answer was lost): tag main's commit
//   3. a branch already in main: stop there
//   4. refuse a hand edit to the version, and a missing or unknown Release line; a branch touching only
//      .claude/plans is none and skips the gates, so ticket landings keep working. A minor change must also say what
//      an app does about it, in an `Apps:` line beside the Release line; a patch may. A minor or patch change also says
//      how soon apps must take it, in an `Urgency:` line: now, next round or rides along
//   5. rebase on the pinned commit, then, on a detached head so a stopped run never leaves it on the branch, commit
//      the new version, the README's install lines and the Urgency and Apps lines under the version in CHANGES.md,
//      which app-kit's apps round reads to start each app's upgrade
//   6. the gates, then one push of main and the tag, never forced, so it only moves main forward and adds no commit:
//      every commit keeps Worktron as author and committer. Refused because another landing moved main: start again,
//      up to three tries
//   7. push the branch
//   8. a release whose urgency is now: report it to metamax, whose automation starts the apps round that day, and say
//      when no round started
//
// Tags are made only on GitHub, never in the local repository: every worktree shares one set, so a tag made in one
// and never pushed would hide a missing tag from the next landing.
//
// Exit codes: 0 landed; 1 stopped, the last line says why.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type Kind = 'minor' | 'patch' | 'none'
export type Outcome = { landed: true; sha: string; version?: string; urgency?: Urgency; apps?: string[] } | { landed: false; reason: string }

export interface LandOptions {
  /** The checkout of the branch to land. */
  cwd: string
  /** Runs the gates on the checkout as it will land; true when they pass. */
  runGates?: (cwd: string) => Promise<boolean>
  /** How many times to start again when another landing moves main first. */
  tries?: number
  /** Where each decision is said; the command prints it as a land-main: line. */
  log?: (line: string) => void
  env?: Record<string, string | undefined>
}

/** The exact trailer the version commit ends with. */
export const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'
const KINDS: Kind[] = ['none', 'patch', 'minor']
/** How soon apps take a release, least to most: picked up by the next upgrade, the Monday round, a round that day. */
export const URGENCIES = ['rides along', 'next round', 'now'] as const
export type Urgency = (typeof URGENCIES)[number]
const PLANS = '.claude/plans/'

/**
 * The kind of change a branch's commits declare: each commit's Release trailer values, read the way git reads
 * Co-Authored-By, and its whole message, for a line git did not read as a trailer. The largest kind wins; a branch
 * changing only plan files needs no line.
 */
export function kindOf(commits: { releases: string[]; message: string }[], changed: string[]): { kind: Kind; plansOnly: boolean; why: string } | { refused: string } {
  const plansOnly = changed.length > 0 && changed.every((path) => path.startsWith(PLANS))
  const found = commits.flatMap((commit) => commit.releases.map((value) => value.trim().toLowerCase()))
  const unknown = found.filter((value) => !KINDS.includes(value as Kind))
  if (unknown.length) return { refused: `Release: ${unknown.join(', ')} is not a kind of change; write minor, patch or none (while the version is 0.x, minor is the kind apps may have to change for)` }
  if (found.length) {
    const kind = KINDS[Math.max(...found.map((value) => KINDS.indexOf(value as Kind)))]
    return { kind, plansOnly, why: `Release lines ${found.join(', ')}; the change is ${kind}` }
  }
  if (commits.some((commit) => /^release:/im.test(commit.message))) {
    return { refused: 'a Release: line is in a commit message but not in its last paragraph, where git reads it; put it beside Co-Authored-By' }
  }
  if (plansOnly) return { kind: 'none', plansOnly, why: 'only plan files change, so the change is none' }
  return { refused: 'no commit on <branch> says what kind of change it is; add Release: minor, Release: patch or Release: none beside Co-Authored-By' }
}

/**
 * What an app must do about the change, from each commit's Apps trailer, read unfolded so a wrapped line stays one.
 * A minor change, the kind apps may have to change for, must say; a patch may. An Apps line git did not read as a
 * trailer is refused rather than dropped.
 */
export function appsOf(commits: { apps: string[]; message: string }[], kind: Kind): { lines: string[] } | { refused: string } {
  // Each line git read as a trailer starts its own line in the message, so any more lines starting Apps: sit elsewhere.
  if (commits.some((commit) => (commit.message.match(/^apps:/gim)?.length ?? 0) > commit.apps.length)) {
    return { refused: 'an Apps: line is in a commit message but not in its last paragraph, where git reads it; put it beside Release and Co-Authored-By' }
  }
  const lines = commits.flatMap((commit) => commit.apps.map((value) => value.trim()).filter(Boolean))
  if (kind === 'minor' && !lines.length) {
    return { refused: `a minor change must say what an app does about it; add an Apps: line beside the Release line, such as "Apps: an extension's manifest moves to its checkout's root", or mark the change patch if apps need do nothing` }
  }
  return { lines: kind === 'none' ? [] : lines }
}

/**
 * How soon apps must take the change, from each commit's Urgency trailer; the most urgent wins. A minor or patch change
 * must say; a none change never reaches an app, so it has no urgency. A change apps must take (now or next round) must
 * also say what an app does, so the round has an Apps line to brief from. An Urgency line git did not read as a
 * trailer is refused rather than dropped.
 */
export function urgencyOf(commits: { urgencies: string[]; message: string }[], kind: Kind, apps: string[]): { urgency: Urgency | null } | { refused: string } {
  if (commits.some((commit) => (commit.message.match(/^urgency:/gim)?.length ?? 0) > commit.urgencies.length)) {
    return { refused: 'an Urgency: line is in a commit message but not in its last paragraph, where git reads it; put it beside Release and Co-Authored-By' }
  }
  const found = commits.flatMap((commit) => commit.urgencies.map((value) => value.trim().toLowerCase().replace(/\s+/g, ' ')))
  const unknown = found.filter((value) => !URGENCIES.includes(value as Urgency))
  if (unknown.length) return { refused: `Urgency: ${unknown.join(', ')} is not an urgency; write now, next round or rides along` }
  if (kind === 'none') return { urgency: null }
  if (!found.length) {
    return { refused: `a ${kind} change must say how soon apps take it; add an Urgency: line beside the Release line: now (a security hole, lost data, or something broken people hit, such as sign-in failing), next round (something an app must change or will want) or rides along (nothing an app needs to do)` }
  }
  const urgency = URGENCIES[Math.max(...found.map((value) => URGENCIES.indexOf(value as Urgency)))]
  if (urgency !== 'rides along' && !apps.length) return { refused: `a change apps take ${urgency === 'now' ? 'now' : 'at the next round'} must say what an app does about it; add an Apps: line beside the Urgency line` }
  return { urgency }
}

/** CHANGES.md with a version's urgency and Apps lines added above the newest version's, the file made with its heading when new. */
export function withChanges(text: string | null, version: string, urgency: Urgency, lines: string[]): string {
  const entry = `## v${version}\n\nUrgency: ${urgency}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`
  const current = text ?? `${CHANGES_HEADING}\n`
  const at = current.search(/^## /m)
  return at === -1 ? `${current.replace(/\s*$/, '')}\n\n${entry}` : `${current.slice(0, at)}${entry}\n${current.slice(at)}`
}

/** The start of CHANGES.md, when a landing makes it. */
export const CHANGES_HEADING = `# Changes

What an app does when it moves to each version, newest first, written by the landing from each change's Urgency and Apps lines. A version not listed asks nothing of an app. Urgency says how soon apps take it: now (app-kit's apps round starts the upgrades that day), next round (the Monday round) or rides along (the app's next upgrade).`

/** The version after a change of this kind; while the version is 0.x, minor raises the middle number. */
export function nextVersion(version: string, kind: Exclude<Kind, 'none'>): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

/** Runs metamax's report-event with these arguments, and what it printed. */
export type ReportEvent = (args: string[]) => Promise<{ ok: boolean; out: string }>

/** The event metamax's automation for the same-day apps round runs on. */
export const URGENT_EVENT = 'app-kit-urgent-release'

/**
 * Tells metamax a release apps take now landed, so its automation starts the apps round that day. Metamax answers
 * with one line per automation, `<id>: started` when it started one; a round still open, no automation, or no metamax
 * answers otherwise, and the line returned then says the round must be started by hand.
 */
export async function announceUrgent(version: string, apps: string[], report: ReportEvent | null): Promise<string> {
  const byHand = `hand v${version} to the open apps round or start one (.claude/skills/apps-round)`
  if (!report) return `the same-day apps round did not start: metamax is not here to tell; ${byHand}`
  const done = await report([URGENT_EVENT, 'app-kit', `v${version}: ${apps[0] ?? 'a release apps take now'}`])
  const answer = done.out.trim().replace(/\s*\n\s*/g, '; ') || 'no answer'
  if (done.ok && /: started\b/.test(done.out)) return `the same-day apps round started: ${answer}`
  return `the same-day apps round did not start: ${answer}; ${byHand}`
}

const runGatesScript = async (cwd: string) => (await Bun.spawn(['bash', 'scripts/gates.sh'], { cwd, stdio: ['inherit', 'inherit', 'inherit'] }).exited) === 0

export async function land({ cwd, runGates = runGatesScript, tries = 3, log = () => {}, env = process.env }: LandOptions): Promise<Outcome> {
  const run = async (command: string, ...args: string[]) => {
    const child = Bun.spawn([command, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { ok: status === 0, out: out.trim(), err: `${err}${out}`.trim() }
  }
  const git = (...args: string[]) => run('git', ...args)
  const must = async (...args: string[]) => {
    const done = await git(...args)
    if (!done.ok) throw new Error(`git ${args.join(' ')}: ${done.err}`)
    return done.out
  }
  const versionAt = async (commit: string) => (JSON.parse(await must('show', `${commit}:package.json`)) as { version: string }).version
  const tagOnGitHub = async (version: string) => (await must('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) !== ''
  const pushTag = async (commit: string, version: string) => {
    const done = await git('push', '-q', 'origin', `${commit}:refs/tags/v${version}`)
    if (!done.ok) throw new Error(`pushing the tag v${version}: ${done.err}`)
    log(`tagged v${version} on ${commit.slice(0, 7)}`)
  }
  const stop = (reason: string): Outcome => ({ landed: false, reason })

  const branch = (await git('symbolic-ref', '--short', '-q', 'HEAD')).out
  if (!branch) {
    const last = (await must('reflog', '--format=%gs')).match(/^checkout: moving from (\S+) to /m)?.[1]
    return stop(`the checkout is on a detached head, as a landing that was killed leaves it; check out the branch first${last ? `: git checkout ${last}` : ''}`)
  }
  if (branch === 'main') return stop('this is main; land from the branch that holds the work')
  const rebaseFolders = (await must('rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply')).split('\n')
  if (rebaseFolders.some((path) => existsSync(resolve(cwd, path)))) return stop('a rebase is in progress here; finish it, or run git rebase --abort')
  if (await must('status', '--porcelain', '--untracked-files=no')) return stop('there are uncommitted changes; commit them first')
  const original = await must('rev-parse', 'HEAD')

  for (let attempt = 1; attempt <= tries; attempt++) {
    const fetched = await git('fetch', '-q', '--no-tags', 'origin', 'main')
    if (!fetched.ok) return stop(`fetching main: ${fetched.err}`)
    const pin = await must('rev-parse', 'refs/remotes/origin/main')
    const mainVersion = await versionAt(pin)
    log(`main is at ${pin.slice(0, 7)}, version ${mainVersion}${attempt > 1 ? `, try ${attempt} of ${tries}` : ''}`)

    if (!(await tagOnGitHub(mainVersion))) {
      log(`main's version ${mainVersion} has no tag on GitHub (released by hand, or a push whose answer was lost); tagging main`)
      await pushTag(pin, mainVersion)
    }
    if ((await git('merge-base', '--is-ancestor', 'HEAD', pin)).ok) {
      log(`${branch} is already in main`)
      return { landed: true, sha: pin }
    }

    const base = await must('merge-base', pin, 'HEAD')
    const [baseVersion, branchVersion] = await Promise.all([versionAt(base), versionAt('HEAD')])
    if (baseVersion !== branchVersion) {
      return stop(`${branch} changes package.json's version from ${baseVersion} to ${branchVersion}; drop that edit, since the landing sets the version, and say the kind of change with a Release: line`)
    }
    const changed = (await must('diff', '--name-only', base, 'HEAD')).split('\n').filter(Boolean)
    const commits = (await must('log', `${base}..HEAD`, '--format=%(trailers:key=Release,valueonly)%x00%(trailers:key=Apps,valueonly,unfold)%x00%(trailers:key=Urgency,valueonly,unfold)%x00%B%x01'))
      .split('\x01')
      .filter((commit) => commit.trim())
      .map((commit) => {
        const [releases, apps, urgencies, message] = commit.split('\x00')
        const values = (text: string) => text.split('\n').filter((value) => value.trim())
        return { releases: values(releases), apps: values(apps), urgencies: values(urgencies), message }
      })
    const decided = kindOf(commits, changed)
    if ('refused' in decided) return stop(decided.refused.replace('<branch>', branch))
    const { kind, plansOnly } = decided
    log(`${branch}: ${decided.why}`)
    const forApps = appsOf(commits, kind)
    if ('refused' in forApps) return stop(forApps.refused)
    const soon = urgencyOf(commits, kind, forApps.lines)
    if ('refused' in soon) return stop(soon.refused)
    const urgency = soon.urgency ?? undefined
    if (urgency) log(`${branch}: apps take it ${urgency === 'now' ? 'now' : urgency === 'next round' ? 'at the next round' : 'when they next upgrade'}`)

    if (!(await git('rebase', '-q', pin)).ok) {
      const conflicts = (await git('diff', '--name-only', '--diff-filter=U')).out.split('\n').filter(Boolean)
      await git('rebase', '--abort')
      return stop(`${branch} conflicts with main in ${conflicts.join(', ') || 'files git did not name'}; rebase onto origin/main, settle them, and land again`)
    }

    let landedAt: string | undefined
    const release = async (): Promise<Outcome | 'again'> => {
      let version: string | undefined
      if (kind !== 'none') {
        // Only the version's text changes, so package.json keeps its formatting. Not bun pm version: it starts another
        // Bun, and run where no package.json is, it bumps the first one in a folder above.
        version = nextVersion(mainVersion, kind)
        const packageFile = join(cwd, 'package.json')
        writeFileSync(packageFile, readFileSync(packageFile, 'utf8').replace(`"version": "${mainVersion}"`, `"version": "${version}"`))
        if ((JSON.parse(readFileSync(packageFile, 'utf8')) as { version: string }).version !== version) throw new Error(`package.json has no "version": "${mainVersion}" line to change`)
        const readme = join(cwd, 'README.md')
        if (existsSync(readme)) writeFileSync(readme, readFileSync(readme, 'utf8').replaceAll(/app-kit#v\d+\.\d+\.\d+/g, `app-kit#v${version}`))
        if (forApps.lines.length) {
          const changes = join(cwd, 'CHANGES.md')
          writeFileSync(changes, withChanges(existsSync(changes) ? readFileSync(changes, 'utf8') : null, version, urgency ?? 'rides along', forApps.lines))
          await must('add', 'CHANGES.md')
        }
        await must('commit', '-q', '-a', '-m', `Version ${version}\n\n${TRAILER}`)
        log(`version ${mainVersion} becomes ${version}, with the README's install lines${forApps.lines.length ? ` and ${forApps.lines.length} Apps line${forApps.lines.length === 1 ? '' : 's'} in CHANGES.md` : ''}`)
      }

      if (plansOnly) {
        log('the gates are skipped: only plan files change')
      } else if (!(await runGates(cwd))) {
        return stop(`the gates failed on ${branch} rebased onto main; ${branch} is back as it was, so fix it and land again`)
      } else {
        log('the gates passed')
      }

      // Main and the tag move in one push that GitHub takes whole or not at all, so a refused tag never leaves main
      // released without it.
      const head = await must('rev-parse', 'HEAD')
      const pushed = await git('push', '-q', '--atomic', 'origin', 'HEAD:refs/heads/main', ...(version ? [`HEAD:refs/tags/v${version}`] : []))
      if (!pushed.ok) {
        const remoteMain = (await must('ls-remote', 'origin', 'refs/heads/main')).split(/\s/)[0]
        if (remoteMain === pin) return stop(`the push of main failed and main did not move: ${pushed.err}`)
        if (remoteMain !== head) {
          log(`another landing moved main to ${remoteMain.slice(0, 7)} first`)
          return 'again'
        }
        landedAt = head
        log('the push of main reported a failure, but main is at the landed commit')
        if (version && !(await tagOnGitHub(version))) await pushTag(head, version)
      }
      landedAt = head
      log(`main moved to ${head.slice(0, 7)}${version ? `, tagged v${version}` : ''}`)
      if (!(await git('push', '-q', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`)).ok) log(`the branch ${branch} was not pushed to GitHub; main and the tag are`)
      return { landed: true, sha: head, version, urgency, apps: forApps.lines }
    }

    // The version commit is made on a detached head, and every way out puts the branch back: at the landed commit, or
    // at the commit it held before this run, so a stopped run leaves the branch as it was and its copy on GitHub
    // still matching.
    await must('checkout', '-q', '--detach')
    let outcome: Outcome | 'again'
    try {
      outcome = await release()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      outcome = stop(landedAt ? `main moved to ${landedAt.slice(0, 7)} and ${branch} is there, but ${reason}; the next landing pushes the missing tag first` : reason)
    }
    await must('checkout', '-q', '-f', '-B', branch, landedAt ?? original)
    if (outcome !== 'again') return outcome
  }
  return stop(`main moved under each of ${tries} tries; land again`)
}

if (import.meta.main) {
  const top = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stdout: 'pipe' }).stdout.toString().trim()
  const outcome = await land({ cwd: top || process.cwd(), log: (line) => console.log(`land-main: ${line}`) }).catch(
    (error): Outcome => ({ landed: false, reason: error instanceof Error ? error.message : String(error) }),
  )
  if (outcome.landed) {
    console.log(outcome.version ? `land-main: released v${outcome.version}` : 'land-main: no release, the change is none')
    if (outcome.version && outcome.urgency === 'now') {
      const home = process.env.METAMAX_HOME
      const report: ReportEvent | null = home
        ? async (args) => {
            // Main and the tag are already pushed, so a metamax that never answers must not hold the landing open.
            const child = Bun.spawnSync(['bun', join(home, 'scripts/report-event.ts'), ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
            return { ok: child.exitCode === 0, out: `${child.stdout.toString()}${child.stderr.toString()}` }
          }
        : null
      console.log(`land-main: ${await announceUrgent(outcome.version, outcome.apps ?? [], report)}`)
    }
    console.log(`land-main: main is at ${outcome.sha.slice(0, 7)}`)
  } else {
    console.error(`land-main: stopped: ${outcome.reason}`)
    process.exit(1)
  }
}
