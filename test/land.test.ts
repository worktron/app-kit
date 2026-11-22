// The landing script (scripts/land.ts): the version is worked out from main when a branch lands, so two threads never
// take the same number, and a stopped landing leaves nothing the next one refuses. How a branch's Release lines decide
// the kind of change is tested on its own, with no git. The landings run in scratch repositories whose origin is a bare
// repository standing in for GitHub; a second thread is a second worktree of the same repository, sharing its tags and
// refs as every worktree here does. Scratch folders are under node_modules/.cache, never the system temp folder
// (test/command.test.ts says why), and git reads no global settings, so the commits are the test's own. A landing runs
// some twenty-five git processes, and a process start is what a busy machine slows most, so the tests run side by side
// and start no git a file copy can stand in for: each copies one seeded origin and its clone, reads the stand-in
// GitHub's refs from its folder rather than over a connection, and moves main with one import, not a push. The tests
// that land twice carry bun's own 5-second limit: in five whole-suite runs on 2026-11-22 the slowest took 1.7 to 1.8
// seconds at load 48 to 87 and 2.1 to 2.4 at load 81 to 137, where before these cuts they overran 5 seconds at load 50.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import packageJson from '../package.json';
import { appsOf, CHANGES_HEADING, kindOf, land, nextVersion, TRAILER, urgencyOf, urgentLine, urgentReadFailure, withChanges, type LandOptions } from '../scripts/land.ts';

// git found through PATH on a Mac is Apple's launcher, which looks up the developer tools on every call before it starts
// the real git, about half again the time of each of the hundreds of git processes here; the folder `git --exec-path`
// names holds the real one, on every system.
const gitFolder = Bun.spawnSync(['git', '--exec-path'], { stdout: 'pipe' }).stdout.toString().trim();
// git's housekeeping after a commit, fetch or push (`git maintenance run --auto`) is another process each time, a
// tenth of all the processes here, with nothing to tidy in a repository that lives for one test.
const noHousekeeping = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'maintenance.auto', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'gc.auto', GIT_CONFIG_VALUE_1: '0' };
const env = { ...process.env, PATH: `${gitFolder}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...noHousekeeping };
let root: string;
let count = 0;

const gitIn = (cwd: string, stdin?: string) => async (...args: string[]) => {
  const child = Bun.spawn(['git', ...args], { cwd, env, stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe' });
  const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error(`git ${args.join(' ')}: ${err}`);
  return out.trim();
};

beforeAll(async () => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-land-'));
  const seed = join(root, 'seed');
  const template = join(root, 'template');
  mkdirSync(seed);
  mkdirSync(template);
  await gitIn(template)('init', '-q', '--bare', '-b', 'main', 'origin.git');
  // A push starts receive-pack in the origin without the settings above, which git keeps from the other side of a
  // connection, so the origin turns its housekeeping off in its own settings.
  appendFileSync(join(template, 'origin.git/config'), '[receive]\n\tautogc = false\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n');
  const git = gitIn(seed);
  await git('init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), packageAt('0.5.0'));
  writeFileSync(join(seed, 'README.md'), 'bun add github:worktron/app-kit#v0.5.0\n');
  await git('add', '-A');
  await git('-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'The kit');
  await git('push', '-q', join(template, 'origin.git'), 'main', 'main:refs/tags/v0.5.0');
  await gitIn(template)('clone', '-q', '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', '-c', 'commit.gpgsign=false', 'origin.git', 'work');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A copy of the seeded origin and of its clone, the first thread's checkout, which is told where its copy of origin is. */
async function scratch() {
  const dir = join(root, `test-${++count}`);
  cpSync(join(root, 'template'), dir, { recursive: true });
  const work = join(dir, 'work');
  const config = join(work, '.git/config');
  const cloned = readFileSync(config, 'utf8');
  if (!cloned.includes(join(root, 'template/origin.git'))) throw new Error(`the template clone's settings do not name its origin: ${cloned}`);
  writeFileSync(config, cloned.replace(join(root, 'template/origin.git'), join(dir, 'origin.git')));
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

/**
 * One commit on `ref` in the repository `repo` with these files, on top of what `ref` holds when `onTop`, by one git
 * fast-import, where add, commit and push take three processes and more; it moves `ref` only forward. Gives the commit.
 */
async function importCommit(repo: string, ref: string, message: string, files: Record<string, string>, onTop: boolean) {
  const data = (body: string) => `data ${Buffer.byteLength(body)}\n${body}`;
  const when = `${Math.floor(Date.now() / 1000)} +0000`;
  const marks = join(repo, '..', `${basename(repo)}-marks`);
  await gitIn(repo, [
    `commit ${ref}`,
    'mark :1',
    `author Worktron <kit@example.com> ${when}`,
    `committer Worktron <kit@example.com> ${when}`,
    data(message),
    ...(onTop ? [`from ${ref}^0`] : []),
    ...Object.entries(files).flatMap(([file, text]) => [`M 100644 inline ${file}`, data(text)]),
    '',
  ].join('\n'))('fast-import', '--quiet', `--export-marks=${marks}`);
  return readFileSync(marks, 'utf8').split(' ')[1].trim();
}

/** Moves origin's main forward by a commit, as another thread's landing would, without running one; the clone learns of it at its next fetch. */
const moveMain = (work: string, file: string, text: string) => importCommit(join(work, '../origin.git'), 'refs/heads/main', 'Another thread lands\n', { [file]: text }, true);

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

/** The stand-in GitHub's tags and main, read in its folder: ls-remote would start a second git to answer over a connection. */
const tagsOnGitHub = async (work: string) =>
  Object.fromEntries(
    (await gitIn(join(work, '../origin.git'))('for-each-ref', '--format=%(objectname) %(refname)', 'refs/tags'))
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.split(/\s+/)[1].replace('refs/tags/', ''), line.split(/\s+/)[0]]),
  );
const mainOnGitHub = (work: string) => gitIn(join(work, '../origin.git'))('rev-parse', 'refs/heads/main');

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

test("an Apps line repeated across a branch's commits is listed once", () => {
  expect(appsOf([{ apps: ['Add the plugin'], message: '' }, { apps: [' Add the plugin '], message: '' }, { apps: ['Add the plugins'], message: '' }], 'minor')).toEqual({ lines: ['Add the plugin', 'Add the plugins'] });
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

test("an urgent release's line names each app on an older version by its tag, says none when there is none, and names what it could not read", () => {
  expect(urgentLine('0.6.1', { older: [{ project: 'assay', tag: 'v0.45.4' }, { project: 'beeline', tag: 'v0.6.0' }], unread: [] })).toBe(
    'v0.6.1 is urgent; apps on an older version: assay (v0.45.4), beeline (v0.6.0)',
  );
  expect(urgentLine('0.6.1', { older: [], unread: [{ project: 'broken', unread: 'reading what landed: not a git repository' }] })).toBe(
    'v0.6.1 is urgent; apps on an older version: none; could not read: broken (reading what landed: not a git repository)',
  );
});

test("both urgent lines keep what metamax's landed reply matches on: they start with v and hold 'is urgent;'", () => {
  // The landing prints each through its land-main: prefix; metamax quotes every such line that starts `land-main: v`.
  for (const line of [urgentLine('0.6.1', { older: [{ project: 'assay', tag: 'v0.45.4' }], unread: [] }), urgentLine('0.6.1', { older: [], unread: [] }), urgentReadFailure('0.6.1', 'apps', 'no such folder')]) {
    expect(line).toStartWith('v');
    expect(line).toContain('is urgent;');
  }
});

test('CHANGES.md takes each version above the newest, under the heading Dependabot and Renovate read release notes by', () => {
  const first = withChanges(null, '0.6.0', 'next round', ['Move the manifest']);
  expect(first).toBe(`${CHANGES_HEADING}\n\n## v0.6.0\n\nUrgency: next round\n\n- Move the manifest\n`);
  expect(withChanges(first, '0.6.1', 'now', ['One', 'Two'])).toBe(`${CHANGES_HEADING}\n\n## v0.6.1\n\nUrgency: now\n\n- One\n- Two\n\n## v0.6.0\n\nUrgency: next round\n\n- Move the manifest\n`);
  // The file in the repository has the same heading, so the landing adds to it rather than starting another.
  expect(readFileSync(join(import.meta.dir, '../CHANGES.md'), 'utf8').startsWith(`${CHANGES_HEADING}\n\n## v`)).toBe(true);
});

test('CHANGES.md lists each line once under each version', () => {
  const repeated = readFileSync(join(import.meta.dir, '../CHANGES.md'), 'utf8')
    .split(/^(?=## v)/m)
    .flatMap((entry) => {
      const lines = entry.split('\n').filter((line) => line.startsWith('- '));
      return lines.filter((line, at) => lines.indexOf(line) !== at).map((line) => `${entry.split('\n')[0]}: ${line}`);
    });
  expect(repeated).toEqual([]);
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
});

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
});

test.concurrent('a minor change with no Apps line is refused before anything moves, and a wrapped Apps line is one entry, listed once when two commits carry it', async () => {
  const { work, git } = await scratch();
  await branch(work, 'change', release('A change', 'minor', ''));
  const before = await git('rev-parse', 'HEAD');
  const refused = (await landIn(work)).outcome;
  expect(refused).toEqual({ landed: false, reason: expect.stringContaining('a minor change must say what an app does about it') });
  expect(await git('rev-parse', 'HEAD')).toBe(before);
  await commit(work, release('Say it', 'patch', 'Apps: move the manifest to the\n  checkout root\n'), 'say.txt');
  await commit(work, release('Say it again', 'patch', 'Apps: move the manifest to the\n  checkout root\n'), 'again.txt');
  expect((await landIn(work)).outcome).toMatchObject({ landed: true, version: '0.6.0' });
  expect(await git('show', 'origin/main:CHANGES.md')).toBe(`${CHANGES_HEADING}\n\n## v0.6.0\n\nUrgency: next round\n\n- move the manifest to the checkout root`);
});

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
  expect(lines).toContain('change: urgent: apps take it first');
  expect(await git('show', 'origin/main:CHANGES.md')).toBe(`${CHANGES_HEADING}\n\n## v0.5.1\n\nUrgency: now\n\n- sign in with Google again`);
});

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
  await git('fetch', '-q', 'origin');
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

/**
 * An app beside the kit: a checkout of its own origin, whose landed package.json files install these tags. The origin
 * gets its commit by import; the checkout is a new repository told where its origin is and that origin's HEAD is main,
 * as a clone would be, and learns the commit at the fetch the landing makes before it reads an app.
 */
async function appBeside(dir: string, name: string, installs: Record<string, string>) {
  const origin = join(dir, `${name}-origin.git`);
  const app = join(dir, name);
  await Promise.all([gitIn(dir)('init', '-q', '--bare', '-b', 'main', origin), gitIn(dir)('init', '-q', '-b', 'main', app)]);
  const files = Object.fromEntries(Object.entries(installs).map(([file, tag]) => [file, JSON.stringify({ dependencies: tag ? { 'app-kit': `github:worktron/app-kit#${tag}` } : {} })]));
  appendFileSync(join(app, '.git/config'), `[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  await Promise.all([importCommit(origin, 'refs/heads/main', 'The app\n', files, false), gitIn(app)('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')]);
}

test.concurrent('an urgent landing names the apps on an older version and any checkout it could not read, and starts nothing', async () => {
  const { dir, work } = await scratch();
  const apps = join(dir, 'apps');
  mkdirSync(apps);
  await appBeside(apps, 'behind', { 'package.json': 'v0.5.0' });
  await appBeside(apps, 'current', { 'package.json': 'v0.5.1' });
  // Two installs on different versions: the app is on the older.
  await appBeside(apps, 'split', { 'package.json': 'v0.5.1', 'client/package.json': 'v0.5.0' });
  await appBeside(apps, 'plain', { 'package.json': '' });
  // A checkout whose landed tree cannot be read is named, never read as one with no kit.
  mkdirSync(join(apps, 'broken', '.git'), { recursive: true });
  await branch(work, 'fix', release('Sign in again', 'patch', 'Apps: sign in with Google again\n', 'Urgency: now\n'));
  const { outcome, lines } = await landIn(work, { appsFolder: apps });
  expect(outcome).toMatchObject({ landed: true, version: '0.5.1', urgency: 'now' });
  expect(lines.filter((line) => line.includes('is urgent'))).toEqual([
    expect.stringMatching(/^v0\.5\.1 is urgent; apps on an older version: behind \(v0\.5\.0\), split \(v0\.5\.0\); could not read: broken \(not a git checkout of its own: .+\)$/),
  ]);
  // A release that is not urgent reads no apps.
  await branch(work, 'later', release('Later', 'patch', 'Apps: nothing to change\n', 'Urgency: next round\n'), 'later.txt');
  expect((await landIn(work, { appsFolder: apps })).lines.some((line) => line.includes('is urgent'))).toBe(false);
});
