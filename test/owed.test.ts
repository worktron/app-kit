// What an app owes the kit at its landing (scripts/owed.ts) and the catch-up ticket an urgent release files
// (scripts/urgent-tickets.ts). Apps are made up: owedBy takes what readApp reads, and one scratch repository under
// node_modules/.cache, as test/apps.test.ts makes them, shows a branch's HEAD read over what landed on its origin.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readApp, type App } from '../scripts/apps.ts';
import { CATCH_UP, HOLD_AFTER_DAYS, owedLines, owedBy, releaseDays } from '../scripts/owed.ts';
import { catchUpSection, fileCatchUps, type Landed } from '../scripts/urgent-tickets.ts';
import { startUrgentTickets } from '../scripts/land.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

const TODAY = new Date('2026-11-21T12:00:00');
const DAYS = new Map([
  ['v0.12.0', '2026-11-21'],
  ['v0.11.0', '2026-11-18'],
  ['v0.10.2', '2026-11-07'],
  ['v0.10.1', '2026-11-06'],
  ['v0.10.0', '2026-11-01'],
  ['v0.9.1', '2026-10-30'],
]);

/** A made-up app on v0.9.0 with matching locks, owing what `changes` lists. */
function app(changes: App['changes'], overrides: Partial<App> = {}): App {
  return {
    project: 'garden',
    installs: [{ file: 'package.json', tag: 'v0.9.0', locked: { commit: 'aaaaaaa', matchesTag: true } }],
    behind: changes.length,
    changes,
    urgency: null,
    tickets: [],
    lacks: [],
    unknown: [],
    fetched: 'not fetched',
    ...overrides,
  };
}

test("each release's day is read from the kit's Version commits", () => {
  expect(releaseDays('2026-11-21 Version 0.12.0\n2026-11-18 Version 0.11.0\n2026-11-18 Merge the thing\n')).toEqual(
    new Map([
      ['v0.12.0', '2026-11-21'],
      ['v0.11.0', '2026-11-18'],
    ]),
  );
});

test(`a release asking something of an app is listed while young and holds once out more than ${HOLD_AFTER_DAYS} days`, () => {
  const owing = owedBy(
    app([
      { version: 'v0.11.0', urgency: 'next round', lines: ['Three days old'] },
      { version: 'v0.10.0', urgency: 'next round', lines: ['Twenty days old'] },
    ]),
    DAYS,
    TODAY,
  );
  expect(owing.releases.map(({ version, days, holds }) => ({ version, days, holds }))).toEqual([
    { version: 'v0.11.0', days: 3, holds: false },
    { version: 'v0.10.0', days: 20, holds: true },
  ]);
  expect(owing.holds).toBe(true);
});

test(`the hold starts the day after a release has been out ${HOLD_AFTER_DAYS} days`, () => {
  const owing = owedBy(
    app([
      { version: 'v0.10.2', urgency: 'next round', lines: ['Fourteen days old'] },
      { version: 'v0.10.1', urgency: 'next round', lines: ['Fifteen days old'] },
    ]),
    DAYS,
    TODAY,
  );
  expect(owing.releases.map(({ version, days, holds }) => ({ version, days, holds }))).toEqual([
    { version: 'v0.10.2', days: 14, holds: false },
    { version: 'v0.10.1', days: 15, holds: true },
  ]);
});

test('an urgent release is listed at once but holds on the same clock, since the kit cannot tell which apps it concerns', () => {
  const young = owedBy(app([{ version: 'v0.12.0', urgency: 'now', lines: ['Urgent today'] }]), DAYS, TODAY);
  expect(young.holds).toBe(false);
  expect(owedLines(young, 'v0.12.0')).toContain('  listed v0.12.0 (now, out 0 days): Urgent today');
  const old = owedBy(app([{ version: 'v0.9.1', urgency: 'now', lines: ['Urgent long ago'] }]), DAYS, TODAY);
  expect(old.holds).toBe(true);
});

test('a release with nothing to do is never listed, and an app with nothing owed is not held', () => {
  const owing = owedBy(app([{ version: 'v0.10.0', urgency: 'rides along', lines: ['Nothing to do'] }, { version: 'v0.9.1', urgency: null, lines: [] }]), DAYS, TODAY);
  expect(owing.releases).toEqual([]);
  expect(owing.holds).toBe(false);
  expect(owedLines(owing, 'v0.12.0').at(-1)).toBe('app-kit owed: nothing owed.');
});

test('a package.json moved without its lock still holds, as does one whose lock is missing', () => {
  const owing = owedBy(
    app([], {
      installs: [
        { file: 'package.json', tag: 'v0.12.0', locked: { commit: 'aaaaaaa', matchesTag: false } },
        { file: 'client/package.json', tag: 'v0.12.0', locked: null },
      ],
    }),
    DAYS,
    TODAY,
  );
  expect(owing.locks).toEqual(['package.json names v0.12.0, but its bun.lock installs aaaaaaa', 'client/package.json names v0.12.0, but no bun.lock installs it']);
  expect(owing.holds).toBe(true);
  // The hold says its own cause, not an old release.
  expect(owedLines(owing, 'v0.12.0').at(-1)).toStartWith('app-kit owed: held: a package.json names a version its bun.lock does not install. Move');
});

test('an app is on the oldest version any package.json names, so moving one of two leaves the old releases owed', () => {
  const owing = owedBy(
    app([{ version: 'v0.10.0', urgency: 'next round', lines: ['Old'] }], {
      installs: [
        { file: 'package.json', tag: 'v0.12.0', locked: { commit: 'ccccccc', matchesTag: true } },
        { file: 'client/package.json', tag: 'v0.9.0', locked: { commit: 'aaaaaaa', matchesTag: true } },
      ],
    }),
    DAYS,
    TODAY,
  );
  expect(owing).toMatchObject({ on: 'v0.9.0', holds: true });
});

test('features the app lacks are listed and never hold it', () => {
  const owing = owedBy(app([], { lacks: ["Postgres opened with the kit's openDb"] }), DAYS, TODAY);
  expect(owing.holds).toBe(false);
  expect(owedLines(owing, 'v0.12.0')).toContain("  lacks (listed, never holds): Postgres opened with the kit's openDb");
});

test('a held app is told to move every package.json with its lock in one catch-up', () => {
  const owing = owedBy(app([{ version: 'v0.10.0', urgency: 'next round', lines: ['Old'] }], { tickets: [{ id: CATCH_UP, title: 'Catch up' }] }), DAYS, TODAY);
  const lines = owedLines(owing, 'v0.12.0');
  expect(lines).toContain(`  its backlog holds the ${CATCH_UP} ticket; once this catch-up lands, drop it`);
  expect(lines.at(-1)).toContain('github:worktron/app-kit#v0.12.0 with its bun.lock');
  expect(lines.at(-1)).toContain('one thread takes this catch-up');
});

test('a release with no Version commit on the kit counts as old, so it holds rather than stopping the check', () => {
  const owing = owedBy(app([{ version: 'v0.13.0', urgency: 'next round', lines: ['Released by hand'] }]), DAYS, TODAY);
  expect(owing.releases[0]).toMatchObject({ version: 'v0.13.0', released: null, holds: true });
  expect(owedLines(owing, 'v0.13.0')).toContain('  holds  v0.13.0 (next round, out on a day the kit has no record of): Released by hand');
});

const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
};
let root: string;
beforeAll(() => {
  const cache = join(import.meta.dir, '../node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-owed-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a landing's check reads the branch's HEAD, so the branch's own move to a newer kit counts", async () => {
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const app = join(root, 'garden');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(seed);
  git(seed, 'init', '-q', '-b', 'main');
  const install = (dir: string, tag: string, commit: string) => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'app-kit': `github:worktron/app-kit#${tag}` } }));
    writeFileSync(join(dir, 'bun.lock'), `"app-kit": ["app-kit@github:worktron/app-kit#${commit}", {}],\n`);
  };
  install(seed, 'v0.9.0', 'aaaaaaa');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'On v0.9.0');
  git(seed, 'push', '-q', origin, 'main');
  git(root, 'clone', '-q', origin, app);
  git(app, 'checkout', '-q', '-b', 'catch-up');
  install(app, 'v0.12.0', 'ccccccc');
  git(app, 'commit', '-q', '-am', 'Move to v0.12.0');
  const tags = new Map([
    ['v0.9.0', 'aaaaaaa1111111111111111111111111111111111'],
    ['v0.12.0', 'ccccccc3333333333333333333333333333333333'],
  ]);
  const changes = '# Changes\n\n## v0.12.0\n\nUrgency: next round\n\n- Twelve\n\n## v0.10.0\n\nUrgency: next round\n\n- Ten\n';
  const neverApple = async (host: string): Promise<never> => {
    throw new Error(`asked Apple for ${host}`);
  };
  const landed = (await readApp(app, tags, changes, false, neverApple)) as App;
  expect(owedBy(landed, DAYS, TODAY).holds).toBe(true);
  const branch = (await readApp(app, tags, changes, false, neverApple, 'HEAD')) as App;
  expect(branch.installs).toEqual([{ file: 'package.json', tag: 'v0.12.0', locked: { commit: 'ccccccc', matchesTag: true } }]);
  expect(owedBy(branch, DAYS, TODAY)).toMatchObject({ on: 'v0.12.0', releases: [], holds: false });
});

test("an urgent release's ticket names the release, what it asks, and when the catch-up is done", () => {
  const section = catchUpSection('v0.12.0', ['A fix for sign-in.']);
  expect(section.split('\n')[0]).toBe(`## ${CATCH_UP} · Catch up with app-kit, starting with the urgent v0.12.0`);
  expect(section).toContain('v0.12.0 is urgent: A fix for sign-in.');
  expect(section).toContain('Done when: every package.json names app-kit v0.12.0 or later, every bun.lock installs it');
});

test('each app behind gets the ticket once: one already holding it is said, and a failure says how to file it again', async () => {
  const asked: { project: string; section: string }[] = [];
  const land = async (project: string, sectionFile: string): Promise<Landed> => {
    asked.push({ project, section: readFileSync(sectionFile, 'utf8') });
    if (project === 'meadow') return { code: 3, out: `refused, nothing written: ${CATCH_UP} is already a heading in .claude/plans/backlog.md on meadow's main (abc1234)` };
    if (project === 'orchard') return { code: 4, out: 'land-main: stopped: the push failed' };
    return { code: 0, out: `id=${CATCH_UP} sha=abc file=.claude/plans/backlog.md` };
  };
  expect(await fileCatchUps('v0.12.0', ['A fix.'], ['garden', 'meadow', 'orchard'], land)).toEqual([
    `garden: filed ${CATCH_UP}`,
    `meadow: already holds ${CATCH_UP}`,
    'orchard: not filed (land-main: stopped: the push failed); again: bun scripts/urgent-tickets.ts v0.12.0',
  ]);
  expect(asked.map(({ project }) => project)).toEqual(['garden', 'meadow', 'orchard']);
  expect(asked[0].section).toBe(catchUpSection('v0.12.0', ['A fix.']));
});

test("only a landing that released an urgent version starts the ticket filer, detached, to a log of its own, or says it filed none without metamax", () => {
  const started: { command: string[]; log: string }[] = [];
  const start = (command: string[], log: string) => started.push({ command, log });
  const urgent = { landed: true, sha: 'abc', version: '0.12.0', urgency: 'now' } as const;
  // A landing that released nothing urgent, or did not land, starts nothing.
  for (const other of [{ ...urgent, urgency: 'next round' } as const, { landed: true, sha: 'abc' } as const, { landed: false, reason: 'red' } as const]) {
    expect(startUrgentTickets(other, { metamax: '/opt/metamax', kit: '/kit', gitFolder: '/kit/.git', start })).toBeNull();
  }
  expect(started).toEqual([]);
  const line = startUrgentTickets(urgent, { metamax: '/opt/metamax', kit: '/kit', gitFolder: '/kit/.git', start });
  expect(started).toEqual([{ command: ['bun', '/kit/scripts/urgent-tickets.ts', 'v0.12.0'], log: '/kit/.git/urgent-tickets-v0.12.0.log' }]);
  expect(line).toBe('urgent tickets: filing a catch-up ticket in each app behind v0.12.0 after this landing; results in /kit/.git/urgent-tickets-v0.12.0.log, again with bun scripts/urgent-tickets.ts v0.12.0');
  started.length = 0;
  expect(startUrgentTickets(urgent, { metamax: undefined, kit: '/kit', gitFolder: '/kit/.git', start })).toBe(
    "urgent tickets: not filed, since METAMAX_HOME is not set; file them with METAMAX_HOME set to metamax's checkout: bun scripts/urgent-tickets.ts v0.12.0",
  );
  expect(started).toEqual([]);
});
