// The landing script (scripts/land.ts): the version is worked out from main when a branch lands, so two threads never
// take the same number, and a stopped landing leaves nothing the next one refuses. How a branch's Release lines decide
// the kind of change is tested on its own, with no git. The landings run in scratch repositories whose origin is a bare
// repository standing in for GitHub; a second thread is a second worktree of the same repository, sharing its tags and
// refs as every worktree here does. Scratch folders are under node_modules/.cache, never the system temp folder
// (test/command.test.ts says why), and git reads no global settings, so the commits are the test's own. Each landing
// runs a few dozen git processes, so the landings run side by side and only where a real repository is the point.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import packageJson from '../package.json';
import { kindOf, land, nextVersion, TRAILER, type LandOptions } from '../scripts/land.ts';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
let root: string;
let count = 0;
/**
 * The bound on a test that runs two landings, some fifty git processes: the fifteen seconds a test may take, not Bun's
 * default five, which such a test overran on a busy machine beside three other runs of this file with no assertion
 * failing. Nothing here waits on time; each step waits for its process to exit.
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
  await git('checkout', '-q', branchName);
}

const release = (subject: string, kind: string) => `${subject}\n\nRelease: ${kind}\n${TRAILER}`;
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

test('while the version is 0.x, minor raises the middle number and patch the last', () => {
  expect(nextVersion('0.5.0', 'minor')).toBe('0.6.0');
  expect(nextVersion('0.5.3', 'minor')).toBe('0.6.0');
  expect(nextVersion('0.5.0', 'patch')).toBe('0.5.1');
  expect(nextVersion('0.9.0', 'minor')).toBe('0.10.0');
});

test.concurrent('two branches marked minor, landed one after the other, become 0.6.0 and 0.7.0, each tagged on main', async () => {
  const { dir, work, git } = await scratch();
  await branch(work, 'first', release('The first change', 'minor'));
  const other = await branch(work, 'second', release('The second change', 'minor'), 'second.txt', join(dir, 'other'));

  const first = (await landIn(work)).outcome;
  const second = (await landIn(other)).outcome;

  expect(first).toMatchObject({ landed: true, version: '0.6.0' });
  expect(second).toMatchObject({ landed: true, version: '0.7.0' });
  if (!first.landed || !second.landed) throw new Error('both should land');
  const main = await mainOnGitHub(work);
  expect(main).toBe(second.sha);
  expect(await tagsOnGitHub(work)).toMatchObject({ 'v0.6.0': first.sha, 'v0.7.0': second.sha });
  expect(await git('merge-base', '--is-ancestor', first.sha, main)).toBe('');
  expect(await gitIn(other)('symbolic-ref', '--short', 'HEAD')).toBe('second');
  expect(await gitIn(other)('rev-parse', 'HEAD')).toBe(main);
  // The version commit: exactly the Co-Authored-By line, as Worktron, package.json's formatting kept, and the README
  // naming the new tag.
  expect(await git('log', '-1', '--format=%B', main)).toBe(`Version 0.7.0\n\n${TRAILER}`);
  expect(await git('log', '-1', '--format=%an %cn', main)).toBe('Worktron Worktron');
  expect(`${await git('show', `${main}:package.json`)}\n`).toBe(packageAt('0.7.0'));
  expect(await git('show', `${main}:README.md`)).toBe('bun add github:worktron/app-kit#v0.7.0');
  expect((await git('diff', '--name-only', `${main}~1`, main)).split('\n').sort()).toEqual(['README.md', 'package.json']);
}, TWO_LANDINGS);

test.concurrent('a landing whose main moved during the gates, by a patch landing, tries again and takes the next number', async () => {
  const { dir, work } = await scratch();
  await branch(work, 'slow', release('The slow change', 'minor'));
  const other = await branch(work, 'fast', release('The fast fix', 'patch'), 'fast.txt', join(dir, 'other'));
  let gateRuns = 0;
  let fast: Awaited<ReturnType<typeof landIn>>['outcome'] | undefined;
  const { outcome, lines } = await landIn(work, {
    runGates: async () => {
      if (gateRuns++ === 0) fast = (await landIn(other)).outcome;
      return true;
    },
  });
  expect(fast).toMatchObject({ landed: true, version: '0.5.1' });
  expect(outcome).toMatchObject({ landed: true, version: '0.6.0' });
  expect(gateRuns).toBe(2);
  expect(lines.some((line) => line.startsWith('another landing moved main'))).toBe(true);
  expect(Object.keys(await tagsOnGitHub(work)).sort()).toEqual(['v0.5.0', 'v0.5.1', 'v0.6.0']);
}, TWO_LANDINGS);

test.concurrent('gates red on a branch main has moved past: the branch is as it was, not rebased; a fix committed, the next run lands', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  await moveMain(work, 'elsewhere.txt', 'Another thread’s file\n');
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
  expect((await landIn(work)).outcome).toMatchObject({ landed: true, version: '0.6.0' });
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

test.concurrent('a landed branch run again finishes a tag that never reached GitHub, though a local tag of that name points elsewhere', async () => {
  const { work, git } = await scratch();
  const seed = await git('rev-parse', 'HEAD');
  await branch(work, 'change', release('A change', 'minor'));
  const first = (await landIn(work)).outcome;
  if (!first.landed) throw new Error('should land');
  await git('push', '-q', 'origin', ':refs/tags/v0.6.0');
  await git('tag', 'v0.6.0', seed);

  const { outcome, lines } = await landIn(work);
  expect(outcome).toMatchObject({ landed: true, sha: first.sha });
  expect(lines).toContain("main's version 0.6.0 has no tag on GitHub, so a landing stopped before tagging it");
  expect(lines).toContain('change is already in main');
  expect((await tagsOnGitHub(work))['v0.6.0']).toBe(first.sha);
}, TWO_LANDINGS);

test.concurrent('a push of main that fails without main moving says so and does not try again', async () => {
  const { work, origin, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  const before = await git('rev-parse', 'HEAD');
  writeFileSync(join(origin, 'hooks/pre-receive'), '#!/bin/sh\necho refused by the stand-in >&2\nexit 1\n');
  chmodSync(join(origin, 'hooks/pre-receive'), 0o755);
  let gateRuns = 0;
  const { outcome, lines } = await landIn(work, { runGates: async () => ++gateRuns > 0 });
  expect(outcome).toMatchObject({ landed: false });
  if (!outcome.landed) expect(outcome.reason).toContain('the push of main failed and main did not move');
  if (!outcome.landed) expect(outcome.reason).toContain('refused by the stand-in');
  expect(gateRuns).toBe(1);
  expect(lines.some((line) => line.startsWith('another landing'))).toBe(false);
  expect(await git('symbolic-ref', '--short', 'HEAD')).toBe('change');
  expect(await git('rev-parse', 'HEAD')).toBe(before);
});

test.concurrent('a tag push refused after main moved says main moved, and the next landing pushes the tag', async () => {
  const { work, origin, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor'));
  const hook = join(origin, 'hooks/pre-receive');
  writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/tags/*) echo tags refused by the stand-in >&2; exit 1;; esac; done\n');
  chmodSync(hook, 0o755);

  const { outcome } = await landIn(work);
  if (outcome.landed) throw new Error('the tag push should fail');
  const main = await mainOnGitHub(work);
  expect(outcome.reason).toContain(`main moved to ${main.slice(0, 7)} and change is there, but pushing the tag v0.6.0`);
  expect(outcome.reason).toContain('the next landing pushes the missing tag first');
  expect(await git('rev-parse', 'HEAD')).toBe(main);

  rmSync(hook);
  expect((await landIn(work)).outcome).toMatchObject({ landed: true, sha: main });
  expect((await tagsOnGitHub(work))['v0.6.0']).toBe(main);
}, TWO_LANDINGS);

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
