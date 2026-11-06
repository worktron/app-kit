// The landing script (scripts/land.ts): the version is worked out from main when a branch lands, so two threads never
// take the same number, and a stopped landing leaves nothing the next one refuses. How a branch's Release lines decide
// the kind of change is tested on its own, with no git. The landings run in scratch repositories whose origin is a bare
// repository standing in for GitHub; a second thread is a second worktree of the same repository, sharing its tags and
// refs as every worktree here does. Scratch folders are under node_modules/.cache, never the system temp folder
// (test/command.test.ts says why), and git reads no global settings, so the commits are the test's own. A landing runs
// some twenty-five git processes, so the tests run side by side, only one of them lands twice, and every other state a
// test needs is made with a plain commit or push.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import packageJson from '../package.json';
import { announceUrgent, appsOf, CHANGES_HEADING, kindOf, land, nextVersion, TRAILER, URGENT_EVENT, urgencyOf, withChanges, type LandOptions } from '../scripts/land.ts';

// git found through PATH on a Mac is Apple's launcher, which looks up the developer tools on every call before it starts
// the real git, about half again the time of each of the hundreds of git processes here; the folder `git --exec-path`
// names holds the real one, on every system.
const gitFolder = Bun.spawnSync(['git', '--exec-path'], { stdout: 'pipe' }).stdout.toString().trim();
const env = { ...process.env, PATH: `${gitFolder}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
let root: string;
let count = 0;
/**
 * The bound on the two tests that run a landing twice, up to some fifty git processes: the fifteen seconds a test may take,
 * not Bun's default five. Running the real git brought the larger to 3.0 to 4.6 seconds beside three other runs of this file at load 30
 * (2026-10-24), but at load 50 to 60 it overran five seconds with no assertion failing (2026-10-25). Nothing here waits on
 * time; each step waits for its process to exit, so the bound only says how long a busy machine may take.
 */
const TWO_LANDINGS = 15_000;

const gitIn = (cwd: string) => async (...args: string[]) => {
  const child = Bun.spawn(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
  return out.trim();
};

beforeAll(async () => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-land-'));
  const seed = join(root, 'seed');
  mkdirSync(seed);
  await gitIn(root)('init', '-q', '--bare', '-b', 'main', 'origin.git');
  const git = gitIn(seed);
  await git('init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), packageAt('0.5.0'));
  writeFileSync(join(seed, 'README.md'), 'bun add github:worktron/app-kit#v0.5.0\n');
  await git('add', '-A');
  await git('-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'The kit');
  await git('push', '-q', join(root, 'origin.git'), 'main', 'main:refs/tags/v0.5.0');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A copy of the seeded origin and a clone of it, the first thread's checkout. */
async function scratch() {
  const dir = join(root, `test-${++count}`);
  mkdirSync(dir);
  cpSync(join(root, 'origin.git'), join(dir, 'origin.git'), { recursive: true });
  await gitIn(dir)('clone', '-q', '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', '-c', 'commit.gpgsign=false', 'origin.git', 'work');
  const work = join(dir, 'work');
  return { dir, work, origin: join(dir, 'origin.git'), git: gitIn(work) };
}

/** A branch off origin's main, in the clone or in a worktree of its own, with one commit. */
async function branch(work: string, name: string, message: string, file = `${name}.txt`, folder = work) {
  if (folder === work) await gitIn(work)('checkout', '-q', '-b', name, 'origin/main');
  else await gitIn(work)('worktree', 'add', '-q', '-b', name, folder, 'origin/main');
  await commit(folder, message, file);
  return folder;
}

async function commit(cwd: string, message: string, file: string, text = `${message}\n`) {
  mkdirSync(join(cwd, file, '..'), { recursive: true });
  writeFileSync(join(cwd, file), text);
  await gitIn(cwd)('add', '-A');
  await gitIn(cwd)('commit', '-q', '-m', message);
}

/** Moves origin's main by a plain commit, as another thread's landing would, without running one. */
async function moveMain(work: string, file: string, text: string) {
  const git = gitIn(work);
  const branchName = await git('symbolic-ref', '--short', 'HEAD');
  await git('checkout', '-q', '--detach', 'origin/main');
  await commit(work, 'Another thread lands', file, text);
  await git('push', '-q', 'origin', 'HEAD:refs/heads/main');
  const moved = await git('rev-parse', 'HEAD');
  await git('checkout', '-q', branchName);
  return moved;
}

/** A stand-in for GitHub refusing every push that touches a ref matching the shell pattern. */
function refuse(origin: string, pattern: string) {
  const hook = join(origin, 'hooks/pre-receive');
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do case "$ref" in ${pattern}) echo "$ref" refused by the stand-in >&2; exit 1;; esac; done\n`);
  chmodSync(hook, 0o755);
}

/**
 * A commit message with its Release line, for a minor change the Apps line it must carry, and for a minor or patch
 * change its Urgency line: next round when it says what apps do, else rides along.
 */
const release = (subject: string, kind: string, apps = kind === 'minor' ? `Apps: ${subject}\n` : '', urgency = kind === 'none' ? '' : `Urgency: ${apps ? 'next round' : 'rides along'}\n`) =>
  `${subject}\n\nRelease: ${kind}\n${urgency}${apps}${TRAILER}`;
function packageAt(version: string) {
  return `${JSON.stringify({ name: 'kit', version }, null, 2)}\n`;
}

async function landIn(cwd: string, options: Partial<LandOptions> = {}) {
  const lines: string[] = [];
  const outcome = await land({ cwd, env, runGates: async () => true, log: (line) => lines.push(line), ...options });
  return { outcome, lines };
}

const tagsOnGitHub = async (work: string) =>
  Object.fromEntries(
    (await gitIn(work)('ls-remote', '--tags', 'origin'))
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.split(/\s+/)[1].replace('refs/tags/', ''), line.split(/\s+/)[0]]),
  );
const mainOnGitHub = async (work: string) => (await gitIn(work)('ls-remote', 'origin', 'refs/heads/main')).split(/\s/)[0];

test('the largest Release line wins whatever its case, and patch, minor and none each count', () => {
  const commits = (...releases: string[][]) => releases.map((values) => ({ releases: values, message: '' }));
  expect(kindOf(commits(['patch']), ['a.ts'])).toMatchObject({ kind: 'patch', plansOnly: false });
  expect(kindOf(commits(['none']), ['a.ts'])).toMatchObject({ kind: 'none' });
  expect(kindOf(commits(['Patch'], [' MINOR '], ['none']), ['a.ts'])).toMatchObject({ kind: 'minor' });
});

test('no Release line, one outside the last paragraph, and an unknown kind are refused with what to write', () => {
  expect(kindOf([{ releases: [], message: 'The change\n' }], ['a.ts'])).toEqual({ refused: expect.stringContaining('no commit on <branch> says what kind of change it is; add Release: minor') });
  expect(kindOf([{ releases: [], message: `The change\n\nRelease: minor\n\n${TRAILER}\n` }], ['a.ts'])).toEqual({ refused: expect.stringContaining('not in its last paragraph, where git reads it; put it beside Co-Authored-By') });
  expect(kindOf([{ releases: ['major'], message: '' }], ['a.ts'])).toEqual({ refused: expect.stringContaining('Release: major is not a kind of change; write minor, patch or none') });
});

test('a branch changing only plan files is none without a line, and any other file needs one', () => {
  expect(kindOf([{ releases: [], message: 'ticket-1: ticket\n' }], ['.claude/plans/backlog.md'])).toMatchObject({ kind: 'none', plansOnly: true });
  expect(kindOf([{ releases: [], message: 'x\n' }], ['.claude/plans/backlog.md', 'README.md'])).toHaveProperty('refused');
});

test('a minor change must carry an Apps line, a patch may, none keeps none, and a misplaced one is refused', () => {
  expect(appsOf([{ apps: [], message: 'x' }], 'minor')).toEqual({ refused: expect.stringContaining('a minor change must say what an app does about it; add an Apps: line') });
  expect(appsOf([{ apps: [], message: 'x' }, { apps: [' Move the manifest '], message: '' }], 'minor')).toEqual({ lines: ['Move the manifest'] });
  expect(appsOf([{ apps: [], message: 'x' }], 'patch')).toEqual({ lines: [] });
  expect(appsOf([{ apps: ['Read the new line'], message: '' }], 'patch')).toEqual({ lines: ['Read the new line'] });
  expect(appsOf([{ apps: ['Ignored'], message: '' }], 'none')).toEqual({ lines: [] });
  expect(appsOf([{ apps: [], message: `The change\n\nApps: do this\n\nRelease: patch\n${TRAILER}\n` }, { apps: ['Other'], message: '' }], 'patch')).toEqual({ refused: expect.stringContaining('an Apps: line is in a commit message but not in its last paragraph') });
  // One in the trailers does not cover another left in the body.
  expect(appsOf([{ apps: ['do that'], message: `The change\n\nApps: do this\n\nRelease: patch\nApps: do that\n${TRAILER}\n` }], 'patch')).toEqual({ refused: expect.stringContaining('not in its last paragraph') });
  // A wrapped trailer's second line does not count as another.
  expect(appsOf([{ apps: ['do this and that'], message: `The change\n\nRelease: patch\nApps: do this\n  and that\n${TRAILER}\n` }], 'patch')).toEqual({ lines: ['do this and that'] });
});

test('a minor or patch change must say how soon apps take it, the most urgent wins, and one apps must take says what they do', () => {
  const said = (urgencies: string[], message = '') => ({ urgencies, message });
  expect(urgencyOf([said([])], 'patch', [])).toEqual({ refused: expect.stringContaining('a patch change must say how soon apps take it; add an Urgency: line') });
  expect(urgencyOf([said([])], 'minor', ['x'])).toHaveProperty('refused');
  expect(urgencyOf([said([])], 'none', [])).toEqual({ urgency: null });
  expect(urgencyOf([said(['rides along'])], 'patch', [])).toEqual({ urgency: 'rides along' });
  expect(urgencyOf([said([' Next  Round ']), said(['now']), said(['rides along'])], 'minor', ['x'])).toEqual({ urgency: 'now' });
  expect(urgencyOf([said(['soon'])], 'patch', [])).toEqual({ refused: expect.stringContaining('Urgency: soon is not an urgency; write now, next round or rides along') });
  expect(urgencyOf([said(['now'])], 'patch', [])).toEqual({ refused: expect.stringContaining('must say what an app does about it; add an Apps: line') });
  expect(urgencyOf([said(['next round'])], 'patch', [])).toHaveProperty('refused');
  expect(urgencyOf([said([], `The change\n\nUrgency: now\n\nRelease: patch\n${TRAILER}\n`)], 'patch', ['x'])).toEqual({ refused: expect.stringContaining('an Urgency: line is in a commit message but not in its last paragraph') });
});

test('a release apps take now asks metamax for the same-day round, and says to start it by hand when none started', async () => {
  const asked: string[][] = [];
  const answering = (ok: boolean, out: string) => async (args: string[]) => {
    asked.push(args);
    return { ok, out };
  };
  expect(await announceUrgent('0.6.1', ['sign in with Google again'], answering(true, `${URGENT_EVENT} in app-kit: a1b2: started\n`))).toBe(`the same-day apps round started: ${URGENT_EVENT} in app-kit: a1b2: started`);
  expect(asked[0]).toEqual([URGENT_EVENT, 'app-kit', 'v0.6.1: sign in with Google again']);
  // Metamax exits 0 on a skip and when no automation runs on the event; only a started run counts.
  for (const out of [`${URGENT_EVENT} in app-kit: a1b2: skipped: its last thread (apps-round) is still open`, `${URGENT_EVENT} in app-kit: no automation in app-kit runs on ${URGENT_EVENT}`, '']) {
    expect(await announceUrgent('0.6.1', ['x'], answering(true, out))).toStartWith('the same-day apps round did not start: ');
  }
  expect(await announceUrgent('0.6.1', ['x'], answering(false, 'not recorded: metamax is not answering on port 6201'))).toContain('did not start: not recorded: metamax is not answering on port 6201; hand v0.6.1 to the open apps round or start one');
  expect(await announceUrgent('0.6.1', ['x'], null)).toContain('did not start: metamax is not here to tell');
});

test('CHANGES.md takes each version above the newest, under the heading Dependabot and Renovate read release notes by', () => {
  const first = withChanges(null, '0.6.0', 'next round', ['Move the manifest']);
  expect(first).toBe(`${CHANGES_HEADING}\n\n## v0.6.0\n\nUrgency: next round\n\n- Move the manifest\n`);
  expect(withChanges(first, '0.6.1', 'now', ['One', 'Two'])).toBe(`${CHANGES_HEADING}\n\n## v0.6.1\n\nUrgency: now\n\n- One\n- Two\n\n## v0.6.0\n\nUrgency: next round\n\n- Move the manifest\n`);
  // The file in the repository has the same heading, so the landing adds to it rather than starting another.
  expect(readFileSync(join(import.meta.dir, '../CHANGES.md'), 'utf8').startsWith(`${CHANGES_HEADING}\n\n## v`)).toBe(true);
});

test('while the version is 0.x, minor raises the middle number and patch the last', () => {
  expect(nextVersion('0.5.0', 'minor')).toBe('0.6.0');
  expect(nextVersion('0.5.3', 'minor')).toBe('0.6.0');
  expect(nextVersion('0.5.0', 'patch')).toBe('0.5.1');
  expect(nextVersion('0.9.0', 'minor')).toBe('0.10.0');
});

test.concurrent('two branches marked minor, the second landing while the first runs its gates, become 0.6.0 and 0.7.0, each tagged on main', async () => {
  const { dir, work, git } = await scratch();
  await branch(work, 'slow', release('The slow change', 'minor'));
  const other = await branch(work, 'fast', release('The fast change', 'minor'), 'fast.txt', join(dir, 'other'));
  let gateRuns = 0;
  let fast: Awaited<ReturnType<typeof landIn>>['outcome'] | undefined;
  const { outcome: slow, lines } = await landIn(work, {
    runGates: async () => {
      if (gateRuns++ === 0) fast = (await landIn(other)).outcome;
      return true;
    },
  });

  expect(fast).toMatchObject({ landed: true, version: '0.6.0' });
  expect(slow).toMatchObject({ landed: true, version: '0.7.0' });
  if (!fast?.landed || !slow.landed) throw new Error('both should land');
  expect(gateRuns).toBe(2);
  expect(lines.some((line) => line.startsWith('another landing moved main'))).toBe(true);
  const main = await mainOnGitHub(work);
  expect(main).toBe(slow.sha);
  expect(await tagsOnGitHub(work)).toEqual({ 'v0.5.0': expect.any(String), 'v0.6.0': fast.sha, 'v0.7.0': slow.sha });
  expect(await git('merge-base', '--is-ancestor', fast.sha, main)).toBe('');
  expect(await gitIn(other)('symbolic-ref', '--short', 'HEAD')).toBe('fast');
  expect(await gitIn(other)('rev-parse', 'HEAD')).toBe(fast.sha);
  expect(await git('symbolic-ref', '--short', 'HEAD')).toBe('slow');
  expect(await git('rev-parse', 'HEAD')).toBe(main);
  // The version commit: exactly the Co-Authored-By line, as Worktron, package.json's formatting kept, and the README
  // naming the new tag.
  expect(await git('log', '-1', '--format=%B', main)).toBe(`Version 0.7.0\n\n${TRAILER}`);
  expect(await git('log', '-1', '--format=%an %cn', main)).toBe('Worktron Worktron');
  expect(`${await git('show', `${main}:package.json`)}\n`).toBe(packageAt('0.7.0'));
  expect(await git('show', `${main}:README.md`)).toBe('bun add github:worktron/app-kit#v0.7.0');
  expect((await git('diff', '--name-only', `${main}~1`, main)).split('\n').sort()).toEqual(['CHANGES.md', 'README.md', 'package.json']);
  // Each minor change's Apps line under its own version, the later one first.
  expect(await git('show', `${main}:CHANGES.md`)).toBe(`${CHANGES_HEADING}\n\n## v0.7.0\n\nUrgency: next round\n\n- The slow change\n\n## v0.6.0\n\nUrgency: next round\n\n- The fast change`);
}, TWO_LANDINGS);

test.concurrent('gates red on a branch main has moved past: the branch is as it was, not rebased; a fix committed, the next run lands, and riding along it is not listed in CHANGES.md', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('A change', 'patch'));
  await moveMain(work, 'elsewhere.txt', "Another thread's file\n");
  const before = await git('rev-parse', 'HEAD');
  const mainBefore = await mainOnGitHub(work);

  const red = (await landIn(work, { runGates: async () => false })).outcome;
  expect(red).toMatchObject({ landed: false });
  if (!red.landed) expect(red.reason).toContain('the gates failed');
  expect(await git('symbolic-ref', '--short', 'HEAD')).toBe('change');
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  expect(await git('status', '--porcelain')).toBe('');
  expect(await mainOnGitHub(work)).toBe(mainBefore);

  await commit(work, 'The fix', 'fix.txt');
  expect((await landIn(work)).outcome).toMatchObject({ landed: true, version: '0.5.1', urgency: 'rides along' });
  // A release that rides along with no Apps line asks nothing of an app, so CHANGES.md does not list it.
  expect((await git('ls-tree', '--name-only', await mainOnGitHub(work))).split('\n')).not.toContain('CHANGES.md');
}, TWO_LANDINGS);

test.concurrent('a minor change with no Apps line is refused before anything moves, and a wrapped Apps line is one entry', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor', ''));
  const before = await git('rev-parse', 'HEAD');
  const refused = (await landIn(work)).outcome;
  expect(refused).toEqual({ landed: false, reason: expect.stringContaining('a minor change must say what an app does about it') });
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  await commit(work, release('Say it', 'patch', 'Apps: move the manifest to the\n  checkout root\n'), 'say.txt');
  expect((await landIn(work)).outcome).toMatchObject({ landed: true, version: '0.6.0' });
  expect(await git('show', 'origin/main:CHANGES.md')).toBe(`${CHANGES_HEADING}\n\n## v0.6.0\n\nUrgency: next round\n\n- move the manifest to the checkout root`);
}, TWO_LANDINGS);

test.concurrent('a patch that says nothing of urgency is refused before anything moves; marked now, it lands with its urgency in CHANGES.md', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', 'A fix\n\nRelease: patch\nApps: sign in with Google again\n');
  const before = await git('rev-parse', 'HEAD');
  const main = await mainOnGitHub(work);
  expect((await landIn(work)).outcome).toEqual({ landed: false, reason: expect.stringContaining('a patch change must say how soon apps take it') });
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  expect(await mainOnGitHub(work)).toBe(main);
  await commit(work, release('Say how soon', 'patch', '', 'Urgency: now\n'), 'soon.txt');
  const { outcome, lines } = await landIn(work);
  expect(outcome).toMatchObject({ landed: true, version: '0.5.1', urgency: 'now', apps: ['sign in with Google again'] });
  expect(lines).toContain('change: apps take it now');
  expect(await git('show', 'origin/main:CHANGES.md')).toBe(`${CHANGES_HEADING}\n\n## v0.5.1\n\nUrgency: now\n\n- sign in with Google again`);
}, TWO_LANDINGS);

test.concurrent('none lands and releases nothing', async () => {
  const { work } = await scratch();
  await branch(work, 'change', release('A change apps never notice', 'none'));
  const { outcome } = await landIn(work);
  expect(outcome).toMatchObject({ landed: true });
  expect(outcome).not.toHaveProperty('version', expect.anything());
  expect(Object.keys(await tagsOnGitHub(work))).toEqual(['v0.5.0']);
});

test.concurrent('a branch that changes only plan files lands without the gates', async () => {
  const { work } = await scratch();
  await branch(work, 'ticket-1', 'ticket-1: ticket', '.claude/plans/backlog.md');
  const { outcome, lines } = await landIn(work, {
    runGates: async () => {
      throw new Error('the gates ran');
    },
  });
  expect(outcome).toMatchObject({ landed: true });
  expect(lines).toContain('the gates are skipped: only plan files change');
});

test.concurrent("main's version untagged on GitHub is tagged on main first, though a local tag of that name points elsewhere, and a branch already in main stops there", async () => {
  const { work, git } = await scratch();
  const seed = await git('rev-parse', 'HEAD');
  await git('checkout', '-q', '-b', 'change');
  const untagged = await moveMain(work, 'package.json', packageAt('0.6.0'));
  await git('tag', 'v0.6.0', seed);
  await git('merge', '-q', '--ff-only', untagged);

  const { outcome, lines } = await landIn(work);
  expect(outcome).toMatchObject({ landed: true, sha: untagged });
  expect(lines).toContain("main's version 0.6.0 has no tag on GitHub (released by hand, or a push whose answer was lost); tagging main");
  expect(lines).toContain('change is already in main');
  expect((await tagsOnGitHub(work))['v0.6.0']).toBe(untagged);
});

test.concurrent('a push of main that fails without main moving says so and does not try again', async () => {
  const { work, origin, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  const before = await git('rev-parse', 'HEAD');
  refuse(origin, 'refs/heads/main');
  let gateRuns = 0;
  const { outcome, lines } = await landIn(work, { runGates: async () => ++gateRuns > 0 });
  expect(outcome).toMatchObject({ landed: false });
  if (!outcome.landed) expect(outcome.reason).toContain('the push of main failed and main did not move');
  if (!outcome.landed) expect(outcome.reason).toContain('refs/heads/main refused by the stand-in');
  expect(gateRuns).toBe(1);
  expect(lines.some((line) => line.startsWith('another landing'))).toBe(false);
  expect(await git('symbolic-ref', '--short', 'HEAD')).toBe('change');
  expect(await git('rev-parse', 'HEAD')).toBe(before);
});

test.concurrent('a refused tag leaves main where it was, since main and the tag move in one push', async () => {
  const { work, origin, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  const before = await git('rev-parse', 'HEAD');
  const main = await mainOnGitHub(work);
  refuse(origin, 'refs/tags/*');

  const { outcome } = await landIn(work);
  if (outcome.landed) throw new Error('the push should fail');
  expect(outcome.reason).toContain('the push of main failed and main did not move');
  expect(outcome.reason).toContain('refs/tags/v0.6.0 refused by the stand-in');
  expect(await mainOnGitHub(work)).toBe(main);
  expect(Object.keys(await tagsOnGitHub(work))).toEqual(['v0.5.0']);
  expect(await git('rev-parse', 'HEAD')).toBe(before);
});

test.concurrent('a hand edit to the version is refused before any rebase, though main moved meanwhile', async () => {
  const { work, git } = await scratch();
  await branch(work, 'stale', 'Bumps the version by hand', 'package.json');
  await commit(work, 'Bumps the version by hand', 'package.json', packageAt('0.5.1'));
  await moveMain(work, 'package.json', packageAt('0.6.0'));
  const before = await git('rev-parse', 'HEAD');

  const { outcome } = await landIn(work);
  expect(outcome).toMatchObject({ landed: false });
  if (!outcome.landed) expect(outcome.reason).toContain("changes package.json's version from 0.5.0 to 0.5.1; drop that edit");
  expect(await git('rev-parse', 'HEAD')).toBe(before);
});

test.concurrent('a conflict with main stops with the files named and the branch as it was', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('Says to install from main', 'patch'), 'README.md');
  await moveMain(work, 'README.md', 'bun add github:worktron/app-kit#v0.5.0 and more\n');
  const before = await git('rev-parse', 'HEAD');

  const { outcome } = await landIn(work);
  expect(outcome).toMatchObject({ landed: false });
  if (!outcome.landed) expect(outcome.reason).toContain('conflicts with main in README.md');
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  expect(await git('status', '--porcelain')).toBe('');
});

test.concurrent('main, a detached head, a rebase in progress and uncommitted changes are refused before anything moves', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  const main = await mainOnGitHub(work);
  const refused = async (reason: string) => {
    const { outcome } = await landIn(work);
    if (outcome.landed) throw new Error(`should be refused: ${reason}`);
    expect(outcome.reason).toContain(reason);
  };

  await git('checkout', '-q', 'main');
  await refused('this is main');
  await git('checkout', '-q', 'change');
  await git('checkout', '-q', '--detach');
  await refused('detached head, as a landing that was killed leaves it; check out the branch first: git checkout change');
  await git('checkout', '-q', 'change');
  const rebaseFolder = join(work, await git('rev-parse', '--git-path', 'rebase-merge'));
  mkdirSync(rebaseFolder, { recursive: true });
  await refused('a rebase is in progress');
  rmSync(rebaseFolder, { recursive: true });
  writeFileSync(join(work, 'README.md'), 'edited\n');
  await refused('uncommitted changes');
  expect(await mainOnGitHub(work)).toBe(main);
});

test("the README's install lines name the version in package.json, which the landing changes together", () => {
  const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
  const named = [...readme.matchAll(/app-kit#v(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  expect(named.length).toBeGreaterThan(0);
  expect(new Set(named)).toEqual(new Set([packageJson.version]));
});
