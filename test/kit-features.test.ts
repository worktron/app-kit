// The kit's features an app should have (scripts/kit-features.ts), read from made-up apps laid out as the kit's apps
// are, each a scratch repository under node_modules/.cache as test/apps.test.ts makes them, with Apple's answers from
// recorded ones (test/fixtures/apple-app-site-association, ids replaced), never the network.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { FEATURES, featuresOf, landedAt, type AppleLookup } from '../scripts/kit-features.ts';
import { GIT_IDENTITY_ENV, pathWithGitItself } from './testflight-stand-in.ts';

const env = { ...process.env, PATH: pathWithGitItself(process.env.PATH), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY_ENV };
const kit = join(import.meta.dir, '..');
const recorded = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/apple-app-site-association', name), 'utf8');
/** Apple's answer for a site with the file, naming the recorded app, and for one with none (Apple answers 404, "Not Found"). */
const FOUND = { status: 200, body: recorded('found.json') };
const NOT_FOUND = { status: 404, body: recorded('not-found.txt') };
const SITE = 'app.example.com';
const ONE_TAP = 'one-tap iPhone sign-in configured';
let root: string;

beforeAll(() => {
  const cache = join(kit, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  root = mkdtempSync(join(cache, 'app-kit-features-'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${p.stderr}`);
  return p.stdout.toString();
};

/** A checkout holding these files, committed, read at HEAD. */
function app(name: string, files: Record<string, string>) {
  const dir = join(root, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=Worktron', '-c', 'user.email=kit@example.com', 'commit', '-q', '-m', 'App');
  return landedAt(dir, 'HEAD');
}

const appleAnswering =
  (answers: Record<string, Awaited<ReturnType<AppleLookup>>>): AppleLookup =>
  async (host) =>
    answers[host] ?? { failed: `no answer recorded for ${host}` };

const PAGE = `import { iphoneSignInForGate } from 'app-kit/tauri/iphone-sign-in';\nexport const iphoneSignIn = iphoneSignInForGate({ scheme: 'com.example.app', handBackOverHttps: true });\n`;
const PAGE_WITHOUT = `import { iphoneSignInForGate } from 'app-kit/tauri/iphone-sign-in';\nexport const iphoneSignIn = iphoneSignInForGate({ scheme: 'com.example.app' });\n`;
const CONF = JSON.stringify({ identifier: 'com.example.app' });
const ENTITLEMENTS = `<plist><dict><key>com.apple.developer.associated-domains</key><array><string>webcredentials:${SITE}</string></array></dict></plist>\n`;

test('an app laid out as Getter, with the page, the entitlement and the file Apple serves, has one-tap', async () => {
  const getter = app('getter', {
    'client/src/SignIn.tsx': PAGE,
    'src-tauri/tauri.conf.json': CONF,
    'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS,
  });
  expect(await featuresOf(getter, appleAnswering({ [SITE]: FOUND }))).toEqual({ lacks: [], unknown: [] });
});

test("an app laid out as Timescale, its shell, page and server in three folders, has one-tap", async () => {
  const timescale = app('timescale', {
    'client/src/SignInGate.tsx': PAGE,
    'server/src/app.ts': "app.get('/.well-known/apple-app-site-association', serveIt);\n",
    'desktop/src-tauri/tauri.conf.json': CONF,
    'desktop/src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS,
  });
  expect(await featuresOf(timescale, appleAnswering({ [SITE]: FOUND }))).toEqual({ lacks: [], unknown: [] });
});

test('an app laid out as Argon, taking iPhone sign-in with no one-tap, lacks it', async () => {
  const argon = app('argon', { 'src/main.tsx': PAGE_WITHOUT, 'src-tauri/tauri.conf.json': CONF, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': '<plist/>\n' });
  expect(await featuresOf(argon, appleAnswering({}))).toEqual({ lacks: [ONE_TAP], unknown: [] });
});

test('the option asked for only in a test, or with no entitlement for a site, is not one-tap', async () => {
  const inTest = app('in-test', {
    'src/main.tsx': PAGE_WITHOUT,
    'src/main.test.ts': 'expect(options).toEqual({ handBackOverHttps: true });\n',
    'src-tauri/tauri.conf.json': CONF,
    'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS,
  });
  expect((await featuresOf(inTest, appleAnswering({ [SITE]: FOUND }))).lacks).toEqual([ONE_TAP]);
  const noEntitlement = app('no-entitlement', { 'src/main.tsx': PAGE, 'src-tauri/tauri.conf.json': CONF });
  expect((await featuresOf(noEntitlement, appleAnswering({ [SITE]: FOUND }))).lacks).toEqual([ONE_TAP]);
});

test("a site Apple has no file for, or whose file names another app, is not one-tap", async () => {
  const files = { 'src/main.tsx': PAGE, 'src-tauri/tauri.conf.json': CONF, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS };
  expect((await featuresOf(app('no-file', files), appleAnswering({ [SITE]: NOT_FOUND }))).lacks).toEqual([ONE_TAP]);
  const other = app('other-app', { ...files, 'src-tauri/tauri.conf.json': JSON.stringify({ identifier: 'com.example.other' }) });
  expect((await featuresOf(other, appleAnswering({ [SITE]: FOUND }))).lacks).toEqual([ONE_TAP]);
});

test("Apple's copy unread says unknown, never lacking or had", async () => {
  const files = { 'src/main.tsx': PAGE, 'src-tauri/tauri.conf.json': CONF, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS };
  const unread = await featuresOf(app('unread', files), appleAnswering({}));
  expect(unread.lacks).toEqual([]);
  expect(unread.unknown).toEqual([`${ONE_TAP}: Apple's copy of ${SITE}'s association file could not be read: no answer recorded for ${SITE}`]);
  const refused = await featuresOf(app('refused', files), appleAnswering({ [SITE]: { status: 503, body: '' } }));
  expect(refused).toEqual({ lacks: [], unknown: [`${ONE_TAP}: Apple answered 503 for ${SITE}'s association file`] });
});

test("an entitlement naming the site in developer mode, or Apple's copy listing no apps, is not one-tap", async () => {
  const files = { 'src/main.tsx': PAGE, 'src-tauri/tauri.conf.json': CONF, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS.replace(SITE, `${SITE}?mode=developer`) };
  expect((await featuresOf(app('developer-mode', files), appleAnswering({ [SITE]: FOUND }))).lacks).toEqual([ONE_TAP]);
  const plain = { ...files, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': ENTITLEMENTS };
  const malformed = await featuresOf(app('malformed', plain), appleAnswering({ [SITE]: { status: 200, body: '{"webcredentials":{"apps":"ABCDE12345.com.example.app"}}' } }));
  expect(malformed).toEqual({ lacks: [], unknown: [`${ONE_TAP}: Apple's copy of ${SITE}'s association file lists no webcredentials apps`] });
});

test('an iPhone app laid out as Urge Surfer, taking no iPhone sign-in, is not asked for one-tap', async () => {
  const urgeSurfer = app('urge-surfer', { 'src/main.tsx': "import { followTextSize } from 'app-kit/web';\n", 'src-tauri/tauri.conf.json': CONF, 'src-tauri/gen/apple/app_iOS/app_iOS.entitlements': '<plist/>\n' });
  expect(await featuresOf(urgeSurfer, appleAnswering({}))).toEqual({ lacks: [], unknown: [] });
});

test("every feature names a README heading and only names the kit still has, so a rename fails here", () => {
  const readme = readFileSync(join(kit, 'README.md'), 'utf8');
  const exports = (JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8')) as { exports: Record<string, string> }).exports;
  const features = FEATURES.map((entry) => entry.feature);
  expect(new Set(features).size).toBe(features.length);
  for (const entry of FEATURES) {
    expect(readme).toMatch(new RegExp(`^#+ ${entry.readme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    for (const name of entry.names) {
      if (name.startsWith('app-kit/')) expect(Object.keys(exports)).toContain(`./${name.slice('app-kit/'.length)}`);
      // The kit's own code, outside this list and the tests that read it.
      else expect(git(kit, 'grep', '-l', '-w', name, '--', ':(exclude)scripts/**', ':(exclude)test/**').trim()).not.toBe('');
    }
  }
});
