// `app-kit mac release`: only landed code, the signing identity, the releases repository, the numbering, the key from
// 1Password reaching only the build, the update's signature, and what is published, against stand-ins for every
// program but git (test/mac-release-stand-in.ts), in a real checkout of an origin reached over file://.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assetName, nextVersion, releasesRepository, signedVersion } from '../tauri/mac-release/app.ts';
import { release, type ReleaseOptions } from '../tauri/mac-release/release.ts';
import {
  IDENTITY,
  keyItemJson,
  landElsewhere,
  macApp,
  macRunner,
  PRIVATE_KEY,
  REPOSITORY,
  releaseNotFound,
  signatureFile,
  tauriConfig,
  type MacWorld,
} from './mac-release-stand-in.ts';
import { commit, exit, git, ok, scratch } from './testflight-stand-in.ts';

// Each test runs real git a dozen times, so it is held to the fifteen seconds a test may take, not Bun's five.
setDefaultTimeout(15_000);

let place: ReturnType<typeof scratch>;

beforeEach(() => {
  place = scratch('mac-release-');
});

afterEach(() => {
  place.done();
});

const DATE = new Date('2026-11-05T12:00:00.000Z');

async function runRelease(app: string, world: MacWorld = {}, overrides: Partial<ReleaseOptions> = {}) {
  const stand = macRunner(app, world);
  const printed: string[] = [];
  const failed: string[] = [];
  const code = await release({
    cwd: app,
    run: stand.run,
    env: { PATH: '/usr/bin:/bin', HOME: place.folder, APPLE_SIGNING_IDENTITY: 'Another Identity', CARGO_TARGET_DIR: '/elsewhere/target', GH_TOKEN: 'a gh token' },
    arch: 'arm64',
    now: () => DATE,
    print: (line) => printed.push(line),
    fail: (line) => failed.push(line),
    output: () => {},
    ...overrides,
  });
  return { code, printed, failed, ...stand };
}

test('a landed app is built with the key in its environment alone and published as the next release', async () => {
  const { checkout, app } = macApp(place.folder);
  const head = git(checkout, 'rev-parse', 'HEAD');
  const result = await runRelease(app);
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);

  const [build] = result.named('tauri build');
  expect(build!.command).toEqual(['bunx', 'tauri', 'build', '--bundles', 'app', '--config', '{"version":"0.1.9","bundle":{"createUpdaterArtifacts":true}}']);
  expect(build!.options.env?.TAURI_SIGNING_PRIVATE_KEY).toBe(PRIVATE_KEY);
  expect(build!.options.env?.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('');
  expect(build!.options.env?.APP_COMMIT).toBe(head.slice(0, 7));
  // The config's identity signs, never one the shell holds.
  expect(build!.options.env?.APPLE_SIGNING_IDENTITY).toBeUndefined();
  // The bundle lands in the app's own src-tauri/target, where the release looks for it.
  expect(build!.options.env?.CARGO_TARGET_DIR).toBeUndefined();
  for (const call of result.calls.filter((call) => call !== build)) {
    expect(call.command.join(' ')).not.toContain(PRIVATE_KEY);
    expect(Object.values(call.options.env ?? {})).not.toContain(PRIVATE_KEY);
  }

  expect(result.published).toHaveLength(1);
  const [{ command, files }] = result.published as [(typeof result.published)[number]];
  expect(command.slice(0, 9)).toEqual(['gh', 'release', 'create', 'v0.1.9', '--repo', REPOSITORY, '--latest', '--title', 'Example App for Mac 0.1.9']);
  expect(Object.keys(files)).toEqual(['Example.App.app.tar.gz', 'Example.App.app.tar.gz.sig', 'latest.json']);
  expect(files['Example.App.app.tar.gz']).toBe('the archive');
  // latest.json is the shape the window plugin's own test serves to Tauri's updater.
  const fixture = readFileSync(join(import.meta.dir, 'fixtures/mac-release/latest.json'), 'utf8');
  const expected = fixture
    .replace('{version}', '0.1.9')
    .replace('{pub_date}', '2026-11-05T12:00:00Z')
    .replace('{signature}', signatureFile('0.1.9'))
    .replace('{url}', `https://github.com/${REPOSITORY}/releases/download/v0.1.9/Example.App.app.tar.gz`);
  expect(JSON.parse(files['latest.json']!)).toEqual(JSON.parse(expected));
  // The folder the files went up from is gone.
  const folder = command[command.length - 1]!.split('/').slice(0, -1).join('/');
  expect(existsSync(folder)).toBe(false);
  expect(result.printed.at(-2)).toBe(`published Example App 0.1.9: https://github.com/${REPOSITORY}/releases/tag/v0.1.9`);
});

test('the version is one past the higher of the last release and the config', async () => {
  expect(nextVersion('v0.1.8', '0.1.0')).toBe('0.1.9');
  expect(nextVersion(null, '0.1.0')).toBe('0.1.1');
  expect(nextVersion('v0.1.8', '0.2.0')).toBe('0.2.1');
  expect(nextVersion('v1.0.3', '0.9.9')).toBe('1.0.4');
  expect(nextVersion('v0.1.10', '0.1.9')).toBe('0.1.11');

  const { app } = macApp(place.folder);
  const first = await runRelease(app, { lastRelease: releaseNotFound });
  expect(first.code).toBe(0);
  expect(first.named('release create')[0]!.command[3]).toBe('v0.1.1');
});

test('a failure to read the last release stops before the key is read, rather than numbering from the start', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, { lastRelease: exit(1, 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n') });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual([`gh could not read ${REPOSITORY}'s last release: HTTP 502: Bad Gateway (https://api.github.com/graphql)`]);
  expect(result.named('op')).toEqual([]);
});

test('only landed code is released: uncommitted, unpushed and behind main are each refused before anything else', async () => {
  const { origin, checkout, app } = macApp(place.folder);
  writeFileSync(join(app, 'src-tauri/extra.rs'), 'fn main() {}\n');
  const dirty = await runRelease(app);
  expect(dirty.failed).toEqual(['the checkout has uncommitted changes; a release builds only landed code']);

  git(checkout, 'checkout', '-q', '-b', 'feature');
  commit(checkout, { 'src-tauri/extra.rs': 'fn main() {}\n' });
  const unpushed = await runRelease(app);
  expect(unpushed.failed[0]).toMatch(/^HEAD \([0-9a-f]{7}\) is not on origin\/main/);

  git(checkout, 'checkout', '-q', 'main');
  landElsewhere(origin, place.folder, 'src-tauri/changed.rs');
  const behind = await runRelease(app);
  expect(behind.failed).toEqual(['the folder differs from origin/main; a release builds only landed code, so pull main first']);
  for (const refused of [dirty, unpushed, behind]) {
    expect(refused.code).toBe(1);
    expect(refused.named('gh')).toEqual([]);
  }

  const intel = await runRelease(app, {}, { arch: 'x64' });
  expect(intel.failed).toEqual(['releases are built for Apple silicon only, and this Mac is x64']);
});

test('an app in a subfolder releases while the rest of its repository moves on', async () => {
  const { origin, checkout, app } = macApp(place.folder, { folder: 'desktop' });
  landElsewhere(origin, place.folder, 'server/index.ts');
  // Main moved outside desktop/, and the checkout has not pulled it.
  git(checkout, 'fetch', '-q', 'origin');
  const result = await runRelease(app);
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);
  expect(result.named('tauri build')[0]!.options.cwd).toBe(app);

  // An uncommitted change outside the app's folder is refused too, since the build may read it.
  writeFileSync(join(checkout, 'notes.md'), 'unlanded\n');
  const dirty = await runRelease(app);
  expect(dirty.failed).toEqual(['the checkout has uncommitted changes; a release builds only landed code']);
});

test('a failed upload names the draft it may have left, so the next release can take its version', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, { publish: () => exit(1, 'HTTP 502: Bad Gateway (https://uploads.github.com/)\n') });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual([
    `gh could not publish v0.1.9 in ${REPOSITORY}: HTTP 502: Bad Gateway (https://uploads.github.com/); if it left a draft at https://github.com/${REPOSITORY}/releases, delete it, then release again`,
  ]);
});

test('a checkout changed during the build is not published', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, { duringBuild: () => writeFileSync(join(app, 'src-tauri/late.rs'), 'fn late() {}\n') });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual([
    'the checkout changed during the build, so it may hold code that never landed: the checkout has uncommitted changes; a release builds only landed code; release again',
  ]);
  expect(result.published).toEqual([]);
});

test('a releases repository installed copies cannot read, or gh cannot write to, is refused before the key is read', async () => {
  const { app } = macApp(place.folder);
  const cases: [string, string][] = [
    ['{"isEmpty":false,"viewerPermission":"ADMIN","visibility":"PRIVATE"}', `${REPOSITORY} is private, so installed copies could not read its releases: make it public`],
    ['{"isEmpty":true,"viewerPermission":"ADMIN","visibility":"PUBLIC"}', `${REPOSITORY} is empty, and gh cannot make a release in an empty repository: add a README to it`],
    ['{"isEmpty":false,"viewerPermission":"READ","visibility":"PUBLIC"}', `gh's account may not write to ${REPOSITORY} (its permission is READ): sign gh in to an account that can`],
  ];
  for (const [answer, why] of cases) {
    const result = await runRelease(app, { repo: ok(answer) });
    expect(result.failed).toEqual([why]);
    expect(result.named('op')).toEqual([]);
  }
  const unseen = await runRelease(app, { repo: exit(1, "GraphQL: Could not resolve to a Repository with the name 'example/example-releases'. (repository)\n") });
  expect(unseen.failed[0]).toStartWith(`gh could not see ${REPOSITORY}: GraphQL: Could not resolve`);
});

test('an app with no signing identity, one this Mac lacks, or a build signed by another is refused', async () => {
  const none = macApp(join(place.folder, 'none'), { config: tauriConfig((config) => delete config.bundle.macOS) });
  const noIdentity = await runRelease(none.app);
  expect(noIdentity.failed[0]).toStartWith('src-tauri/tauri.conf.json names no bundle.macOS.signingIdentity');
  const adHoc = macApp(join(place.folder, 'ad-hoc'), { config: tauriConfig((config) => (config.bundle.macOS.signingIdentity = '-')) });
  expect((await runRelease(adHoc.app)).failed[0]).toStartWith('src-tauri/tauri.conf.json names no bundle.macOS.signingIdentity');

  const { app } = macApp(join(place.folder, 'app'));
  const untrusted = await runRelease(app);
  expect(untrusted.named('security')[0]!.command).toEqual(['security', 'find-identity', '-p', 'codesigning']);
  expect(untrusted.code).toBe(0);
  const missing = await runRelease(app, { identities: 'Policy: Code Signing\n  Matching identities\n     0 identities found\n' });
  expect(missing.failed[0]).toStartWith(`this Mac's keychain has no code signing identity "${IDENTITY}"`);
  const other = await runRelease(app, { signedBy: 'Another Identity' });
  expect(other.failed[0]).toStartWith(`${join(app, 'src-tauri/target/release/bundle/macos/Example App.app')} is not signed by "${IDENTITY}"`);
  expect(other.published).toEqual([]);
});

test('a key that is not the config’s, a missing key, or a signature naming no version is refused', async () => {
  const { app } = macApp(place.folder);
  const mismatch = await runRelease(app, { item: ok(keyItemJson({ publicKey: 'another public key' })) });
  expect(mismatch.failed).toEqual([
    `the public key in "Example App update signing key" is not tauri.conf.json's plugins.updater.pubkey, so every installed copy would refuse this release`,
  ]);
  expect(mismatch.named('tauri build')).toEqual([]);

  const absent = await runRelease(app, { item: exit(1, `[ERROR] 2026/11/05 12:00:00 "Example App update signing key" isn't an item in the "Personal" vault. Specify the item with its UUID, name, or domain.\n`) });
  expect(absent.failed).toEqual([`1Password's Personal vault has no "Example App update signing key": make it once with app-kit mac key`]);

  const unversioned = await runRelease(app, { signedVersion: null });
  expect(unversioned.failed[0]).toStartWith("the update's signature names version none, not 0.1.9");
  expect(unversioned.published).toEqual([]);

  const withPassword = await runRelease(app, { item: ok(keyItemJson({ password: 'its password' })) });
  expect(withPassword.named('tauri build')[0]!.options.env?.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('its password');
});

test('an endpoint that is not a GitHub release, or a config without the updater, is refused naming the fix', async () => {
  const other = macApp(join(place.folder, 'other'), {
    config: tauriConfig((config) => (config.plugins.updater.endpoints = ['https://updates.example.com/latest.json'])),
  });
  expect((await runRelease(other.app)).failed[0]).toStartWith("plugins.updater's endpoint https://updates.example.com/latest.json is not https://github.com/");
  const bare = macApp(join(place.folder, 'bare'), { config: tauriConfig((config) => delete config.plugins) });
  expect((await runRelease(bare.app)).failed[0]).toStartWith('src-tauri/tauri.conf.json has no plugins.updater with a pubkey and an endpoint');
});

test('the archive is published under a name GitHub keeps, and the repository comes from the endpoint', () => {
  expect(assetName('Example App')).toBe('Example.App.app.tar.gz');
  expect(assetName('Past the Break')).toBe('Past.the.Break.app.tar.gz');
  expect(assetName('  Odd  name. ')).toBe('Odd.name.app.tar.gz');
  expect(assetName('Timescale')).toBe('Timescale.app.tar.gz');
  expect(releasesRepository('https://github.com/worktron/timescale-releases/releases/latest/download/latest.json')).toBe('worktron/timescale-releases');
  expect(releasesRepository('https://github.com/worktron/timescale-releases/releases/download/v1/latest.json')).toBeNull();
  expect(signedVersion(signatureFile('1.2.3'))).toBe('1.2.3');
  expect(signedVersion(signatureFile(null))).toBeNull();
});

test('a release stopped by a signal while publishing removes the folder its files went up from', async () => {
  const { app } = macApp(place.folder);
  const child = Bun.spawn(['bun', join(import.meta.dir, 'mac-release-child.ts'), app], { stdout: 'pipe', stderr: 'pipe' });
  const reader = child.stdout.getReader();
  let said = '';
  while (!said.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    said += new TextDecoder().decode(value);
  }
  const folder = said.trim();
  expect(folder).toMatch(/app-kit-mac-release-/);
  expect(existsSync(folder)).toBe(true);
  child.kill('SIGTERM');
  expect(await child.exited).toBe(1);
  expect(existsSync(folder)).toBe(false);
});
