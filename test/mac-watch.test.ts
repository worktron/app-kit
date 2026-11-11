// `app-kit mac watch`: which landings are released, judged against the commit the releases repository's last release
// names; a last release that names none, held; failures held or tried again; the time limit; gh's named account; an
// app whose Tauri project is in a subfolder; and the log's exact lines. Real git repositories over file://, stand-ins
// for gh, bun install and the app's own release.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunOptions, RunResult } from '../command-line/run.ts';
import { builtFrom, countsAsMacApp, decide, watch, type Limits } from '../tauri/mac-release/watch.ts';
import { tauriConfig, releaseNotFound } from './mac-release-stand-in.ts';
import { commit, exit, git, GIT_IDENTITY_ENV, ok, pathWithGitItself, repository, scratch, standInRunner } from './testflight-stand-in.ts';

// Each test runs real git a dozen or more times, so it is held to the fifteen seconds a test may take, not Bun's five.
setDefaultTimeout(15_000);

const START = Date.UTC(2026, 10, 10, 12);
const MINUTE = 60_000;
const REPOSITORY = 'example/example-releases';

const APP = {
  'src-tauri/tauri.conf.json': tauriConfig((config) => {
    config.build = { frontendDist: '../dist' };
  }),
  'src/app.ts': 'export {};\n',
  'README.md': '# Example App\n',
  'package.json': '{}\n',
  'bun.lock': '{}\n',
};

let seed: ReturnType<typeof scratch>;
let seedOrigin: string;
let firstCommit: string;
beforeAll(() => {
  seed = scratch('mac-watch-seed-');
  seedOrigin = repository(join(seed.folder, 'example-app'), APP);
  firstCommit = git(seedOrigin, 'rev-parse', 'HEAD');
});
afterAll(() => seed.done());

let place: ReturnType<typeof scratch>;
let origin: string;
let state: string;
let clock: number;
let kitHasWatch: boolean;
let lastRelease: RunResult;
let releaseAnswer: (command: string[], options: RunOptions) => RunResult | Promise<RunResult>;

const released = (tag: string, sha: string) => ok(JSON.stringify({ tagName: tag, body: `Example App for Mac ${tag.slice(1)}, built from ${sha.slice(0, 7)} (${sha}).` }));

beforeEach(() => {
  place = scratch('mac-watch-');
  origin = join(place.folder, 'example-app');
  cpSync(seedOrigin, origin, { recursive: true });
  state = join(place.folder, 'state');
  clock = START;
  kitHasWatch = true;
  lastRelease = released('v0.1.3', firstCommit);
  releaseAnswer = () => ok('[mac release] releasing Example App 0.1.4 from abc1234\n[mac release] published Example App 0.1.4: https://github.com/example/example-releases/releases/tag/v0.1.4\n');
});

afterEach(() => place.done());

function runner() {
  const settings = { kitHasWatch, lastRelease, releaseAnswer };
  return standInRunner((command, options) => {
    const line = command.join(' ');
    if (line === 'bun install --frozen-lockfile') {
      const kit = join(options.cwd!, 'node_modules/app-kit/tauri/mac-release');
      mkdirSync(kit, { recursive: true });
      if (settings.kitHasWatch) writeFileSync(join(kit, 'watch.ts'), '');
      return ok('installed\n');
    }
    if (line === 'gh auth token --user example-owner') return ok('gho_stand-in-token\n');
    if (line.startsWith('gh auth token')) return exit(1, 'no oauth token found for github.com account another-owner\n');
    if (line === `gh release view --repo ${REPOSITORY} --json tagName,body`) return settings.lastRelease;
    if (line.includes('mac release')) return settings.releaseAnswer(command, options);
    return undefined;
  });
}

const env = () => ({ PATH: pathWithGitItself(process.env.PATH), HOME: place.folder, XDG_STATE_HOME: state, OP_SERVICE_ACCOUNT_TOKEN: 'from-the-shell', ...GIT_IDENTITY_ENV });

let failures = 0;
async function pass(options: { limits?: Partial<Limits>; urls?: string[]; ghUser?: string } = {}) {
  const stand = runner();
  const time = clock;
  failures = await watch({ urls: options.urls ?? [`file://${origin}`], ghUser: options.ghUser ?? 'example-owner', run: stand.run, env: env(), now: () => time, limits: options.limits });
  return stand;
}

const folder = () => join(state, 'app-kit/mac-release');
const logLines = () => {
  const file = join(folder(), 'mac-release.log');
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : [];
};
const at = (ms: number) => `${new Date(ms).toISOString()} example-app:`;
const head = () => git(origin, 'rev-parse', 'HEAD');
const short = (sha: string) => sha.slice(0, 7);

test('a landing that changes the app is released by its own kit, with exact log lines and gh as the named account', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  const stand = await pass();
  expect(logLines()).toEqual([
    `${at(START)} releasing ${short(head())}: app files changed since v0.1.3 (${short(firstCommit)}) (src/app.ts)`,
    `${at(START)} released 0.1.4 from ${short(head())}`,
  ]);
  expect(failures).toBe(0);
  const [release] = stand.named('mac release');
  expect(release!.command).toEqual(['caffeinate', '-i', 'taskpolicy', '-b', 'bun', 'run', 'app-kit', 'mac', 'release', '--token-only']);
  expect(release!.options.cwd).toBe(join(folder(), 'example-app/checkout'));
  expect(release!.options.env?.GH_TOKEN).toBe('gho_stand-in-token');
  // The token is read by the release's own op call, from the keychain; the shell's never reaches it.
  expect(release!.options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
  expect(release!.options.env?.GIT_TERMINAL_PROMPT).toBe('0');
  expect(stand.named('gh release view')[0]!.options.env?.GH_TOKEN).toBe('gho_stand-in-token');
  // It built main's exact commit.
  expect(git(join(folder(), 'example-app/checkout'), 'rev-parse', 'HEAD')).toBe(head());
  expect(readFileSync(join(folder(), 'example-app', `build-${git(origin, 'rev-list', '--count', 'HEAD')}.log`), 'utf8')).toContain('published Example App 0.1.4');
});

test('a landing that changes only docs, plans, tests, Rust test modules, check servers or test apps releases nothing', async () => {
  commit(origin, {
    'README.md': 'more\n',
    '.claude/plans/next.md': 'a plan\n',
    'test/app.test.ts': 'test\n',
    'e2e/window.spec.ts': 'test\n',
    'src-tauri/src/deliver_tests.rs': '#[cfg(test)]\n',
    'src-tauri/src/test_dir.rs': '#[cfg(test)]\n',
    'test-server/index.ts': 'serve\n',
    'test-app/index.html': '<p>\n',
    'playwright.config.ts': 'export default {};\n',
  });
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: no app files changed since v0.1.3 (${short(firstCommit)})`]);
  expect(stand.named('mac release')).toEqual([]);
  // Nothing was installed for a skip.
  expect(stand.named('bun install')).toEqual([]);
});

test('two landings between passes are judged together, and an app change followed by a docs landing still releases', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  commit(origin, { 'README.md': 'more\n' });
  const stand = await pass();
  expect(stand.named('mac release')).toHaveLength(1);
  expect(logLines()[0]).toBe(`${at(START)} releasing ${short(head())}: app files changed since v0.1.3 (${short(firstCommit)}) (src/app.ts)`);
});

test('main whose head the last release was built from, released by hand, is not released again', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  lastRelease = released('v0.1.4', head());
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: ${short(head())} is already released as v0.1.4`]);
  expect(stand.named('mac release')).toEqual([]);
});

test('a last release that names no commit on main holds the app until a release by hand, without failing the pass', async () => {
  lastRelease = ok(JSON.stringify({ tagName: 'v0.1.8', body: 'Example App for Mac 0.1.8' }));
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} held: the last release v0.1.8 names no commit on main; release once by hand from main, and the next landing is judged from it`]);
  expect(stand.named('mac release')).toEqual([]);
  expect(failures).toBe(0);
  // A commit that is not on main counts as none.
  lastRelease = released('v0.1.8', '0123456789abcdef0123456789abcdef01234567');
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  expect((await pass()).named('mac release')).toEqual([]);
  expect(logLines()[1]).toStartWith(`${at(START)} held: the last release v0.1.8 names no commit on main`);
  // The same head again asks nothing.
  const again = await pass();
  expect(again.calls.map((call) => call.command.slice(0, 2).join(' '))).toEqual(['git fetch', 'git rev-parse']);
  expect(logLines()).toHaveLength(2);
});

test('a releases repository with no release yet releases main', async () => {
  lastRelease = releaseNotFound;
  const stand = await pass();
  expect(logLines()[0]).toBe(`${at(START)} releasing ${short(head())}: the releases repository has no release yet`);
  expect(stand.named('mac release')).toHaveLength(1);
});

test('a release that did not compile is held until main moves', async () => {
  commit(origin, { 'src/app.ts': 'broken\n' });
  releaseAnswer = () => exit(3, '[mac release] the build of 0.1.4 did not compile: error: could not compile `example`\n');
  await pass();
  const count = git(origin, 'rev-list', '--count', 'HEAD');
  expect(logLines()[1]).toBe(`${at(START)} held: ${short(head())} did not compile: the build of 0.1.4 did not compile: error: could not compile \`example\`; held until main moves (build-${count}.log)`);
  expect(failures).toBe(1);
  clock += 2 * 60 * MINUTE;
  expect((await pass()).named('mac release')).toEqual([]);
  releaseAnswer = () => ok('[mac release] published Example App 0.1.4: https://example.com\n');
  commit(origin, { 'src/app.ts': 'fixed\n' });
  expect((await pass()).named('mac release')).toHaveLength(1);
});

test("a build that holds this Mac's folder paths is held until main moves, not built and notarized again every hour", async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  // A made-up home folder, written in two parts, since no file here may name one (test/public.test.ts).
  const path = ['/Users', 'someone/x.rs'].join('/');
  releaseAnswer = () => exit(4, `[mac release] the build holds 1 path of this Mac's home folder, which a public release would publish: ${path} in Example App.app/Contents/MacOS/example\n`);
  await pass();
  const count = git(origin, 'rev-list', '--count', 'HEAD');
  expect(logLines()[1]).toBe(
    `${at(START)} held: ${short(head())} holds this Mac's folder paths: the build holds 1 path of this Mac's home folder, which a public release would publish: ${path} in Example App.app/Contents/MacOS/example; held until main moves (build-${count}.log)`,
  );
  clock += 2 * 60 * MINUTE;
  expect((await pass()).named('mac release')).toEqual([]);
  commit(origin, { 'src/app.ts': 'export const changed = false;\n' });
  releaseAnswer = () => ok('[mac release] published Example App 0.1.4: https://example.com\n');
  expect((await pass()).named('mac release')).toHaveLength(1);
});

test('any other failure is tried again after an hour, and not before', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  releaseAnswer = () => exit(1, '[mac release] gh could not publish v0.1.4 in example/example-releases: HTTP 502\n');
  await pass();
  const count = git(origin, 'rev-list', '--count', 'HEAD');
  expect(logLines()[1]).toBe(`${at(START)} failed: the release of ${short(head())} exited 1: gh could not publish v0.1.4 in example/example-releases: HTTP 502; trying again in an hour (build-${count}.log)`);
  clock += 59 * MINUTE;
  expect((await pass()).named('mac release')).toEqual([]);
  clock += MINUTE;
  expect((await pass()).named('mac release')).toHaveLength(1);
});

test("main pinning an app-kit without the watcher's release waits, until a landing upgrades it", async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  kitHasWatch = false;
  const stand = await pass();
  expect(logLines()[1]).toBe(`${at(START)} waiting: main's app-kit has no mac release that runs with nobody there; the landing that upgrades it releases`);
  expect(stand.named('mac release')).toEqual([]);
  expect(failures).toBe(0);
  kitHasWatch = true;
  commit(origin, { 'bun.lock': '{"app-kit": "newer"}\n' });
  expect((await pass()).named('mac release')).toHaveLength(1);
});

test('a release that never finishes is stopped at its time limit, naming the step it was at', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  releaseAnswer = () => ({ code: 143, out: '[mac release] building Example App 0.1.4, signed by "x", and notarized\nNotarizing...\n', stdout: '', stderr: '', timedOut: true });
  await pass({ limits: { release: 75 * MINUTE } });
  const count = git(origin, 'rev-list', '--count', 'HEAD');
  expect(logLines()[1]).toBe(
    `${at(START)} failed: the release of ${short(head())} did not finish in 75 minutes and was stopped, at: building Example App 0.1.4, signed by "x", and notarized; trying again in an hour (build-${count}.log)`,
  );
});

test('gh with no token for the named account fails the app before anything is built', async () => {
  commit(origin, { 'src/app.ts': 'export const changed = true;\n' });
  const stand = await pass({ ghUser: 'another-owner' });
  expect(logLines()).toEqual([`${at(START)} failed: gh has no token for another-owner: no oauth token found for github.com account another-owner; trying again in an hour`]);
  expect(stand.named('gh release view')).toEqual([]);
  expect(stand.named('mac release')).toEqual([]);
});

test('a Tauri project in a subfolder is judged and released from its folder', async () => {
  const subfolder = join(place.folder, 'timescale');
  repository(subfolder, { 'desktop/src-tauri/tauri.conf.json': APP['src-tauri/tauri.conf.json'], 'desktop/package.json': '{}\n', 'server/index.ts': 'serve\n' });
  const first = git(subfolder, 'rev-parse', 'HEAD');
  lastRelease = released('v0.1.3', first);
  commit(subfolder, { 'server/index.ts': 'serve more\n' });
  const urls = [`file://${subfolder}#desktop`];
  expect((await pass({ urls })).named('mac release')).toEqual([]);
  expect(logLines()[0]).toBe(`${new Date(START).toISOString()} timescale: skipped: no app files changed since v0.1.3 (${short(first)})`);
  commit(subfolder, { 'desktop/src/app.ts': 'export {};\n' });
  const stand = await pass({ urls });
  expect(stand.named('mac release')[0]!.options.cwd).toBe(join(folder(), 'timescale/checkout/desktop'));
});

describe('what counts as the Mac app', () => {
  test("the iPhone watcher's rule, less Rust test modules, test- folders and Playwright's config", () => {
    for (const path of ['src/app.ts', 'src-tauri/src/lib.rs', 'src-tauri/tauri.conf.json', 'package.json', 'scripts/tray-icon.ts', 'src-tauri/src/testing.rs']) {
      expect(countsAsMacApp(path, 'packs-its-pages')).toBe(true);
    }
    for (const path of ['README.md', 'docs/a.ts', 'test/a.ts', 'e2e/a.ts', 'src/a.test.ts', 'src-tauri/src/config_tests.rs', 'src-tauri/src/deliver_test.rs', 'src-tauri/src/test_dir.rs', 'src-tauri/tests/a.rs', 'test-server/index.ts', 'test-app/main.tsx', 'playwright.config.ts']) {
      expect(countsAsMacApp(path, 'packs-its-pages')).toBe(false);
    }
    // A shell onto a hosted site is its Tauri folder and its package and lock files.
    expect(countsAsMacApp('src/app.ts', 'loads-a-website')).toBe(false);
    expect(countsAsMacApp('src-tauri/src/lib.rs', 'loads-a-website')).toBe(true);
    expect(countsAsMacApp('src-tauri/src/lib_tests.rs', 'loads-a-website')).toBe(false);
  });

  test('the commit a release was built from is read from its notes, the full one when they give it', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(builtFrom(`Example App for Mac 0.1.4, built from 0123456 (${sha}).`)).toBe(sha);
    expect(builtFrom('Messages Service for Mac 0.1.3, built from 29c0747.')).toBe('29c0747');
    expect(builtFrom('Timescale for Mac 0.1.8')).toBeNull();
  });

  test('a decision names what changed, up to three files', () => {
    const decision = decide({ lastTag: 'v0.1.3', lastCommit: 'a'.repeat(40), head: 'b'.repeat(40), changed: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'README.md'], kind: 'packs-its-pages' });
    expect(decision).toEqual({ release: true, reason: 'releasing bbbbbbb: app files changed since v0.1.3 (aaaaaaa) (src/a.ts, src/b.ts, src/c.ts and 1 more)' });
  });
});
