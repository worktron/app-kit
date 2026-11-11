// `app-kit mac release`: only landed code, the signing identity, the releases repository, the numbering, the key from
// 1Password reaching only the build, the update's signature, what is published, and a Developer ID build's notarizing,
// against stand-ins for every program but git and tar (test/mac-release-stand-in.ts), in a real checkout of an origin
// reached over file://.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetName, nextVersion, releasesRepository, signedVersion } from '../tauri/mac-release/app.ts';
import { identityName, NOTARY_KEY_FOLDER, release, type ReleaseOptions } from '../tauri/mac-release/release.ts';
import { USERS } from '../tauri/mac-release/build-paths.ts';
import {
  DEVELOPER_ID_IDENTITIES,
  DEVELOPER_ID_NAME,
  FINGERPRINT,
  IDENTITY,
  NOTARY_PRIVATE_KEY,
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
import { commit, exit, git, GIT_IDENTITY_ENV, ok, pathWithGitItself, scratch } from './testflight-stand-in.ts';

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

/**
 * The shell a release runs from in these tests, with git itself first on its path and an identity for git to write refs
 * as: the release fetches, which writes a ref, under a home folder with none (testflight-stand-in.ts says why each).
 */
const releaseEnv = (shell: Record<string, string>) => ({ ...shell, ...GIT_IDENTITY_ENV, PATH: pathWithGitItself(shell.PATH) });

async function runRelease(app: string, world: MacWorld = {}, overrides: Partial<ReleaseOptions> = {}) {
  const stand = macRunner(app, world);
  const printed: string[] = [];
  const failed: string[] = [];
  const code = await release({
    cwd: app,
    run: stand.run,
    env: releaseEnv({ PATH: '/usr/bin:/bin', HOME: place.folder, APPLE_SIGNING_IDENTITY: 'Another Identity', CARGO_TARGET_DIR: '/elsewhere/target', GH_TOKEN: 'a gh token' }),
    arch: 'arm64',
    now: () => DATE,
    print: (line) => printed.push(line),
    fail: (line) => failed.push(line),
    output: () => {},
    ...overrides,
  });
  return { code, printed, failed, ...stand };
}

test("the release's git in these tests has an identity and is git itself, so its fetch never looks up the machine's name", () => {
  const env = releaseEnv({ PATH: '/usr/bin:/bin', HOME: place.folder });
  const ident = Bun.spawnSync(['git', 'var', 'GIT_COMMITTER_IDENT'], { cwd: '/', env, stdout: 'pipe', stderr: 'pipe' });
  expect(ident.stdout.toString()).toStartWith('app <app@example.com> ');
  const xcode = process.platform === 'darwin' && Bun.spawnSync(['xcode-select', '-p'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  if (xcode) expect(Bun.which('git', { PATH: env.PATH })).not.toBe('/usr/bin/git');
});

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
  expect(files['Example.App.app.tar.gz']).toBe(readFileSync(join(app, 'src-tauri/target/release/bundle/macos/Example App.app.tar.gz'), 'utf8'));
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

  const absent = await runRelease(app, { item: exit(1, `[ERROR] 2026/11/05 12:00:00 "Example App update signing key" isn't an item in the "TestFlight" vault. Specify the item with its UUID, name, or domain.\n`) });
  expect(absent.failed).toEqual([
    `1Password's TestFlight vault has no "Example App update signing key". If it is still in the Personal vault, move it: op item move "Example App update signing key" --current-vault Personal --destination-vault TestFlight. Make a key with app-kit mac key only for an app that has never released, since a new key strands every installed copy`,
  ]);

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

/** An app signed by the Developer ID certificate, named in its config by its fingerprint, in `case`. */
function developerIdApp(name: string, fingerprint = FINGERPRINT) {
  return macApp(join(place.folder, name), { config: tauriConfig((config) => (config.bundle.macOS.signingIdentity = fingerprint)) });
}
const DEVELOPER_ID: MacWorld = { identities: DEVELOPER_ID_IDENTITIES };

test('a Developer ID app is built with the App Store Connect key in its build alone, from a private file removed afterwards', async () => {
  const { app } = developerIdApp('app');
  const result = await runRelease(app, DEVELOPER_ID);
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);

  const read = result.named('op').find((call) => call.command.includes('App Store Connect API'));
  expect(read!.command).toEqual(['op', 'item', 'get', 'App Store Connect API', '--vault', 'TestFlight', '--format', 'json']);
  const [build] = result.named('tauri build');
  expect(build!.options.env?.APPLE_API_KEY).toBe('KEY0000001');
  expect(build!.options.env?.APPLE_API_ISSUER).toBe('00000000-0000-0000-0000-000000000001');
  const keyPath = build!.options.env?.APPLE_API_KEY_PATH;
  expect(keyPath).toStartWith(join(tmpdir(), `${NOTARY_KEY_FOLDER}${process.pid}-`));
  expect(result.keyAtBuild).toEqual([{ path: keyPath!, text: `${NOTARY_PRIVATE_KEY}\n`, mode: 0o600, folderMode: 0o700 }]);
  expect(existsSync(keyPath!)).toBe(false);
  for (const call of result.calls.filter((call) => call !== build)) {
    expect(call.command.join(' ')).not.toContain(NOTARY_PRIVATE_KEY);
    expect(Object.keys(call.options.env ?? {}).filter((name) => name.startsWith('APPLE_API_'))).toEqual([]);
  }

  // The checks run on the archive that goes up, unpacked beside it.
  const [{ command }] = result.published as [(typeof result.published)[number]];
  const folder = command[command.length - 1]!.split('/').slice(0, -1).join('/');
  const inside = join(folder, 'unpacked', 'Example App.app');
  expect(result.named('stapler validate')[0]!.command).toEqual(['xcrun', 'stapler', 'validate', inside]);
  expect(result.named('spctl')[0]!.command).toEqual(['spctl', '-a', '-t', 'exec', '-vv', inside]);
  // The certificate's name, which holds a person's, is never printed.
  for (const line of [...result.printed, ...result.failed]) expect(line).not.toContain('Example Person');
});

test('a Developer ID archive whose app is not stapled, or that Gatekeeper does not call notarized, is not published', async () => {
  const { app } = developerIdApp('app');
  // Tauri ignores a failed staple and only warns when it was given no key, so only these checks stop such a build.
  const unstapled = await runRelease(app, { ...DEVELOPER_ID, stapled: false });
  expect(unstapled.code).toBe(1);
  expect(unstapled.failed[0]).toStartWith('the app in the update archive has no notarization ticket stapled to it');
  expect(unstapled.published).toEqual([]);

  const unsigned = await runRelease(app, { ...DEVELOPER_ID, gatekeeper: exit(3, 'Example App.app: rejected\nsource=Unnotarized Developer ID\n') });
  expect(unsigned.failed[0]).toBe('Gatekeeper does not call the app in the update archive notarized: source=Unnotarized Developer ID');
  expect(unsigned.published).toEqual([]);
});

test('the key’s file is removed when the build fails', async () => {
  const { app } = developerIdApp('app');
  const result = await runRelease(app, { ...DEVELOPER_ID, buildFails: true });
  expect(result.code).toBe(3);
  expect(result.keyAtBuild).toHaveLength(1);
  expect(existsSync(result.keyAtBuild[0]!.path)).toBe(false);
});

test('the key’s file is removed when the release is stopped by a signal during the build', async () => {
  const { app } = developerIdApp('app');
  const child = Bun.spawn(['bun', join(import.meta.dir, 'mac-release-child.ts'), app, 'notarize'], { stdout: 'pipe', stderr: 'pipe' });
  const reader = child.stdout.getReader();
  let said = '';
  while (!said.includes('\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    said += new TextDecoder().decode(value);
  }
  const folder = said.trim();
  expect(folder).toContain(NOTARY_KEY_FOLDER);
  expect(existsSync(join(folder, 'key.p8'))).toBe(true);
  child.kill('SIGINT');
  expect(await child.exited).toBe(1);
  expect(existsSync(folder)).toBe(false);
});

test('a key folder left by a release that is no longer running is removed, and a running release’s, or one holding anything else, is left', async () => {
  const ended = Bun.spawnSync(['true']).pid;
  const left = join(tmpdir(), `${NOTARY_KEY_FOLDER}${ended}-left`);
  const live = join(tmpdir(), `${NOTARY_KEY_FOLDER}${process.pid}-live`);
  const other = join(tmpdir(), `${NOTARY_KEY_FOLDER}${ended}-other`);
  for (const folder of [left, live, other]) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'key.p8'), 'a key');
  }
  writeFileSync(join(other, 'notes.txt'), 'not a release’s');
  try {
    const { app } = developerIdApp('app');
    expect((await runRelease(app, DEVELOPER_ID)).code).toBe(0);
    expect(existsSync(left)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(join(other, 'notes.txt'))).toBe(true);
  } finally {
    for (const folder of [left, live, other]) rmSync(folder, { recursive: true, force: true });
  }
});

test('a fingerprint identity is found once though listed twice, in either case, refused when not in the keychain, and its build must be signed by that certificate', async () => {
  expect(identityName(DEVELOPER_ID_IDENTITIES, FINGERPRINT)).toBe(DEVELOPER_ID_NAME);
  expect(identityName(DEVELOPER_ID_IDENTITIES, FINGERPRINT.toLowerCase())).toBe(DEVELOPER_ID_NAME);
  expect(identityName(DEVELOPER_ID_IDENTITIES, IDENTITY)).toBe(IDENTITY);
  expect(identityName(DEVELOPER_ID_IDENTITIES, '0'.repeat(40))).toBeNull();

  const lower = developerIdApp('lower', FINGERPRINT.toLowerCase());
  expect((await runRelease(lower.app, DEVELOPER_ID)).code).toBe(0);

  const { app } = developerIdApp('app');
  const missing = await runRelease(app);
  expect(missing.failed[0]).toStartWith(`this Mac's keychain has no code signing identity "${FINGERPRINT}"`);

  const other = await runRelease(app, { ...DEVELOPER_ID, certificate: 'another certificate' });
  expect(other.failed[0]).toStartWith(`${join(app, 'src-tauri/target/release/bundle/macos/Example App.app')} is not signed by the certificate ${FINGERPRINT}: its signer's is `);
  expect(other.published).toEqual([]);
});

test('Apple sign-in and certificate settings in the shell never reach the build', async () => {
  const { app } = macApp(place.folder);
  const shell = { APPLE_ID: 'someone@example.com', APPLE_PASSWORD: 'p', APPLE_TEAM_ID: 'TEAM000001', APPLE_CERTIFICATE: 'c', APPLE_CERTIFICATE_PASSWORD: 'p', APPLE_API_KEY: 'k' };
  const result = await runRelease(app, {}, { env: releaseEnv({ PATH: '/usr/bin:/bin', HOME: place.folder, ...shell }) });
  expect(result.code).toBe(0);
  const env = result.named('tauri build')[0]!.options.env ?? {};
  for (const name of Object.keys(shell)) expect(env[name]).toBeUndefined();
});

test('a self-signed app reads no App Store Connect key and runs no notarization check', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app);
  expect(result.code).toBe(0);
  expect(result.named('op').filter((call) => call.command.includes('App Store Connect API'))).toEqual([]);
  expect(result.named('op')).toHaveLength(1);
  expect(result.named('stapler')).toEqual([]);
  expect(result.named('spctl')).toEqual([]);
  // The archive is still unpacked once, for the search for this Mac's folder paths.
  expect(result.named('tar')).toHaveLength(1);
  expect(result.keyAtBuild).toEqual([]);
});

test('the update key is read from the TestFlight vault through the keychain token, and the notes name the full commit', async () => {
  const { checkout, app } = macApp(place.folder);
  const head = git(checkout, 'rev-parse', 'HEAD');
  const result = await runRelease(app, { token: 'ops_stand-in-token' }, { tokenOnly: true });
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);
  const [read] = result.named('op item get');
  expect(read!.command).toEqual(['op', 'item', 'get', 'Example App update signing key', '--vault', 'TestFlight', '--format', 'json']);
  expect(read!.options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBe('ops_stand-in-token');
  // The token reaches only op, never the build.
  expect(result.named('tauri build')[0]!.options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
  const create = result.published[0]!.command;
  expect(create[create.indexOf('--notes') + 1]).toBe(`Example App for Mac 0.1.9, built from ${head.slice(0, 7)} (${head}).`);
});

test('a token-only release on a Mac without the token reads nothing and says what is missing', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, {}, { tokenOnly: true });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual([
    `the login keychain has no "app-kit testflight" item, the 1Password token a release with nobody there reads the keys through (app-kit's README, "TestFlight")`,
  ]);
  expect(result.named('op')).toEqual([]);
  expect(result.named('tauri build')).toEqual([]);
});

test('a build that compiled but failed, as a notarization can, exits 1 so the watcher tries again, not 3', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, { build: () => exit(1, 'failed to notarize app: The operation timed out.\n') });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual(['the build of 0.1.9 failed: failed to notarize app: The operation timed out.']);
  const compile = await runRelease(app, { buildFails: true });
  expect(compile.code).toBe(3);
  expect(compile.failed).toEqual(['the build of 0.1.9 did not compile: error: could not compile `example`']);
});

// This Mac's folder paths: the build rewrites them and the release refuses a build that still holds one
// (tauri/mac-release/build-paths.ts). The home folder in these tests is the test's own, outside the folder macOS keeps them in; a made-up one in it is
// written from USERS, since no file here may name one (test/public.test.ts).

const PROGRAM = 'MacOS/example';
const SOMEONE = `${USERS}someone`;

test("the build rewrites the home folder and then the checkout, in rules a name with a space cannot break, and the shell's Rust flags never reach it", async () => {
  const { checkout, app } = macApp(place.folder, { folder: 'desktop' });
  const shell = { PATH: '/usr/bin:/bin', HOME: place.folder, RUSTFLAGS: '-C debuginfo=2', CARGO_ENCODED_RUSTFLAGS: '-g', CARGO_BUILD_RUSTFLAGS: '-g', CFLAGS: '-O2' };
  const result = await runRelease(app, {}, { env: releaseEnv(shell) });
  expect(result.failed).toEqual([]);
  expect(result.code).toBe(0);
  const env = result.named('tauri build')[0]!.options.env ?? {};
  const top = git(checkout, 'rev-parse', '--show-toplevel');
  // The product name, Example App, has a space, and appears in no rule: Cargo splits this variable on spaces.
  expect(env.CARGO_BUILD_RUSTFLAGS).toBe(`--remap-path-prefix=${place.folder}=~ --remap-path-prefix=${top}=app`);
  expect(env.CFLAGS).toBe(`-O2 -ffile-prefix-map=${place.folder}=~ -ffile-prefix-map=${top}=app`);
  expect(env.CXXFLAGS).toBe(`-ffile-prefix-map=${place.folder}=~ -ffile-prefix-map=${top}=app`);
  expect(env.RUSTFLAGS).toBeUndefined();
  expect(env.CARGO_ENCODED_RUSTFLAGS).toBeUndefined();
  expect(result.printed).toContain("the update archive's app holds none of this Mac's folder paths");
});

test('a Cargo home outside the home folder is rewritten too, before the checkout', async () => {
  const { checkout, app } = macApp(place.folder);
  const cargoHome = join(place.folder, '..', 'cargo-home');
  const result = await runRelease(app, {}, { env: releaseEnv({ PATH: '/usr/bin:/bin', HOME: place.folder, CARGO_HOME: cargoHome }) });
  expect(result.code).toBe(0);
  const top = git(checkout, 'rev-parse', '--show-toplevel');
  expect(result.named('tauri build')[0]!.options.env?.CARGO_BUILD_RUSTFLAGS).toBe(
    `--remap-path-prefix=${place.folder}=~ --remap-path-prefix=${cargoHome}=cargo --remap-path-prefix=${top}=app`,
  );
});

test('a home folder with a space in its name is refused before anything is built, since its paths could not be rewritten', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, {}, { env: releaseEnv({ PATH: '/usr/bin:/bin', HOME: `${USERS}some one` }) });
  expect(result.code).toBe(1);
  expect(result.failed).toEqual([
    `the home folder ${USERS}some one has a space in its name, which Rust's path rewriting cannot take, so the release would publish it: release from a folder without one`,
  ]);
  expect(result.named('op')).toEqual([]);
  expect(result.named('tauri build')).toEqual([]);
});

test("a program holding a path under /Users/ in Rust's packed messages is refused before anything is published, naming only the path", async () => {
  const { app } = macApp(place.folder);
  const program = 'called `Option::unwrap()` on a `None` valueassertion failed: x' + SOMEONE + '/.cargo/registry/src/index.crates.io-0000/tao-0.37.2/src/window.rsLocked shared state';
  const result = await runRelease(app, { appFiles: { [PROGRAM]: program } });
  expect(result.code).toBe(4);
  expect(result.failed).toHaveLength(1);
  expect(result.failed[0]).toStartWith(
    `the build holds 1 path of this Mac's home folder, which a public release would publish: ${SOMEONE}/.cargo/registry/src/index.crates.io-0000/tao-0.37.2/src/window.rsLocked in Example App.app/Contents/MacOS/example. `,
  );
  expect(result.published).toEqual([]);
  expect(result.named('gh release create')).toEqual([]);
});

test('paths between NUL bytes, as an object file entry in a symbol table, are found byte for byte, and at most five are named', async () => {
  const { app } = macApp(place.folder);
  const paths = Array.from({ length: 7 }, (_, n) => `${SOMEONE}/app/target/release/deps/part${n}.o`);
  const program = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), ...paths.map((path) => Buffer.from(`\0${path}\0`))]);
  const result = await runRelease(app, { appFiles: { [PROGRAM]: program } });
  expect(result.code).toBe(4);
  expect(result.failed[0]).toStartWith(
    `the build holds 7 paths of this Mac's home folder, which a public release would publish: ${paths
      .slice(0, 5)
      .map((path) => `${path} in Example App.app/Contents/MacOS/example`)
      .join('; ')}. `,
  );
});

test('the home folder is found where it is not under /Users/, and in any file of the app', async () => {
  const { app } = macApp(place.folder);
  const result = await runRelease(app, { appFiles: { 'Resources/notes.txt': `built in ${place.folder}/Workspace/example` } });
  expect(result.code).toBe(4);
  expect(result.failed[0]).toStartWith(
    `the build holds 1 path of this Mac's home folder, which a public release would publish: ${place.folder}/Workspace/example in Example App.app/Contents/Resources/notes.txt. `,
  );
});

test('a checkout or Cargo home outside the home folder is searched for too, since a library can keep a path no rewrite reaches', async () => {
  // The checkout is in the test's folder, and the home folder a made-up one beside it.
  const { checkout, app } = macApp(place.folder);
  const shell = (more: Record<string, string> = {}) => ({ env: releaseEnv({ PATH: '/usr/bin:/bin', HOME: join(place.folder, 'home'), ...more }) });
  const top = git(checkout, 'rev-parse', '--show-toplevel');
  const kept = await runRelease(app, { appFiles: { [PROGRAM]: `built in ${top}/src-tauri` } }, shell());
  expect(kept.code).toBe(4);
  expect(kept.failed[0]).toContain(`: ${top}/src-tauri in Example App.app/Contents/MacOS/example. `);
  const cargoHome = join(place.folder, 'cargo-home');
  const registry = await runRelease(app, { appFiles: { [PROGRAM]: `${cargoHome}/registry/src/x.rs` } }, shell({ CARGO_HOME: cargoHome }));
  expect(registry.code).toBe(4);
  expect(registry.failed[0]).toContain(`: ${cargoHome}/registry/src/x.rs in Example App.app/Contents/MacOS/example. `);
});

test('the bundled page folder, which Tauri compresses into the program, is searched as it is on disk', async () => {
  const config = tauriConfig((config) => {
    config.build = { frontendDist: '../dist' };
  });
  const { app } = macApp(place.folder, { config, files: { 'dist/index.html': `<script src="${SOMEONE}/app/src/main.ts"></script>` } });
  const result = await runRelease(app);
  expect(result.code).toBe(4);
  expect(result.failed[0]).toStartWith(
    `the build holds 1 path of this Mac's home folder, which a public release would publish: ${SOMEONE}/app/src/main.ts in frontendDist ../dist/index.html. `,
  );
  // A page served from an address is not a folder to search.
  const served = macApp(join(place.folder, 'served'), { config: tauriConfig((config) => (config.build = { frontendDist: 'https://app.example.com' })) });
  expect((await runRelease(served.app)).code).toBe(0);
});

test("a Developer ID build holding a path is refused before its notarization is checked, and the refusal names each cause the rewrite cannot reach", async () => {
  const { app } = developerIdApp('app');
  const result = await runRelease(app, { ...DEVELOPER_ID, appFiles: { [PROGRAM]: `${SOMEONE}/x.rs` } });
  expect(result.code).toBe(4);
  expect(result.named('stapler')).toEqual([]);
  expect(result.failed[0]).toContain('target rustflags');
  expect(result.failed[0]).toContain('[profile.release]');
  expect(result.failed[0]).toContain('CARGO_MANIFEST_DIR');
});
