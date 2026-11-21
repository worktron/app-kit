// The apps page's reader (scripts/apps.ts): which version an app is on, what CHANGES.md asks of it since, and which
// of its tickets name the kit, read from what landed on its origin, never its working files. The checkout is a scratch
// repository under node_modules/.cache, as test/land.test.ts makes them, with git reading no global settings.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { changesSince, compareVersions, kitTickets, olderThan, readApp, tagsOnGitHub } from '../scripts/apps.ts';

/** A ticket an app's backlog holds that names the kit. */
const UPDATE_TICKET = 'kit-update';
import { CHANGES_HEADING } from '../scripts/land.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

// git itself first, and an identity to write refs as, since with no global settings a clone or commit makes one up
// from the machine's network name, which waited out 5 seconds on a busy Mac (testflight-stand-in.ts says why each).
const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
let root: string;

/** Apple's servers, which an app taking no iPhone sign-in never asks. */
const neverApple = async (host: string): Promise<never> => {
  throw new Error(`asked Apple for ${host}`);
};

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

test('an app is read as it landed on origin: the oldest tag it names, the lock checked against the tag, its kit tickets, each field the round names', async () => {
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
  expect(await readApp(app, tags, CHANGES, false, neverApple)).toEqual({
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
    // It takes no piece a feature belongs to (test/kit-features.test.ts reads those).
    lacks: [],
    unknown: [],
    fetched: 'not fetched',
  });
  // The round's instructions name the reader's fields, so each one they name is one the reader gives, and each one the
  // reader gives is named.
  const skill = readFileSync(join(import.meta.dir, '../.claude/skills/apps-round/SKILL.md'), 'utf8');
  const described = skill.slice(skill.indexOf('`scripts/apps.ts` stops'), skill.indexOf('The checklist exits'));
  const named = [...described.matchAll(/`([a-z][A-Za-z]*(?:\.[a-zA-Z]+)?)`/g)].map((match) => match[1]);
  const read = await readApp(app, tags, CHANGES, false, neverApple);
  if (!read || 'unread' in read) throw new Error('the app should be read');
  const keys = new Set([...Object.keys(read), ...Object.keys(read.installs[0]), ...Object.keys(read.installs[0].locked!), ...Object.keys(read.changes[0])]);
  for (const name of named) for (const part of name.split('.')) expect(keys).toContain(part);
  for (const key of Object.keys(read).filter((key) => key !== 'project')) expect(named.map((name) => name.split('.')[0])).toContain(key);
  expect(skill).toContain('bun scripts/apps.ts "$WORKSPACE"');
  expect(skill).not.toMatch(/updateTicketOpen|app-kit-update/);
  // A lock that names another commit than the tag is flagged.
  const mismatched = await readApp(app, new Map([['v0.9.0', 'ddddddd'], ['v0.10.0', 'eeeeeee']]), CHANGES, false, neverApple);
  if (!mismatched || 'unread' in mismatched) throw new Error('the app should be read');
  expect(mismatched.installs.map((install) => install.locked?.matchesTag)).toEqual([false, false, false]);
});

test('a checkout that installs no kit is not an app', async () => {
  const plain = join(root, 'plain');
  mkdirSync(plain);
  git(plain, 'init', '-q', '-b', 'main');
  writeFileSync(join(plain, 'package.json'), '{}');
  git(plain, 'add', '-A');
  git(plain, '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'Plain');
  expect(await readApp(plain, new Map(), CHANGES, false, neverApple)).toBeNull();
});

test('a checkout whose landed tree cannot be read is reported as unread, never as one that installs no kit', async () => {
  const broken = join(root, 'broken');
  mkdirSync(join(broken, '.git'), { recursive: true });
  expect(await readApp(broken, new Map(), CHANGES, false, neverApple)).toEqual({ project: 'broken', unread: expect.stringMatching(/^not a git checkout of its own: /) });
});

test("the kit's tags unread from GitHub stop the round rather than read as none", () => {
  const lone = join(root, 'lone');
  mkdirSync(lone);
  git(lone, 'init', '-q', '-b', 'main');
  expect(() => tagsOnGitHub(lone)).toThrow("reading the kit's tags from GitHub");
});

/** A checkout cloned from its own origin, whose package.json installs this tag ('' for none), in its own folder. */
function appIn(folder: string, name: string, tag: string) {
  const origin = join(folder, `${name}.git`);
  const seed = join(root, `${name}-seed-${Math.random().toString(36).slice(2)}`);
  mkdirSync(folder, { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ dependencies: tag ? { 'app-kit': `github:worktron/app-kit#${tag}` } : {} }));
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'The app');
  git(seed, 'push', '-q', origin, 'main');
  git(folder, 'clone', '-q', origin, name);
  return { origin, seed, checkout: join(folder, name) };
}

test('the urgent list fetches every checkout first, so an app that took up the kit since its last fetch is listed', async () => {
  const folder = join(root, 'adopted');
  const { origin, seed } = appIn(folder, 'late', '');
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ dependencies: { 'app-kit': 'github:worktron/app-kit#v0.9.0' } }));
  git(seed, 'commit', '-q', '-am', 'Take the kit');
  git(seed, 'push', '-q', origin, 'main');
  expect(await olderThan('0.10.0', folder)).toEqual({ older: [{ project: 'late', tag: 'v0.9.0' }], unread: [] });
});

test('a fetch that runs past its limit names the app unread rather than holding the landing open', async () => {
  const folder = join(root, 'stalled');
  const { checkout } = appIn(folder, 'slow', 'v0.9.0');
  // The origin's side of the fetch waits longer than the limit, as a remote that never answers would, and says its pid.
  const pidFile = join(folder, 'remote-side.pid');
  // It starts a process of its own, as an ssh does, which git does not stop when it is stopped.
  git(checkout, 'config', 'remote.origin.uploadpack', `sh -c 'sleep 30 & echo $! > ${pidFile}; wait' upload-pack`);
  expect(await olderThan('0.10.0', folder, undefined, 300)).toEqual({ older: [], unread: [{ project: 'slow', unread: 'fetch did not finish within 0.3 seconds' }] });
  // What the remote's side started is stopped with git, not left running: it is gone once it has been reaped.
  const remoteSide = Number(readFileSync(pidFile, 'utf8'));
  const running = () => {
    try {
      return Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(remoteSide)]).stdout.toString().trim().replace(/^Z.*/, '') !== '';
    } catch {
      return false;
    }
  };
  for (let check = 0; check < 200 && running(); check++) await Bun.sleep(10);
  expect(running()).toBe(false);
});

test('the guides say apps own their upgrades, and the apps report starts an upgrade only in an app the owner names', () => {
  const read = (file: string) => readFileSync(join(import.meta.dir, '..', file), 'utf8');
  for (const text of [read('AGENTS.md'), read('CHANGES.md'), CHANGES_HEADING]) expect(text).toContain('The kit starts no upgrades');
  const skill = read('.claude/skills/apps-round/SKILL.md');
  expect(skill).toContain('starts an upgrade thread only in an app the owner names');
  expect(skill).toContain('## 4. Upgrade an app the owner names\n\nOnly for an app the owner names.');
  // Nothing in the kit asks metamax to start a round or a thread.
  expect(read('scripts/land.ts')).not.toMatch(/report-event|spawn\.ts|METAMAX_HOME/);
});
