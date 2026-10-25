// `app-kit testflight watch`: which landings go up, judged against what App Store Connect holds; the record that keeps
// an unmoved main from reading the key; failures held or tried again; the lock, the time limits, and the log's exact
// lines. Real git repositories over file://, a stand-in App Store Connect, and stand-ins for bun install, the keychain,
// 1Password and the app's own upload.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand, type RunOptions, type RunResult } from '../tauri/testflight/run.ts';
import { appKind, appName, commitForNumber, countsAsApp, decide, lock, watch, type Limits } from '../tauri/testflight/watch.ts';
import { appStoreConnect, commit, emptyCommits, exit, git, ITEM_JSON, ok, repository, scratch, standInRunner, TOKEN } from './testflight-stand-in.ts';

// Each test runs real git a dozen or more times, so it is held to the fifteen seconds a test may take, not Bun's five.
setDefaultTimeout(15_000);

const START = Date.UTC(2026, 9, 25, 12);
const MINUTE = 60_000;

let place: ReturnType<typeof scratch>;
let origin: string;
let state: string;
let asc: Awaited<ReturnType<typeof appStoreConnect>>;
let clock: number;
let kitHasUpload: boolean;
let token: boolean;
let uploadAnswer: (command: string[], options: RunOptions) => RunResult | Promise<RunResult>;

const PAST_THE_BREAK = {
  'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'app.pastthebreak', build: { frontendDist: '../dist' } }),
  'src/app.ts': 'export {};\n',
  'README.md': '# Past the Break\n',
  'package.json': '{}\n',
  'bun.lock': '{}\n',
};

beforeEach(async () => {
  place = scratch('testflight-watch-');
  origin = repository(join(place.folder, 'urge-surfer'), PAST_THE_BREAK);
  state = join(place.folder, 'state');
  asc = await appStoreConnect({ bundleId: 'app.pastthebreak' });
  clock = START;
  kitHasUpload = true;
  token = true;
  uploadAnswer = () => ok('[testflight] building build\n[testflight] uploading build 9 (abc1234)\n[testflight] build 9 (abc1234) processed; TestFlight: IN_BETA_TESTING\n');
});

afterEach(async () => {
  await asc.stop();
  place.done();
});

const countOf = (commitSha: string) => Number(git(origin, 'rev-list', '--count', commitSha));
const shortOf = (commitSha: string) => commitSha.slice(0, 7);
const head = () => git(origin, 'rev-parse', 'HEAD');
/** App Store Connect holds the build of each commit. */
const uploaded = (...commits: string[]) => {
  for (const c of commits) asc.builds.push({ number: String(countOf(c)), states: ['VALID'] });
};

function runner() {
  return standInRunner((command, options) => {
    const line = command.join(' ');
    if (line === 'bun install --frozen-lockfile') {
      // The app's packages, with or without a kit that has the upload.
      const kit = join(options.cwd!, 'node_modules/app-kit/tauri/testflight');
      mkdirSync(kit, { recursive: true });
      if (kitHasUpload) writeFileSync(join(kit, 'upload.ts'), '');
      return ok('installed\n');
    }
    if (command[0] === '/usr/bin/security') return token ? ok(`${TOKEN}\n`) : exit(44, 'security: The specified item could not be found in the keychain.');
    if (command[0] === 'op') return ok(ITEM_JSON);
    if (line.includes('testflight upload')) return uploadAnswer(command, options);
    return undefined;
  });
}

let failures = 0;
async function pass(stand = runner(), limits: Partial<Limits> = {}) {
  failures = await watch({
    urls: [`file://${origin}`],
    run: stand.run,
    env: { PATH: process.env.PATH, HOME: place.folder, XDG_STATE_HOME: state, OP_SERVICE_ACCOUNT_TOKEN: 'from-the-shell' },
    now: () => clock,
    appStoreConnect: asc.options,
    limits,
  });
  return stand;
}

const folder = () => join(state, 'app-kit/testflight');
const logLines = () => {
  const file = join(folder(), 'testflight.log');
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : [];
};
const record = () => JSON.parse(readFileSync(join(folder(), 'urge-surfer/record.json'), 'utf8'));
const at = (ms: number) => `${new Date(ms).toISOString()} urge-surfer:`;

test('a landing that changes the app is built and uploaded, with exact log lines and the build named by its count', async () => {
  const first = head();
  uploaded(first);
  const change = commit(origin, { 'src/app.ts': 'export const coast = true;\n' });
  const stand = await pass();
  expect(logLines()).toEqual([
    `${at(START)} uploading build ${countOf(change)} (${shortOf(change)}): app files changed since build ${countOf(first)} (src/app.ts)`,
    `${at(START)} uploaded build ${countOf(change)} (${shortOf(change)}), processed`,
  ]);
  const upload = stand.named('testflight upload')[0];
  expect(upload.command).toEqual(['caffeinate', '-i', 'taskpolicy', '-b', 'bun', 'run', 'app-kit', 'testflight', 'upload', '--token-only']);
  expect(upload.options.cwd).toBe(join(folder(), 'urge-surfer/checkout'));
  expect(git(upload.options.cwd!, 'rev-parse', 'HEAD')).toBe(change);
  // The token is read for the watcher's own 1Password call, and never reaches what it runs.
  expect(stand.named('op item get')[0].options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBe(TOKEN);
  for (const call of stand.calls.filter((c) => c.command[0] !== 'op')) expect(call.options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
  expect(readFileSync(join(folder(), `urge-surfer/build-${countOf(change)}.log`), 'utf8')).toContain('[testflight] uploading build');
  expect(record()).toEqual({ judgedHead: change, failure: null, fetchFailingSince: null });
});

test('a landing that changes only documentation, plans and tests uploads nothing', async () => {
  const first = head();
  uploaded(first);
  commit(origin, { 'README.md': '# Past the Break, now\n', '.claude/plans/x.md': 'plan\n', 'src/app.test.ts': 'test\n', 'e2e/flow.ts': 'flow\n' });
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: no app files changed since build ${countOf(first)}`]);
  expect(stand.named('testflight upload')).toEqual([]);
});

test('two landings between passes are judged together', async () => {
  const first = head();
  uploaded(first);
  commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  const docs = commit(origin, { 'README.md': 'docs\n' });
  await pass();
  expect(logLines()[0]).toBe(`${at(START)} uploading build ${countOf(docs)} (${shortOf(docs)}): app files changed since build ${countOf(first)} (src/app.ts)`);
});

test('an app change whose upload failed, followed by a documentation-only landing, still uploads', async () => {
  const first = head();
  uploaded(first);
  const change = commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  uploadAnswer = () => exit(1, '[testflight] altool did not upload build 2: ERROR: network\n');
  await pass();
  expect(logLines()[1]).toBe(
    `${at(START)} failed: the upload of build ${countOf(change)} (${shortOf(change)}) exited 1: altool did not upload build 2: ERROR: network; trying again in an hour (build-${countOf(change)}.log)`,
  );
  const docs = commit(origin, { 'README.md': 'docs\n' });
  uploadAnswer = () => ok('[testflight] done\n');
  clock += 5 * MINUTE;
  await pass();
  expect(logLines().slice(2)).toEqual([
    `${at(clock)} uploading build ${countOf(docs)} (${shortOf(docs)}): app files changed since build ${countOf(first)} (src/app.ts)`,
    `${at(clock)} uploaded build ${countOf(docs)} (${shortOf(docs)}), processed`,
  ]);
});

test('main whose head App Store Connect already holds, uploaded by hand, is not built again', async () => {
  commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  uploaded(head());
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: build ${countOf(head())} (${shortOf(head())}) is already in App Store Connect`]);
  expect(stand.named('testflight upload')).toEqual([]);
});

test('no build in App Store Connect yet uploads main', async () => {
  await pass();
  expect(logLines()[0]).toBe(`${at(START)} uploading build 1 (${shortOf(head())}): App Store Connect has no build yet`);
});

test("a newest build whose number names no commit on main's first-parent line uploads main, saying why", async () => {
  // A merge brings two commits from a branch, so main's first-parent counts go 1, 2, 5: number 3 names no main commit.
  commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  git(origin, 'checkout', '-q', '-b', 'side', 'HEAD~1');
  commit(origin, { 'src/side.ts': 'export {};\n' });
  commit(origin, { 'src/side2.ts': 'export {};\n' });
  git(origin, 'checkout', '-q', 'main');
  git(origin, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  expect(countOf(head())).toBe(5);
  asc.builds.push({ number: '3', states: ['VALID'] }, { number: '1', states: ['VALID'] });
  await pass();
  expect(logLines()[0]).toBe(`${at(START)} uploading build 5 (${shortOf(head())}): App Store Connect's newest build 3 names no commit on main`);
});

test('a newest build above main\'s count skips, saying uploads resume when main passes it', async () => {
  asc.builds.push({ number: '40', states: ['VALID'] });
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: App Store Connect's newest build 40 is above main's count 1; uploads resume when main passes it`]);
  expect(stand.named('testflight upload')).toEqual([]);
});

test('build numbers are compared as numbers across 99 and 100, never by the server\'s order', async () => {
  emptyCommits(origin, 98);
  const ninetyNine = head();
  const hundred = commit(origin, { 'src/app.ts': 'export const a = 100;\n' });
  expect([countOf(ninetyNine), countOf(hundred)]).toEqual([99, 100]);
  // The server lists 99 before 100; read as text, 99 would be newest and build 100 would go up again.
  uploaded(hundred, ninetyNine);
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} skipped: build 100 (${shortOf(hundred)}) is already in App Store Connect`]);
  expect(stand.named('testflight upload')).toEqual([]);
  expect(asc.requests.find((r) => r.startsWith('/v1/builds'))).toContain('limit=200');
});

test('a compile failure is held until main moves', async () => {
  uploaded(head());
  const broken = commit(origin, { 'src/app.ts': 'export const = ;\n' });
  uploadAnswer = () => exit(3, "[testflight] build 2 (abc1234) did not compile: error: could not compile `past-the-break`\n");
  await pass();
  expect(logLines()[1]).toBe(
    `${at(START)} held: build ${countOf(broken)} (${shortOf(broken)}) did not compile: build 2 (abc1234) did not compile: error: could not compile \`past-the-break\`; held until main moves (build-${countOf(broken)}.log)`,
  );
  clock += 3 * 60 * MINUTE;
  const later = await pass();
  expect(logLines()).toHaveLength(2);
  expect(later.named('testflight upload')).toEqual([]);
  const fixed = commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  uploadAnswer = () => ok('[testflight] done\n');
  await pass();
  expect(logLines().at(-1)).toBe(`${at(clock)} uploaded build ${countOf(fixed)} (${shortOf(fixed)}), processed`);
});

test('any other failure is tried again after an hour, and not before', async () => {
  uploaded(head());
  const change = commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  uploadAnswer = () => exit(1, '[testflight] the build of 2 (abc1234) failed: error: No signing certificate\n');
  await pass();
  expect(record().failure).toEqual({ commit: change, step: 'upload', time: new Date(START).toISOString() });
  clock = START + 59 * MINUTE;
  expect((await pass()).named('testflight upload')).toEqual([]);
  expect(logLines()).toHaveLength(2);
  clock = START + 60 * MINUTE;
  uploadAnswer = () => ok('[testflight] done\n');
  expect((await pass()).named('testflight upload')).toHaveLength(1);
  expect(logLines().slice(2)).toEqual([
    `${at(clock)} uploading build ${countOf(change)} (${shortOf(change)}): app files changed since build 1 (src/app.ts)`,
    `${at(clock)} uploaded build ${countOf(change)} (${shortOf(change)}), processed`,
  ]);
});

test('without the token in the keychain it waits, reads no key, and checks again after an hour', async () => {
  token = false;
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} waiting for the 1Password token: the login keychain has no "app-kit testflight" item; checking again in an hour`]);
  expect(stand.named('op')).toEqual([]);
  expect(asc.requests).toEqual([]);
  clock += 61 * MINUTE;
  token = true;
  await pass();
  expect(logLines().at(-1)).toBe(`${at(clock)} uploaded build 1 (${shortOf(head())}), processed`);
});

test("main pinning an app-kit without the upload waits, reading no token or key, until main moves", async () => {
  kitHasUpload = false;
  const stand = await pass();
  expect(logLines()).toEqual([`${at(START)} waiting: main's app-kit has no testflight upload`]);
  expect(stand.named('security')).toEqual([]);
  expect(stand.named('op')).toEqual([]);
  clock += 2 * 60 * MINUTE;
  await pass();
  expect(logLines()).toHaveLength(1);
});

test('the same head twice reads no key and writes no line', async () => {
  uploaded(head());
  await pass();
  expect(logLines()).toHaveLength(1);
  clock += 5 * MINUTE;
  const second = await pass();
  expect(logLines()).toHaveLength(1);
  expect(second.calls.map((c) => c.command.slice(0, 2).join(' '))).toEqual(['git fetch', 'git rev-parse']);
});

test('a lock left by a killed pass is taken over; a live one makes the pass do nothing', async () => {
  const dead = Bun.spawn(['true']);
  await dead.exited;
  mkdirSync(folder(), { recursive: true });
  writeFileSync(join(folder(), 'testflight.lock'), String(dead.pid));
  await pass();
  expect(logLines()).toHaveLength(2);
  expect(existsSync(join(folder(), 'testflight.lock'))).toBe(false);

  const live = Bun.spawn(['sleep', '60']);
  try {
    writeFileSync(join(folder(), 'testflight.lock'), String(live.pid));
    commit(origin, { 'src/app.ts': 'export const a = 2;\n' });
    const blocked = await pass();
    expect(blocked.calls).toEqual([]);
    expect(lock(join(folder(), 'testflight.lock'))).toBe(false);
  } finally {
    live.kill();
  }
});

test('a step that never exits is stopped at its time limit with everything it started, and tried again after an hour', async () => {
  uploaded(head());
  const change = commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  const marker = join(place.folder, 'still-running');
  // The upload's build hangs; the process it started would touch the marker if it outlived the limit.
  uploadAnswer = (_, options) => runCommand(['sh', '-c', `(sleep 3; touch ${marker}) & sleep 600`], options);
  await pass(runner(), { build: 300 });
  expect(logLines()[1]).toBe(
    `${at(START)} failed: the build of build ${countOf(change)} (${shortOf(change)}) did not finish in 0.3 seconds and was stopped; trying again in an hour (build-${countOf(change)}.log)`,
  );
  expect(record().failure.step).toBe('build');
  // Once the build says it is uploading, the upload's own limit replaces the build's.
  clock += 61 * MINUTE;
  uploadAnswer = (_, options) => runCommand(['sh', '-c', `echo "[testflight] uploading build 2 (abc1234)"; sleep 600`], options);
  await pass(runner(), { build: 60 * MINUTE, upload: 300 });
  expect(logLines().at(-1)).toBe(
    `${at(clock)} failed: the upload of build ${countOf(change)} (${shortOf(change)}) did not finish in 0.3 seconds and was stopped; trying again in an hour (build-${countOf(change)}.log)`,
  );
  const stopped = Bun.spawnSync(['pgrep', '-f', `touch ${marker}`]);
  expect(stopped.stdout.toString()).toBe('');
});

test('a dirtied build checkout is put back to main\'s commit, keeping installed packages and the Rust build', async () => {
  uploaded(head());
  await pass();
  const checkout = join(folder(), 'urge-surfer/checkout');
  writeFileSync(join(checkout, 'src/app.ts'), 'changed by hand\n');
  writeFileSync(join(checkout, 'stray.txt'), 'left over\n');
  mkdirSync(join(checkout, 'src-tauri/target/release'), { recursive: true });
  writeFileSync(join(checkout, 'src-tauri/target/release/cache'), 'kept\n');
  commit(origin, { 'README.md': 'docs\n' });
  await pass();
  expect(readFileSync(join(checkout, 'src/app.ts'), 'utf8')).toBe('export {};\n');
  expect(existsSync(join(checkout, 'stray.txt'))).toBe(false);
  expect(existsSync(join(checkout, 'src-tauri/target/release/cache'))).toBe(true);
  expect(existsSync(join(checkout, 'node_modules/app-kit/tauri/testflight/upload.ts'))).toBe(true);
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(head());
});

test('a failing fetch writes one line when it starts and one when it works again', async () => {
  uploaded(head());
  await pass();
  const moved = `${origin}-moved`;
  Bun.spawnSync(['mv', origin, moved]);
  await pass();
  clock += 5 * MINUTE;
  await pass();
  expect(logLines().slice(1)).toHaveLength(1);
  expect(logLines()[1]).toStartWith(`${at(START)} failed: fetching main: `);
  Bun.spawnSync(['mv', moved, origin]);
  clock += 5 * MINUTE;
  await pass();
  expect(logLines()[2]).toBe(`${at(clock)} fetching main works again (failing since ${new Date(START).toISOString()})`);
});

test('a pass gives how many apps had a step fail, so the command exits 1; skips and waiting are not failures', async () => {
  uploaded(head());
  await pass();
  expect(failures).toBe(0);
  commit(origin, { 'src/app.ts': 'export const a = 1;\n' });
  token = false;
  await pass();
  expect(failures).toBe(0);
  clock += 61 * MINUTE;
  token = true;
  uploadAnswer = () => exit(1, '[testflight] the build of 2 (abc1234) failed: error: No signing certificate\n');
  await pass();
  expect(failures).toBe(1);
});

describe('what counts as the iPhone app', () => {
  test('an iPhone shell that loads a website is its Tauri folder, package and lock files', () => {
    const argon = JSON.stringify({ identifier: 'com.worktron.argon', build: { frontendDist: 'https://argon.worktron.com' } });
    expect(appKind(argon)).toBe('loads-a-website');
    for (const path of ['src-tauri/src/lib.rs', 'src-tauri/gen/apple/project.yml', 'package.json', 'bun.lock']) expect(countsAsApp(path, 'loads-a-website')).toBe(true);
    for (const path of ['src/App.tsx', 'server/index.ts', 'index.html']) expect(countsAsApp(path, 'loads-a-website')).toBe(false);
  });

  test('one that packs its pages is every file but documentation, plans and tests', () => {
    expect(appKind(PAST_THE_BREAK['src-tauri/tauri.conf.json'])).toBe('packs-its-pages');
    expect(appKind('not json')).toBe('packs-its-pages');
    for (const path of ['src/app.ts', 'index.html', 'public/icon.png', 'vite.config.ts', 'src-tauri/src/lib.rs']) expect(countsAsApp(path, 'packs-its-pages')).toBe(true);
    for (const path of ['README.md', 'docs/a.txt', '.claude/plans/x.md', 'src/app.test.ts', 'test/x.ts', 'tests/y.ts', 'e2e/z.ts', 'src/e2e/w.ts']) {
      expect(countsAsApp(path, 'packs-its-pages')).toBe(false);
    }
  });

  test('a website-loading app whose landing changes only the website uploads nothing', () => {
    const head = { commit: 'b'.repeat(40), count: 12 };
    expect(decide({ newest: 10, newestCommit: 'a'.repeat(40), head, changed: ['src/App.tsx'], kind: 'loads-a-website' })).toEqual({
      upload: false,
      reason: 'skipped: no app files changed since build 10',
    });
    expect(decide({ newest: 10, newestCommit: 'a'.repeat(40), head, changed: ['src/App.tsx', 'src-tauri/Cargo.toml'], kind: 'loads-a-website' }).upload).toBe(true);
  });
});

test("an app's name is its repository's", () => {
  expect(appName('ssh://github.com/worktron/argon-watcher.git')).toBe('argon-watcher');
  expect(appName('github.com:worktron/argon-watcher.git')).toBe('argon-watcher');
  expect(appName('https://github.com/worktron/urge-surfer')).toBe('urge-surfer');
  expect(appName('file:///repos/urge-surfer/')).toBe('urge-surfer');
});

test("the commit for a build number is found on main's first-parent line by its count", async () => {
  const line = ['e', 'd', 'c', 'b', 'a'];
  const counts: Record<string, number> = { a: 1, b: 2, c: 5, d: 6, e: 9 };
  const count = async (c: string) => counts[c];
  expect(await commitForNumber(5, line, count)).toBe('c');
  expect(await commitForNumber(9, line, count)).toBe('e');
  expect(await commitForNumber(3, line, count)).toBeNull();
});
