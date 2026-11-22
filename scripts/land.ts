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
//      what it asks of an app, in an `Urgency:` line: now, next round or rides along
//   5. rebase on the pinned commit, then, on a detached head so a stopped run never leaves it on the branch, commit
//      the new version, the README's install lines and the Urgency and Apps lines under the version in CHANGES.md,
//      which each app reads from its own version up when it is next worked on
//   6. the gates, then one push of main and the tag, never forced, so it only moves main forward and adds no commit:
//      every commit keeps Worktron as author and committer. Refused because another landing moved main: start again,
//      up to three tries
//   7. push the branch
//   8. a release whose urgency is now: name the apps on this machine on an older version, and any checkout it could not
//      read, in one line the landed reply quotes for the owner, who decides which to fix, then start
//      scripts/urgent-tickets.ts detached, which files one catch-up ticket in each of those apps' backlogs; it starts no
//      thread and no upgrade
//
// Tags are made only on GitHub, never in the local repository: every worktree shares one set, so a tag made in one
// and never pushed would hide a missing tag from the next landing.
//
// Exit codes: 0 landed; 1 stopped, the last line says why.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { olderThan, type Unread } from './apps.ts'

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
  /** The folder of checkouts read for apps on an older version when a release is urgent; none reads nothing. */
  appsFolder?: string
}

/** The exact trailer the version commit ends with. */
export const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>'
const KINDS: Kind[] = ['none', 'patch', 'minor']
/**
 * What a release asks of an app, least to most: nothing to do; something an app must change or will want, taken when it
 * is next worked on; take it first (a security hole, lost data, something broken people hit). The kit starts no
 * upgrades: each app reads CHANGES.md from its own version up when it is next worked on.
 */
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
 * trailer is refused rather than dropped. A line repeated across the branch's commits is listed once.
 */
export function appsOf(commits: { apps: string[]; message: string }[], kind: Kind): { lines: string[] } | { refused: string } {
  // Each line git read as a trailer starts its own line in the message, so any more lines starting Apps: sit elsewhere.
  if (commits.some((commit) => (commit.message.match(/^apps:/gim)?.length ?? 0) > commit.apps.length)) {
    return { refused: 'an Apps: line is in a commit message but not in its last paragraph, where git reads it; put it beside Release and Co-Authored-By' }
  }
  const lines = [...new Set(commits.flatMap((commit) => commit.apps.map((value) => value.trim()).filter(Boolean)))]
  if (kind === 'minor' && !lines.length) {
    return { refused: `a minor change must say what an app does about it; add an Apps: line beside the Release line, such as "Apps: an extension's manifest moves to its checkout's root", or mark the change patch if apps need do nothing` }
  }
  return { lines: kind === 'none' ? [] : lines }
}

/**
 * What the change asks of apps, from each commit's Urgency trailer; the most urgent wins. A minor or patch change
 * must say; a none change never reaches an app, so it has no urgency. A change apps must take (now or next round) must
 * also say what an app does, so an app reading CHANGES.md knows what to change. An Urgency line git did not read as a
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
    return { refused: `a ${kind} change must say how soon apps take it; add an Urgency: line beside the Release line: now (a security hole, lost data, or something broken people hit, such as sign-in failing; the landing names the apps on an older version), next round (something an app must change or will want, taken when it is next worked on) or rides along (nothing an app needs to do)` }
  }
  const urgency = URGENCIES[Math.max(...found.map((value) => URGENCIES.indexOf(value as Urgency)))]
  if (urgency !== 'rides along' && !apps.length) return { refused: `a change marked ${urgency} must say what an app does about it; add an Apps: line beside the Urgency line` }
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

What an app does when it moves to each version, newest first, written by the landing from each change's Urgency and Apps lines. A version not listed asks nothing of an app. The kit starts no upgrades: each app keeps itself current by reading this, when it is next worked on, from the oldest version any of its package.json files installs, and taking in what that work needs. Urgency says what a version asks: now (a security hole, lost data, or something broken people hit; take it first, and its landing names the apps on an older version to the owner and files a catch-up ticket in each), next round (something an app must change or will want, taken when the app is next worked on) or rides along (nothing for an app to do). scripts/owed.ts lists the now and next round versions an app has not taken, for metamax's landing of the app's code to hold on once one is more than 14 days old.`

/** The version after a change of this kind; while the version is 0.x, minor raises the middle number. */
export function nextVersion(version: string, kind: Exclude<Kind, 'none'>): string {
  const [major, minor, patch] = version.split('.').map(Number)
  return kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

/**
 * The landing's line for an urgent release: the apps on an older version, each by its oldest tag, and any unread.
 * Metamax's landed reply quotes every landing line that starts `land-main: v` and holds `is urgent;`, so both urgent
 * lines keep those two pieces (test/land.test.ts holds them).
 */
export function urgentReadFailure(version: string, folder: string, why: string): string {
  return `v${version} is urgent; could not read the apps in ${folder}: ${why}`
}

export function urgentLine(version: string, { older, unread }: { older: { project: string; tag: string }[]; unread: Unread[] }): string {
  const listed = older.length ? older.map(({ project, tag }) => `${project} (${tag})`).join(', ') : 'none'
  return `v${version} is urgent; apps on an older version: ${listed}${unread.length ? `; could not read: ${unread.map(({ project, unread: why }) => `${project} (${why})`).join(', ')}` : ''}`
}

/**
 * After a landing: when it released a version marked now, start scripts/urgent-tickets.ts detached, its output to a log
 * in the kit's git folder, and say so; or, with METAMAX_HOME unset, say no tickets were filed and how to file them.
 * Returns the landing's line, or null for any other outcome.
 */
export function startUrgentTickets(outcome: Outcome, { metamax, kit, gitFolder, start }: { metamax: string | undefined; kit: string; gitFolder: string; start: (command: string[], log: string) => void }): string | null {
  if (!outcome.landed || !outcome.version || outcome.urgency !== 'now') return null
  const { version } = outcome
  const again = `bun scripts/urgent-tickets.ts v${version}`
  if (!metamax) return `urgent tickets: not filed, since METAMAX_HOME is not set; file them with METAMAX_HOME set to metamax's checkout: ${again}`
  // Detached, to a log of its own: a ticket in an app that lands through a pull request waits on that app's checks,
  // and whoever reads this landing's output may stop once it ends.
  const log = join(gitFolder, `urgent-tickets-v${version}.log`)
  start(['bun', join(kit, 'scripts/urgent-tickets.ts'), `v${version}`], log)
  return `urgent tickets: filing a catch-up ticket in each app behind v${version} after this landing; results in ${log}, again with ${again}`
}

const runGatesScript = async (cwd: string) => (await Bun.spawn(['bash', 'scripts/gates.sh'], { cwd, stdio: ['inherit', 'inherit', 'inherit'] }).exited) === 0

export async function land({ cwd, runGates = runGatesScript, tries = 3, log = () => {}, env = process.env, appsFolder }: LandOptions): Promise<Outcome> {
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
  // package.json's version at each commit, read by one git cat-file rather than a git show each. Each answer is cut by
  // the byte count git gives, and a commit without the file stops the landing with git's answer, never a guessed version.
  const versionsAt = async (commits: string[]) => {
    const child = Bun.spawn(['git', 'cat-file', '--batch'], { cwd, env, stdin: new TextEncoder().encode(commits.map((commit) => `${commit}:package.json\n`).join('')), stdout: 'pipe', stderr: 'pipe' })
    const [out, err, status] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited])
    if (status !== 0) throw new Error(`git cat-file --batch: ${err.trim()}`)
    const bytes = Buffer.from(out)
    let at = 0
    return commits.map((commit) => {
      const end = bytes.indexOf(10, at)
      const header = bytes.subarray(at, end === -1 ? bytes.length : end).toString()
      const [, type, size] = header.split(' ')
      if (end === -1 || type !== 'blob') throw new Error(`reading ${commit}:package.json: git answered ${header ? `"${header}"` : 'nothing'}`)
      const text = bytes.subarray(end + 1, end + 1 + Number(size)).toString()
      at = end + 1 + Number(size) + 1
      return (JSON.parse(text) as { version: string }).version
    })
  }
  const tagOnGitHub = async (version: string) => (await must('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) !== ''
  const pushTag = async (commit: string, version: string) => {
    const done = await git('push', '-q', 'origin', `${commit}:refs/tags/v${version}`)
    if (!done.ok) throw new Error(`pushing the tag v${version}: ${done.err}`)
    log(`tagged v${version} on ${commit.slice(0, 7)}`)
  }
  const stop = (reason: string): Outcome => ({ landed: false, reason })

  // One rev-parse answers where a rebase would keep its folders, the branch's commit and the branch's name (HEAD when
  // detached); the status runs beside it. The checks still stop in this order.
  const [[rebaseMerge, rebaseApply, original, head], status] = await Promise.all([
    must('rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', 'HEAD', '--symbolic-full-name', 'HEAD').then((out) => out.split('\n')),
    git('status', '--porcelain', '--untracked-files=no'),
  ])
  const branch = head?.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : ''
  if (!branch) {
    const last = (await must('reflog', '--format=%gs')).match(/^checkout: moving from (\S+) to /m)?.[1]
    return stop(`the checkout is on a detached head, as a landing that was killed leaves it; check out the branch first${last ? `: git checkout ${last}` : ''}`)
  }
  if (branch === 'main') return stop('this is main; land from the branch that holds the work')
  if ([rebaseMerge, rebaseApply].some((path) => existsSync(resolve(cwd, path)))) return stop('a rebase is in progress here; finish it, or run git rebase --abort')
  if (!status.ok) throw new Error(`git status --porcelain --untracked-files=no: ${status.err}`)
  if (status.out) return stop('there are uncommitted changes; commit them first')

  for (let attempt = 1; attempt <= tries; attempt++) {
    // Not -q, which keeps the porcelain lines back too: the FETCH_HEAD line names the commit fetched as main, so no
    // second git asks for it, and the pin is what this fetch saw even if another worktree's fetch moves the shared ref.
    const fetched = await git('fetch', '--no-tags', '--porcelain', 'origin', 'main')
    if (!fetched.ok) return stop(`fetching main: ${fetched.err}`)
    const pin = fetched.out.match(/(?:^|\s)[0-9a-f]{40,64} ([0-9a-f]{40,64}) FETCH_HEAD$/m)?.[1]
    if (!pin) return stop(`fetching main: git named no commit for main: ${fetched.err || 'it printed nothing'}`)
    // At every try the branch is at the commit it started from, since a try that starts again puts it back there first.
    // The branch is in main when the base it shares with main is that commit, so one merge-base answers both questions.
    const base = await must('merge-base', pin, original)
    const [[mainVersion, baseVersion, branchVersion], changedFiles, logged] = await Promise.all([
      versionsAt([pin, base, original]),
      must('diff', '--name-only', base, original),
      must('log', `${base}..${original}`, '--format=%(trailers:key=Release,valueonly)%x00%(trailers:key=Apps,valueonly,unfold)%x00%(trailers:key=Urgency,valueonly,unfold)%x00%B%x01'),
    ])
    log(`main is at ${pin.slice(0, 7)}, version ${mainVersion}${attempt > 1 ? `, try ${attempt} of ${tries}` : ''}`)

    if (!(await tagOnGitHub(mainVersion))) {
      log(`main's version ${mainVersion} has no tag on GitHub (released by hand, or a push whose answer was lost); tagging main`)
      await pushTag(pin, mainVersion)
    }
    if (base === original) {
      log(`${branch} is already in main`)
      return { landed: true, sha: pin }
    }

    if (baseVersion !== branchVersion) {
      return stop(`${branch} changes package.json's version from ${baseVersion} to ${branchVersion}; drop that edit, since the landing sets the version, and say the kind of change with a Release: line`)
    }
    const changed = changedFiles.split('\n').filter(Boolean)
    const commits = logged
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
    if (urgency) log(`${branch}: ${urgency === 'now' ? 'urgent: apps take it first' : urgency === 'next round' ? 'apps take it when next worked on, with something to do' : 'apps take it when next worked on, with nothing to do'}`)

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
    if (outcome !== 'again') {
      // Main and the tag are pushed, so reading the apps never stops the landing: a failure is said, not thrown.
      if (outcome.landed && outcome.version && outcome.urgency === 'now' && appsFolder) {
        try {
          log(urgentLine(outcome.version, await olderThan(outcome.version, appsFolder)))
        } catch (error) {
          log(urgentReadFailure(outcome.version, appsFolder, error instanceof Error ? error.message : String(error)))
        }
      }
      return outcome
    }
  }
  return stop(`main moved under each of ${tries} tries; land again`)
}

if (import.meta.main) {
  const top = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { stdout: 'pipe' }).stdout.toString().trim()
  // The apps are the checkouts beside the kit's main checkout, the folder the apps page reads.
  const common = Bun.spawnSync(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { stdout: 'pipe' }).stdout.toString().trim()
  const appsFolder = common ? dirname(dirname(common)) : undefined
  const outcome = await land({ cwd: top || process.cwd(), log: (line) => console.log(`land-main: ${line}`), appsFolder }).catch(
    (error): Outcome => ({ landed: false, reason: error instanceof Error ? error.message : String(error) }),
  )
  if (outcome.landed) {
    console.log(outcome.version ? `land-main: released v${outcome.version}` : 'land-main: no release, the change is none')
    console.log(`land-main: main is at ${outcome.sha.slice(0, 7)}`)
    const kit = top || process.cwd()
    const start = (command: string[], log: string) => Bun.spawn(command, { cwd: kit, stdin: 'ignore', stdout: Bun.file(log), stderr: Bun.file(log), detached: true }).unref()
    const urgent = startUrgentTickets(outcome, { metamax: process.env.METAMAX_HOME, kit, gitFolder: common || join(kit, '.git'), start })
    if (urgent) console.log(`land-main: ${urgent}`)
  } else {
    console.error(`land-main: stopped: ${outcome.reason}`)
    process.exit(1)
  }
}
