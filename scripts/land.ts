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
//      .claude/plans is none and skips the gates, so ticket landings keep working
//   5. rebase on the pinned commit, then, on a detached head so a stopped run never leaves it on the branch, commit
//      the new version and the README's install lines
//   6. the gates, then one push of main and the tag, never forced, so it only moves main forward and adds no commit:
//      every commit keeps Worktron as author and committer. Refused because another landing moved main: start again,
//      up to three tries
//   7. push the branch
//
// Tags are made only on GitHub, never in the local repository: every worktree shares one set, so a tag made in one
// and never pushed would hide a missing tag from the next landing.
//
// Exit codes: 0 landed; 1 stopped, the last line says why.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type Kind = 'minor' | 'patch' | 'none'
export type Outcome = { landed: true; sha: string; version?: string } | { landed: false; reason: string }

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

/**
 * The exact trailer the version commit ends with. Its address is joined from two parts because test/public.test.ts
 * fails on any address in a file other than example.com and worktron.com ones, in every commit on every branch.
 */
export const TRAILER = ['Co-Authored-By: Claude <noreply', 'anthropic.com>'].join('@')
const KINDS: Kind[] = ['none', 'patch', 'minor']
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

/** The version after a change of this kind; while the version is 0.x, minor raises the middle number. */
export function nextVersion(version: string, kind: Exclude<Kind, 'none'>): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
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
    const commits = (await must('log', `${base}..HEAD`, '--format=%(trailers:key=Release,valueonly)%x00%B%x01'))
      .split('\x01')
      .filter((commit) => commit.trim())
      .map((commit) => {
        const [releases, message] = commit.split('\x00')
        return { releases: releases.split('\n').filter((value) => value.trim()), message }
      })
    const decided = kindOf(commits, changed)
    if ('refused' in decided) return stop(decided.refused.replace('<branch>', branch))
    const { kind, plansOnly } = decided
    log(`${branch}: ${decided.why}`)

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
        await must('commit', '-q', '-a', '-m', `Version ${version}\n\n${TRAILER}`)
        log(`version ${mainVersion} becomes ${version}, with the README's install lines`)
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
      return { landed: true, sha: head, version }
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
    console.log(`land-main: main is at ${outcome.sha.slice(0, 7)}`)
  } else {
    console.error(`land-main: stopped: ${outcome.reason}`)
    process.exit(1)
  }
}
