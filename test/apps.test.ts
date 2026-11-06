// The apps round's reader (scripts/apps.ts): which version an app is on, what CHANGES.md asks of it since, and which
// of its tickets name the kit, read from what landed on its origin, never its working files. The checkout is a scratch
// repository under node_modules/.cache, as test/land.test.ts makes them, with git reading no global settings.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { changesSince, compareVersions, kitTickets, readApp, UPDATE_TICKET } from '../scripts/apps.ts';
import { CHANGES_HEADING } from '../scripts/land.ts';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
let root: string;

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
};

const CHANGES = `${CHANGES_HEADING}\n\n## v0.10.0\n\n- Ten\n\n## v0.9.1\n\n- Nine one\n- Second line\n\n## v0.9.0\n\n- Nine\n`;

beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-apps-'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test('versions compare as numbers, so 0.10 comes after 0.9', () => {
  expect(['v0.10.0', 'v0.9.1', 'v0.9.0'].sort(compareVersions)).toEqual(['v0.9.0', 'v0.9.1', 'v0.10.0']);
});

test("CHANGES.md's entries after a tag, newest first, each with its lines", () => {
  expect(changesSince(CHANGES, 'v0.9.0')).toEqual([
    { version: 'v0.10.0', lines: ['Ten'] },
    { version: 'v0.9.1', lines: ['Nine one', 'Second line'] },
  ]);
  expect(changesSince(CHANGES, 'v0.10.0')).toEqual([]);
});

test('the backlog sections that name app-kit, by id and title', () => {
  const backlog = `# Backlog\n\nIntro naming app-kit.\n\n## ${UPDATE_TICKET} · Bring it up to the newest app-kit\n\nGoal: x\n\n## other · Nothing to do with the kit\n\nGoal: y\n\n## ages · Ages through the kit\n\nGoal: use app-kit's age.\n`;
  expect(kitTickets(backlog)).toEqual([
    { id: UPDATE_TICKET, title: 'Bring it up to the newest app-kit' },
    { id: 'ages', title: 'Ages through the kit' },
  ]);
});

test('an app is read as it landed on origin: the oldest tag it names, the lock checked against the tag, its kit tickets', () => {
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const app = join(root, 'app');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(join(seed, 'client'), { recursive: true });
  git(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.10.0' } }));
  writeFileSync(join(seed, 'client/package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.9.0' } }));
  writeFileSync(join(seed, 'client/bun.lock'), '"app-kit": ["app-kit@github:worktron/app-kit#aaaaaaa", {}],\n');
  mkdirSync(join(seed, '.claude/plans'), { recursive: true });
  writeFileSync(join(seed, '.claude/plans/backlog.md'), `# Backlog\n\n## ${UPDATE_TICKET} · Bring it up to the newest app-kit\n\nGoal: x\n`);
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'App');
  git(seed, 'push', '-q', origin, 'main');
  git(root, 'clone', '-q', origin, app);
  // A working edit that never landed is not read.
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.10.0' } }));
  writeFileSync(join(app, 'client/package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.10.0' } }));

  const tags = new Map([
    ['v0.9.0', 'aaaaaaa1111111111111111111111111111111111'],
    ['v0.9.1', 'bbbbbbb2222222222222222222222222222222222'],
    ['v0.10.0', 'ccccccc3333333333333333333333333333333333'],
  ]);
  expect(readApp(app, tags, CHANGES, false)).toEqual({
    project: 'app',
    installs: [
      { file: 'client/package.json', tag: 'v0.9.0' },
      { file: 'package.json', tag: 'v0.10.0' },
    ],
    locked: { commit: 'aaaaaaa', matchesTag: true },
    behind: 2,
    changes: [
      { version: 'v0.10.0', lines: ['Ten'] },
      { version: 'v0.9.1', lines: ['Nine one', 'Second line'] },
    ],
    tickets: [{ id: UPDATE_TICKET, title: 'Bring it up to the newest app-kit' }],
    updateTicketOpen: true,
    fetched: 'not fetched',
  });
  // A lock that names another commit than the tag is flagged.
  expect(readApp(app, new Map([['v0.9.0', 'ddddddd'], ['v0.10.0', 'eeeeeee']]), CHANGES, false)?.locked).toEqual({ commit: 'aaaaaaa', matchesTag: false });
});

test('a checkout that installs no kit is not an app', () => {
  const plain = join(root, 'plain');
  mkdirSync(plain);
  git(plain, 'init', '-q', '-b', 'main');
  writeFileSync(join(plain, 'package.json'), '{}');
  git(plain, 'add', '-A');
  git(plain, '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'Plain');
  expect(readApp(plain, new Map(), CHANGES, false)).toBeNull();
});
