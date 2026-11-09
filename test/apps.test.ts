// The apps round's reader (scripts/apps.ts): which version an app is on, what CHANGES.md asks of it since, and which
// of its tickets name the kit, read from what landed on its origin, never its working files. The checkout is a scratch
// repository under node_modules/.cache, as test/land.test.ts makes them, with git reading no global settings.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { changesSince, compareVersions, kitTickets, readApp, tagsOnGitHub } from '../scripts/apps.ts';

/** A ticket an app's backlog holds that names the kit. */
const UPDATE_TICKET = 'kit-update';
import { CHANGES_HEADING } from '../scripts/land.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

// git itself first, and an identity to write refs as, since with no global settings a clone or commit makes one up
// from the machine's network name, which waited out 5 seconds on a busy Mac (testflight-stand-in.ts says why each).
const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
let root: string;

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
};

const CHANGES = `${CHANGES_HEADING}\n\n## v0.10.0\n\nUrgency: next round\n\n- Ten\n\n## v0.9.1\n\nUrgency: now\n\n- Nine one\n- Second line\n\n## v0.9.0\n\n- Nine\n`;

beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-apps-'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("these tests' git has an identity, so writing a ref never looks up the machine's name", () => {
  // Outside any repository, so only the environment can give one.
  const ident = Bun.spawnSync(['git', 'var', 'GIT_COMMITTER_IDENT'], { cwd: '/', env, stdout: 'pipe', stderr: 'pipe' });
  expect(ident.stdout.toString()).toStartWith('app <app@example.com> ');
});

test('versions compare as numbers, so 0.10 comes after 0.9', () => {
  expect(['v0.10.0', 'v0.9.1', 'v0.9.0'].sort(compareVersions)).toEqual(['v0.9.0', 'v0.9.1', 'v0.10.0']);
});

test("CHANGES.md's entries after a tag, newest first, each with its urgency and lines", () => {
  expect(changesSince(CHANGES, 'v0.8.0')).toEqual([
    { version: 'v0.10.0', urgency: 'next round', lines: ['Ten'] },
    { version: 'v0.9.1', urgency: 'now', lines: ['Nine one', 'Second line'] },
    { version: 'v0.9.0', urgency: null, lines: ['Nine'] },
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

test('an app is read as it landed on origin: the oldest tag it names, the lock checked against the tag, its kit tickets, each field the round names', () => {
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const app = join(root, 'app');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(join(seed, 'client'), { recursive: true });
  mkdirSync(join(seed, 'server'), { recursive: true });
  git(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.10.0' } }));
  writeFileSync(join(seed, 'client/package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.9.0' } }));
  writeFileSync(join(seed, 'client/bun.lock'), '"app-kit": ["app-kit@github:worktron/app-kit#aaaaaaa", {}],\n');
  writeFileSync(join(seed, 'server/package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.10.0' } }));
  writeFileSync(join(seed, 'bun.lock'), '"app-kit": ["app-kit@github:worktron/app-kit#ccccccc", {}],\n');
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
    // Each install is judged by the lock in its own folder, the root's newer lock not mistaken for the client's.
    installs: [
      { file: 'client/package.json', tag: 'v0.9.0', locked: { commit: 'aaaaaaa', matchesTag: true } },
      { file: 'package.json', tag: 'v0.10.0', locked: { commit: 'ccccccc', matchesTag: true } },
      // A folder with no lock of its own is served by the nearest one above.
      { file: 'server/package.json', tag: 'v0.10.0', locked: { commit: 'ccccccc', matchesTag: true } },
    ],
    behind: 2,
    changes: [
      { version: 'v0.10.0', urgency: 'next round', lines: ['Ten'] },
      { version: 'v0.9.1', urgency: 'now', lines: ['Nine one', 'Second line'] },
    ],
    // The most urgent release it lacks, which puts it first in the round.
    urgency: 'now',
    tickets: [{ id: UPDATE_TICKET, title: 'Bring it up to the newest app-kit' }],
    fetched: 'not fetched',
  });
  // The round's instructions name the reader's fields, so each one they name is one the reader gives, and each one the
  // reader gives is named.
  const skill = readFileSync(join(import.meta.dir, '../.claude/skills/apps-round/SKILL.md'), 'utf8');
  const described = skill.slice(skill.indexOf('`scripts/apps.ts` stops'), skill.indexOf('The checklist exits'));
  const named = [...described.matchAll(/`([a-z][A-Za-z]*(?:\.[a-zA-Z]+)?)`/g)].map((match) => match[1]);
  const read = readApp(app, tags, CHANGES, false)!;
  const keys = new Set([...Object.keys(read), ...Object.keys(read.installs[0]), ...Object.keys(read.installs[0].locked!), ...Object.keys(read.changes[0])]);
  for (const name of named) for (const part of name.split('.')) expect(keys).toContain(part);
  for (const key of Object.keys(read).filter((key) => key !== 'project')) expect(named.map((name) => name.split('.')[0])).toContain(key);
  expect(skill).toContain('bun scripts/apps.ts "$WORKSPACE"');
  expect(skill).not.toMatch(/updateTicketOpen|app-kit-update/);
  // A lock that names another commit than the tag is flagged.
  expect(readApp(app, new Map([['v0.9.0', 'ddddddd'], ['v0.10.0', 'eeeeeee']]), CHANGES, false)?.installs.map((install) => install.locked?.matchesTag)).toEqual([false, false, false]);
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

test("the kit's tags unread from GitHub stop the round rather than read as none", () => {
  const lone = join(root, 'lone');
  mkdirSync(lone);
  git(lone, 'init', '-q', '-b', 'main');
  expect(() => tagsOnGitHub(lone)).toThrow("reading the kit's tags from GitHub");
});
