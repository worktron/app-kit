// `app-kit testflight upload`: the checks before a build, the build's environment, the checks on the built app, the
// upload with the key in a folder of its own, and the wait for Apple's processing, against stand-ins for Tauri, altool,
// codesign, the keychain, 1Password and App Store Connect, in a real git repository reached over file://.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { runCommand } from '../command-line/run.ts';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  alreadyUploaded,
  buildEnv,
  compileFailed,
  ICON_SET,
  ipaProblems,
  pngOpacities,
  restoreValue,
  upload,
  type UploadOptions,
} from '../tauri/testflight/upload.ts';
import { extensionSigningSettings, profileGroups, projectToPutBack, withBuildSettings, writeSecurityRecorder, writeXcodebuildStandIn } from '../tauri/testflight/signing.ts';
import {
  apple as appleFor,
  ENTITLEMENTS_DEVELOPMENT,
  ENTITLEMENTS_PUSH,
  GROUP,
  groupEntitlements,
  INFO,
  plist,
  png,
  rgb,
  rgba,
  SHARE_ID,
  signedProject,
  tauriCli,
  uploadFixture,
  XCODE_PROJECT,
  XCODE_PROJECT_FILE,
  XCODE_PROJECT_WITH_SHARE,
  type Apple,
} from './testflight-apple-stand-in.ts';
import { appStoreConnect, CERTIFICATE, CERTIFICATE_RECORD, commit, git, KEY, profileContent, scratch, TOKEN } from './testflight-stand-in.ts';

// Each test runs real git a dozen or more times, so it is held to the fifteen seconds a test may take, not Bun's five.
setDefaultTimeout(15_000);

let place: ReturnType<typeof scratch>;
let origin: string;
let app: string;
let cargoHome: string;
let asc: Awaited<ReturnType<typeof appStoreConnect>>;
const apple = (options: Apple = {}) => appleFor(app, asc.builds, options);

beforeEach(async () => {
  place = scratch('testflight-upload-');
  ({ origin, app, cargoHome } = uploadFixture(place.folder));
  asc = await appStoreConnect({ bundleId: 'app.pastthebreak' });
});

afterEach(async () => {
  await asc.stop();
  place.done();
});

async function runUpload(stand: ReturnType<typeof apple>, overrides: Partial<UploadOptions> = {}) {
  const printed: string[] = [];
  let clock = 0;
  const code = await upload({
    cwd: app,
    tokenOnly: false,
    run: stand.run,
    env: { PATH: '/usr/bin:/bin', HOME: place.folder, CARGO_HOME: cargoHome },
    home: place.folder,
    appStoreConnect: asc.options,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    print: (line) => printed.push(line),
    fail: (line) => printed.push(`! ${line}`),
    output: () => {},
    ...overrides,
  });
  return { code, printed };
}

const count = () => git(app, 'rev-list', '--count', 'HEAD');
const short = () => git(app, 'rev-parse', '--short=7', 'HEAD');

test('a clean commit of main is built, checked, uploaded, and waited on until Apple has processed it', async () => {
  const stand = apple();
  const { code, printed } = await runUpload(stand);
  expect(printed).toEqual([`building build ${count()} (${short()})`, `uploading build ${count()} (${short()})`, `build ${count()} (${short()}) processed; TestFlight: IN_BETA_TESTING`]);
  expect(code).toBe(0);
  const config = JSON.parse(stand.named('tauri ios build')[0].command.at(-1)!);
  expect(config).toEqual({ bundle: { iOS: { bundleVersion: count() } } });
  expect(stand.named('tauri ios build')[0].command.slice(0, 7)).toEqual(['bunx', 'tauri', 'ios', 'build', '--ci', '--export-method', 'app-store-connect']);
  // "Not listed yet", then processing, both counted as waiting; the request for the build includes its TestFlight state.
  expect(asc.requests.filter((r) => r.includes('filter[version]'))).toHaveLength(3);
  expect(asc.requests.at(-1)).toContain('include=buildBetaDetail');
  // Only the values Tauri wrote are put back, so the tree is as committed.
  expect(git(app, 'status', '--porcelain')).toBe('');
  // The key and the certificate are each read once.
  expect(stand.named('op item get').map((c) => c.command[3])).toEqual(['App Store Connect API', 'TestFlight distribution certificate']);
});

test('run from a Tauri project in a subfolder, it puts back only the values Tauri wrote', async () => {
  // Timescale's layout: the Tauri project and its packages in desktop/, the repository's root above it.
  const sub = scratch('testflight-upload-subfolder-');
  try {
    const fixture = uploadFixture(sub.folder, 'desktop');
    const desktop = join(fixture.app, 'desktop');
    const stand = appleFor(desktop, asc.builds);
    const { code } = await runUpload(stand, { cwd: desktop, env: { PATH: '/usr/bin:/bin', HOME: sub.folder, CARGO_HOME: fixture.cargoHome }, home: sub.folder });
    expect(code).toBe(0);
    expect(stand.named('tauri ios build')[0].options.cwd).toBe(desktop);
    // Tauri wrote the build number and the export method into both plists; the tree is as committed again.
    expect(readFileSync(join(desktop, 'src-tauri/gen/apple/ExportOptions.plist'), 'utf8')).toContain('<string>debugging</string>');
    expect(git(fixture.app, 'status', '--porcelain')).toBe('');
  } finally {
    sub.done();
  }
});

test('the key, its token and APPLE_API_* never reach the build, and the token reaches only 1Password', async () => {
  const stand = apple();
  const env = { PATH: '/usr/bin:/bin', HOME: place.folder, CARGO_HOME: cargoHome, FORCE_COLOR: '3', APPLE_API_KEY: 'X', APPLE_API_ISSUER: 'Y', APPLE_API_KEY_PATH: '/k.p8', OP_SERVICE_ACCOUNT_TOKEN: 'from-the-shell' };
  expect((await runUpload(stand, { env })).code).toBe(0);
  for (const call of stand.calls.filter((c) => c.command[0] !== 'op')) {
    const names = Object.keys(call.options.env ?? {});
    expect(names.filter((n) => n.startsWith('APPLE_API_') || n === 'FORCE_COLOR' || n === 'OP_SERVICE_ACCOUNT_TOKEN')).toEqual([]);
    expect(JSON.stringify(call.options.env ?? {})).not.toContain(KEY.privateKey);
  }
  const op = stand.named('op item get')[0];
  expect(op.command).toEqual(['op', 'item', 'get', 'App Store Connect API', '--vault', 'TestFlight', '--format', 'json']);
  expect(op.options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBe(TOKEN);
  // The certificate reaches only Tauri's build, and its password only that and the openssl that reads the .p12.
  for (const call of stand.calls) {
    const text = JSON.stringify(call.options.env ?? {});
    const isTauri = call.command.join(' ').startsWith('bunx tauri ios build');
    if (!isTauri) expect(Object.keys(call.options.env ?? {}).filter((n) => n.startsWith('IOS_'))).toEqual([]);
    if (!isTauri && !(call.command[0] === '/usr/bin/openssl' && call.command[1] === 'pkcs12')) expect(text).not.toContain(CERTIFICATE.password);
  }
  const build = stand.named('tauri ios build')[0].options.env!;
  expect(build.LANG).toBe('en_US.UTF-8');
  // Apple's rsync first, then Rust's folder.
  const [rsyncFolder, cargo] = build.PATH!.split(':');
  expect(cargo).toBe(join(cargoHome, 'bin'));
  expect(existsSync(rsyncFolder)).toBe(false); // removed after the build
});

test("PATH finds rustc in the cargo folder, which a background job's PATH lacks", async () => {
  const stand = apple();
  expect((await runUpload(stand)).code).toBe(0);
  const rustc = stand.named('rustc')[0];
  expect(rustc.options.env?.PATH?.split(':')[0]).toBe(join(cargoHome, 'bin'));
  // Without the cargo folder, rustc is not found and nothing is built.
  const missing = apple();
  const { code, printed } = await runUpload(missing, { env: { PATH: '/usr/bin:/bin', HOME: place.folder, CARGO_HOME: join(place.folder, 'no-cargo') } });
  expect(code).toBe(1);
  expect(printed).toEqual([`! rustc not found in ${join(place.folder, 'no-cargo/bin')} or on PATH: install Rust from https://rustup.rs`]);
  expect(missing.named('tauri')).toEqual([]);
});

test('a commit that is not on main, or a tree with changes, is refused before anything is built', async () => {
  git(app, 'checkout', '-q', '-b', 'a-branch');
  commit(app, { 'src/app.ts': 'export const x = 1;\n' });
  const offMain = apple();
  const refused = await runUpload(offMain);
  expect(refused.code).toBe(1);
  expect(refused.printed[0]).toStartWith(`! HEAD (${short()}) is not a commit on origin/main's first-parent line`);
  expect(offMain.named('tauri')).toEqual([]);
  expect(offMain.named('op')).toEqual([]);

  git(app, 'checkout', '-q', 'main');
  writeFileSync(join(app, 'src/app.ts'), 'export const y = 2;\n');
  const dirty = apple();
  expect(await runUpload(dirty)).toEqual({ code: 1, printed: ['! commit first: the build number names a commit, and the tree has uncommitted changes'] });
  expect(dirty.named('tauri')).toEqual([]);
});

test('a commit main merged from a branch is refused: its count can name another commit of main', async () => {
  git(origin, 'checkout', '-q', '-b', 'side');
  const side = commit(origin, { 'src/side.ts': 'export {};\n' });
  git(origin, 'checkout', '-q', 'main');
  commit(origin, { 'src/main.ts': 'export {};\n' });
  git(origin, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  git(app, 'fetch', '-q');
  git(app, 'checkout', '-q', side);
  expect((await runUpload(apple())).code).toBe(1);
});

test('an App Store icon with see-through pixels, or none at all, is refused before anything is built', async () => {
  // metamax's first upload: `tauri icon` wrote its App Store icon with pixels at 254 of 255, and altool refused it after
  // the whole build, with 90717.
  const icon = `${ICON_SET}/AppIcon-512@2x.png`;
  const contents = `${ICON_SET}/Contents.json`;
  const xcodeForm = JSON.stringify({
    images: [
      { filename: 'AppIcon-iOS.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'AppIcon-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    ],
  });
  // getter's and Urge Surfer's: an alpha channel with every pixel at 255, which Apple took.
  commit(origin, { [icon]: rgba(255) });
  git(app, 'pull', '-q');
  expect((await runUpload(apple())).code).toBe(0);

  git(origin, 'rm', '-q', icon);
  git(origin, 'commit', '-q', '-m', 'no icon');
  git(app, 'pull', '-q');
  const missing = await runUpload(apple());
  expect(missing.printed).toEqual([`! the App Store icon ${icon} is missing: draw the iPhone icons with app-kit icons render --icon-set ${ICON_SET} (app-kit's README, icons), and commit them`]);
  for (const [files, refusal] of [
    [{ [icon]: rgba(254) }, `! the App Store icon ${icon} has see-through pixels (the least opaque is 254 of 255), which App Store Connect refuses after the whole build (90717): draw the iPhone icons with app-kit icons render --icon-set ${ICON_SET} (app-kit's README, icons), and commit them`],
    [{ [icon]: 'not a picture' }, `! the App Store icon ${icon} is not a PNG that can be read`],
    [{ [contents]: JSON.stringify({ images: [{ size: '60x60', idiom: 'iphone', filename: 'AppIcon-60x60@2x.png', scale: '2x' }] }) }, `! ${ICON_SET} has no App Store icon`],
  ] as const) {
    commit(origin, files);
    git(app, 'pull', '-q');
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toStartWith(refusal);
    expect(printed[0]).toContain('app-kit icons render');
    expect(stand.named('rustc')).toEqual([]);
    expect(stand.named('op')).toEqual([]);
    expect(stand.named('tauri')).toEqual([]);
  }

  // Xcode's one-size form: the light entry is the App Store icon; the dark one, which Apple wants see-through, is not.
  commit(origin, { [contents]: xcodeForm, [`${ICON_SET}/AppIcon-iOS.png`]: rgb(), [`${ICON_SET}/AppIcon-dark.png`]: rgba(0) });
  git(app, 'pull', '-q');
  expect((await runUpload(apple())).code).toBe(0);
});

test('without the token, a watcher run reads nothing and builds nothing; a run by hand uses the signed-in op', async () => {
  const watcher = apple({ token: false });
  const { code, printed } = await runUpload(watcher, { tokenOnly: true });
  expect(code).toBe(1);
  expect(printed).toEqual([`! waiting for the 1Password token: the login keychain has no "app-kit testflight" item (app-kit's README, TestFlight, says how to add it)`]);
  expect(watcher.named('op')).toEqual([]);
  expect(watcher.named('tauri')).toEqual([]);

  const byHand = apple({ token: false });
  expect((await runUpload(byHand)).code).toBe(0);
  expect(byHand.named('op item get')[0].options.env?.OP_SERVICE_ACCOUNT_TOKEN).toBeUndefined();
});

test('a compile failure exits 3 and a signing failure exits 1, and both put the plists back', async () => {
  const compile = await runUpload(apple({ build: 'compile' }));
  expect(compile.code).toBe(3);
  expect(compile.printed.at(-1)).toBe(`! build ${count()} (${short()}) did not compile: error: could not compile \`past-the-break\` (lib) due to 1 previous error`);
  expect(git(app, 'status', '--porcelain')).toBe('');
  const signing = await runUpload(apple({ build: 'signing' }));
  expect(signing.code).toBe(1);
  expect(signing.printed.at(-1)).toBe(`! the build of ${count()} (${short()}) failed: error: failed to build iOS app`);
  expect(git(app, 'status', '--porcelain')).toBe('');
});

test('a build that does not answer the export question, or carries the wrong number or a development signature, never goes up', async () => {
  for (const [options, problem] of [
    [{ encryption: false }, 'does not say ITSAppUsesNonExemptEncryption false'],
    [{ version: () => '0.1.0' }, `its CFBundleVersion is 0.1.0, not the build number`],
    [{ entitlements: ENTITLEMENTS_DEVELOPMENT }, 'its aps-environment is development, not production'],
  ] as const) {
    const stand = apple(options);
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed.at(-1)).toContain(problem);
    expect(stand.named('altool')).toEqual([]);
  }
  expect((await runUpload(apple({ entitlements: ENTITLEMENTS_PUSH }))).code).toBe(0);
});

test('the key folder is removed when altool refuses, and after an upload', async () => {
  const refused = apple({ altool: 'refused' });
  const { code, printed } = await runUpload(refused);
  expect(code).toBe(1);
  expect(printed.at(-1)).toStartWith(`! altool did not upload build ${count()}: ERROR: [ContentDelivery.Uploader] Asset validation failed (90062)`);
  expect(refused.keyFolders).toHaveLength(1);
  expect(existsSync(refused.keyFolders[0])).toBe(false);

  const uploaded = apple();
  expect((await runUpload(uploaded)).code).toBe(0);
  expect(existsSync(uploaded.keyFolders[0])).toBe(false);
});

test('a number App Store Connect already holds is "already uploaded", and the wait for processing goes on', async () => {
  const { code, printed } = await runUpload(apple({ altool: 'duplicate' }));
  expect(code).toBe(0);
  expect(printed).toContain(`build ${count()} is already uploaded; waiting for Apple's processing`);
});

test('processing that fails, or takes more than thirty minutes, exits 1', async () => {
  const invalid = await runUpload(apple({ states: ['PROCESSING', 'INVALID'] }));
  expect(invalid).toMatchObject({ code: 1 });
  expect(invalid.printed.at(-1)).toBe(`! Apple's processing of build ${count()} ended INVALID`);
  asc.builds.length = 0;
  const slow = await runUpload(apple({ states: ['PROCESSING'] }));
  expect(slow.code).toBe(1);
  expect(slow.printed.at(-1)).toBe(`! build ${count()} was uploaded, but Apple had not processed it in 30 minutes (PROCESSING)`);
});

test('stopped by the watcher\'s time limit, the upload stops the programs it started, removes the key and puts the plists back', async () => {
  for (const at of ['build', 'altool'] as const) {
    const marker = join(place.folder, `hang-${at}`);
    // As the watcher runs it: under caffeinate, which ends at once on the signal, in a process group of its own,
    // signalled once the step is under way.
    const stopped = await runCommand(['caffeinate', '-i', 'bun', join(import.meta.dir, 'testflight-upload-child.ts'), app, cargoHome, at, marker], {
      output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
    });
    expect(stopped.timedOut).toBe(true);
    expect(stopped.out).toContain('[testflight] stopped by SIGTERM; stopping the programs it started and removing the key');
    // The hanging program was in a group of its own, out of reach of the signal to the upload's group.
    expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
    expect(git(app, 'status', '--porcelain')).toBe('');
    if (at === 'altool') expect(existsSync(readFileSync(`${marker}.keys`, 'utf8'))).toBe(false);
    // Stopped mid-build, Tauri's keychain, which holds the private key, and its copy of the profile are removed too.
    const keychains = join(place.folder, 'Library/Keychains');
    expect(existsSync(keychains) ? readdirSync(keychains).filter((name) => !name.startsWith('.')) : []).toEqual([]);
    const copies = join(place.folder, 'Library/MobileDevice/Provisioning Profiles');
    expect(existsSync(copies) ? readdirSync(copies) : []).toEqual([]);
  }
});

describe('signing with the certificate from 1Password', () => {
  // Without its dotfiles: macOS's security, deleting a stand-in keychain it cannot open, leaves a temporary file beside it.
  const keychains = () => (existsSync(join(place.folder, 'Library/Keychains')) ? readdirSync(join(place.folder, 'Library/Keychains')).filter((name) => !name.startsWith('.')) : []);
  const tauriCopies = () => {
    const folder = join(place.folder, 'Library/MobileDevice/Provisioning Profiles');
    return existsSync(folder) ? readdirSync(folder) : [];
  };
  const xcodeProfile = (uuid: string) => join(place.folder, 'Library/Developer/Xcode/UserData/Provisioning Profiles', `${uuid}.mobileprovision`);

  test('the build signs with the certificate from 1Password and the profile from App Store Connect, and what Tauri leaves is put back', async () => {
    // The login keychain, one of Tauri's shape from another build, one another tool makes during this one, and a copy
    // of the same profile someone put in Tauri's folder before.
    mkdirSync(join(place.folder, 'Library/Keychains'), { recursive: true });
    writeFileSync(join(place.folder, 'Library/Keychains/login.keychain-db'), 'the login keychain');
    writeFileSync(join(place.folder, 'Library/Keychains/LeftBehind000000.keychain-db'), 'a keychain another build made');
    mkdirSync(join(place.folder, 'Library/MobileDevice/Provisioning Profiles'), { recursive: true });
    writeFileSync(join(place.folder, 'Library/MobileDevice/Provisioning Profiles/theirs.mobileprovision'), Buffer.from(profileContent('uuid-0001'), 'base64'));
    const stand = apple();
    const tauri = stand.run;
    stand.run = async (command, options) => {
      if (command.join(' ').startsWith('bunx tauri ios build')) writeFileSync(join(place.folder, 'Library/Keychains/AnotherTool00000.keychain-db'), 'another certificate');
      return tauri(command, options);
    };
    const { code } = await runUpload(stand);
    expect(code).toBe(0);
    const env = stand.named('tauri ios build')[0].options.env!;
    expect(env.IOS_CERTIFICATE).toBe(CERTIFICATE.p12);
    expect(env.IOS_CERTIFICATE_PASSWORD).toBe(CERTIFICATE.password);
    expect(env.IOS_MOBILE_PROVISION).toBe(profileContent('uuid-0001'));
    // The certificate was matched to Apple's record by its serial, which Apple writes without the leading zero.
    expect(asc.requests).toContain('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200&fields[certificates]=serialNumber,expirationDate');
    // Xcode's folder holds the profile by its uuid; the copy Tauri wrote and the keychain it made are gone, and nothing
    // this build did not make is touched.
    expect(readFileSync(xcodeProfile('uuid-0001'))).toEqual(Buffer.from(profileContent('uuid-0001'), 'base64'));
    expect(tauriCopies()).toEqual(['theirs.mobileprovision']);
    expect(keychains().sort()).toEqual(['AnotherTool00000.keychain-db', 'LeftBehind000000.keychain-db', 'login.keychain-db']);
    expect(git(app, 'status', '--porcelain')).toBe('');
    // Its .p12 was written for openssl in a folder of its own, removed after.
    expect(existsSync(dirname(stand.named('/usr/bin/openssl pkcs12')[0].command[3]))).toBe(false);
    // The lock is let go, so the next build signs.
    expect((await runUpload(apple())).code).toBe(0);
  });

  test('without the certificate in 1Password, nothing is built and the README is named', async () => {
    const stand = apple({ certificate: false });
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed).toEqual([`! the vault "TestFlight" has no "TestFlight distribution certificate", which the build signs with: make it as app-kit's README, TestFlight, "The distribution certificate", says`]);
    expect(stand.named('tauri')).toEqual([]);
  });

  test('a certificate Apple says has expired, or no longer lists, is refused before the build', async () => {
    await asc.stop();
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', certificates: [{ ...CERTIFICATE_RECORD, expirationDate: '2026-11-01T00:00:00.000+00:00' }] });
    const expired = apple();
    const late = await runUpload(expired, { now: () => Date.parse('2026-11-03T00:00:00Z') });
    expect(late.printed).toEqual([`! the distribution certificate expired on 2026-11-01: make it as app-kit's README, TestFlight, "The distribution certificate", says`]);
    expect(expired.named('tauri')).toEqual([]);
    await asc.stop();
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', certificates: [] });
    const revoked = await runUpload(apple());
    expect(revoked.printed[0]).toStartWith('! Apple lists no distribution certificate with the serial number of the one in 1Password');
  });

  test("the app's App Store profile is made when it has none, and a refusal names the developer site", async () => {
    await asc.stop();
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', profiles: [{ id: 'OLD', uuid: 'uuid-old', content: profileContent('uuid-old'), type: 'IOS_APP_STORE', state: 'INVALID', certificates: [CERTIFICATE_RECORD.id] }] });
    const stand = apple();
    expect((await runUpload(stand)).code).toBe(0);
    expect(asc.requests).toContain('POST /v1/profiles');
    expect(stand.named('tauri ios build')[0].options.env?.IOS_MOBILE_PROVISION).toBe(profileContent('uuid-0002'));
    await asc.stop();
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', profiles: [], refuseProfiles: true });
    const refused = apple();
    const { code, printed } = await runUpload(refused);
    expect(code).toBe(1);
    expect(printed).toEqual([`! Apple refused the key making the App Store profile for app.pastthebreak: make it once on Apple's developer site (Profiles, +, App Store Connect, app.pastthebreak, the certificate expiring 2099-01-01), and the next upload fetches it`]);
    expect(refused.named('tauri')).toEqual([]);
  });

  test("another app's profile is passed over, and a match on a later page is found", async () => {
    await asc.stop();
    const other = { id: 'OTHER', uuid: 'uuid-other', content: profileContent('uuid-other'), type: 'IOS_APP_STORE', state: 'ACTIVE', certificates: [CERTIFICATE_RECORD.id], bundle: 'BUNDLE0002' };
    const ours = { id: 'OURS', uuid: 'uuid-ours', content: profileContent('uuid-ours'), type: 'IOS_APP_STORE', state: 'ACTIVE', certificates: [CERTIFICATE_RECORD.id] };
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', profiles: [other, ours], pageSize: 1 });
    const stand = apple();
    expect((await runUpload(stand)).code).toBe(0);
    expect(stand.named('tauri ios build')[0].options.env?.IOS_MOBILE_PROVISION).toBe(profileContent('uuid-ours'));
    expect(asc.requests.filter((r) => r.startsWith('/v1/profiles'))).toHaveLength(2);
    expect(asc.requests).not.toContain('POST /v1/profiles');
  });

  test("the bundle id is the iPhone config's when it sets one", async () => {
    commit(origin, { 'src-tauri/tauri.ios.conf.json': JSON.stringify({ identifier: 'app.pastthebreak.phone' }) });
    git(app, 'pull', '-q');
    const { code, printed } = await runUpload(apple());
    expect(code).toBe(1);
    expect(printed[0]).toBe("! the team has no bundle id app.pastthebreak.phone: register it on Apple's developer site (Certificates, Identifiers & Profiles, Identifiers), with the capabilities the app uses");
  });

  test('a Tauri CLI older than 2.12.1 is refused, since it puts the profile outside the iPhone target', async () => {
    tauriCli(app, '2.11.4');
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed[0]).toStartWith("! the app's Tauri CLI is 2.11.4, and signing with the certificate needs 2.12.1 or later");
    expect(stand.named('op')).toEqual([]);
    tauriCli(app, '2.12.1');
    expect((await runUpload(apple())).code).toBe(0);
  });

  test('a second signing build on the Mac is refused while the first holds the lock', async () => {
    const lockFile = join(place.folder, 'Library/Caches/app-kit/testflight-signing.lock');
    mkdirSync(dirname(lockFile), { recursive: true });
    const holder = Bun.spawn(['sleep', '30']);
    try {
      writeFileSync(lockFile, String(holder.pid));
      const stand = apple();
      const { code, printed } = await runUpload(stand);
      expect(code).toBe(1);
      expect(printed.at(-1)).toBe(`! another signing build is running on this Mac (its process id is in ${lockFile}); try again once it ends`);
      expect(stand.named('tauri')).toEqual([]);
      expect(readFileSync(lockFile, 'utf8')).toBe(String(holder.pid));
    } finally {
      holder.kill();
    }
    // A lock whose holder is gone is taken over.
    await holder.exited;
    expect((await runUpload(apple())).code).toBe(0);
  });

  test('an Xcode project changed beyond its signing settings is left as the build wrote it, and nothing goes up', async () => {
    const stand = apple({ projectEdit: true });
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe(`! the build changed ${XCODE_PROJECT_FILE} beyond its signing settings, so it is left as the build wrote it: look at git diff, and put it back or commit it`);
    expect(readFileSync(join(app, XCODE_PROJECT_FILE), 'utf8')).toContain('app.pastthebreak.edited');
    expect(stand.named('altool')).toEqual([]);
  });

  test("the project is put back only when the build changed nothing but Tauri's signing lines for this certificate and profile", () => {
    const signedWith = { team: 'TEAM000000', profileUuids: ['uuid-0001'] };
    const signed = signedProject(XCODE_PROJECT, 'uuid-0001');
    expect(signed).not.toBe(XCODE_PROJECT);
    expect(projectToPutBack(XCODE_PROJECT, signed, signedWith)).toBe(XCODE_PROJECT);
    // Something else changed too.
    expect(projectToPutBack(XCODE_PROJECT, signed.replace('PRODUCT_BUNDLE_IDENTIFIER = app.pastthebreak;', 'PRODUCT_BUNDLE_IDENTIFIER = x;'), signedWith)).toBeNull();
    // A signing setting someone set meanwhile, to another team or profile, is not this build's.
    expect(projectToPutBack(XCODE_PROJECT, signed.replace('PROVISIONING_PROFILE_SPECIFIER = uuid-0001;', 'PROVISIONING_PROFILE_SPECIFIER = someone-elses;'), signedWith)).toBeNull();
    expect(projectToPutBack(XCODE_PROJECT, signed.replaceAll('DEVELOPMENT_TEAM = TEAM000000;', 'DEVELOPMENT_TEAM = OTHERTEAM1;'), signedWith)).toBeNull();
    // One someone removed meanwhile, with nothing in its place.
    expect(projectToPutBack(XCODE_PROJECT, signed.replace('\t\t\t\tDEVELOPMENT_TEAM = TEAM000000;\n', ''), signedWith)).toBeNull();
  });

  test('a Tauri CLI a workspace hoists to the repository root is found', async () => {
    const sub = scratch('testflight-upload-hoisted-');
    try {
      const fixture = uploadFixture(sub.folder, 'desktop');
      const desktop = join(fixture.app, 'desktop');
      rmSync(join(desktop, 'node_modules'), { recursive: true });
      tauriCli(fixture.app, '2.12.4');
      const { code } = await runUpload(appleFor(desktop, asc.builds), { cwd: desktop, env: { PATH: '/usr/bin:/bin', HOME: sub.folder, CARGO_HOME: fixture.cargoHome }, home: sub.folder });
      expect(code).toBe(0);
    } finally {
      sub.done();
    }
  });

  test("the build's security notes each keychain it is asked to create, never the password, and hands every call on", () => {
    const folder = join(place.folder, 'tools');
    mkdirSync(folder);
    writeSecurityRecorder(folder, '/bin/echo');
    const made = Bun.spawnSync([join(folder, 'security'), 'create-keychain', '-p', 'the-password', '/a/b/Made.keychain-db'], { stdout: 'pipe' });
    expect(made.stdout.toString()).toBe('create-keychain -p the-password /a/b/Made.keychain-db\n');
    const listed = Bun.spawnSync([join(folder, 'security'), 'list-keychain', '-d', 'user'], { stdout: 'pipe' });
    expect(listed.stdout.toString()).toBe('list-keychain -d user\n');
    expect(readFileSync(join(folder, 'keychains-made'), 'utf8')).toBe('/a/b/Made.keychain-db\n');
  });

  test("the .p12 is read with macOS's own openssl, never the first on PATH", async () => {
    const stand = apple();
    expect((await runUpload(stand, { env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: place.folder, CARGO_HOME: cargoHome } })).code).toBe(0);
    expect(stand.calls.filter((c) => c.command.includes('pkcs12') || c.command.includes('x509')).map((c) => c.command[0])).toEqual(['/usr/bin/openssl', '/usr/bin/openssl']);
  });
});

describe('an app with a share extension', () => {
  /** The app's checkout, with a share extension in its Xcode project, and App Store Connect as the test sets it. */
  const share = async (config: Omit<Parameters<typeof appStoreConnect>[0], 'bundleId'> = {}) => {
    ({ origin, app, cargoHome } = uploadFixture(join(place.folder, 'share'), '', { share: true }));
    await asc.stop();
    asc = await appStoreConnect({ bundleId: 'app.pastthebreak', ...config });
  };
  const withGroup = (id: string, uuid: string, bundle?: string) => ({
    id,
    uuid,
    content: profileContent(uuid, [GROUP]),
    type: 'IOS_APP_STORE',
    state: 'ACTIVE',
    certificates: [CERTIFICATE_RECORD.id],
    ...(bundle ? { bundle } : {}),
  });
  const xcodeProfile = (uuid: string) => join(place.folder, 'Library/Developer/Xcode/UserData/Provisioning Profiles', `${uuid}.mobileprovision`);

  test("each target signs with its own profile: the extension's App ID is registered, its profile made, and the export lists it", async () => {
    // The app's profile allows the group; the team has no App ID for the extension yet, and Apple has the group assigned to it once registered.
    await share({ profiles: [withGroup('APP', 'uuid-app0')], groups: { [SHARE_ID]: [GROUP] } });
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(printed.filter((line) => line.startsWith('!'))).toEqual([]);
    expect(code).toBe(0);
    expect(asc.madeBundles).toEqual([{ identifier: SHARE_ID, name: 'app-kit app pastthebreak share', platform: 'IOS' }]);
    expect(asc.requests.filter((request) => request === 'POST /v1/profiles')).toHaveLength(1);
    const made = asc.profiles.at(-1)!;
    expect(made.bundle).toBe('BUNDLE0003');
    // Tauri signs the app with the app's profile; the extension's configurations were signed by hand with its own.
    expect(stand.named('tauri ios build')[0].options.env?.IOS_MOBILE_PROVISION).toBe(profileContent('uuid-app0', [GROUP]));
    const during = stand.during.project!;
    for (const line of [
      'CODE_SIGN_STYLE = Manual;',
      'CODE_SIGN_IDENTITY = "Apple Distribution: Team (TEAM000000)";',
      '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution: Team (TEAM000000)";',
      'DEVELOPMENT_TEAM = TEAM000000;',
      `PROVISIONING_PROFILE_SPECIFIER = "${made.uuid}";`,
      `"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "${made.uuid}";`,
    ]) {
      expect(during.split('\n').filter((text) => text.trim() === line)).toHaveLength(line.startsWith('DEVELOPMENT_TEAM') ? 4 : 2);
    }
    expect(during).not.toContain('iPhone Developer');
    // The export is given the extension's profile by the xcodebuild first on the build's PATH.
    expect(stand.during.xcodebuild).toContain(`Set :provisioningProfiles:${SHARE_ID} ${made.uuid}`);
    // Xcode's folder holds both profiles, and the project and both Info.plists are as committed.
    expect(existsSync(xcodeProfile('uuid-app0'))).toBe(true);
    expect(readFileSync(xcodeProfile(made.uuid))).toEqual(Buffer.from(made.content, 'base64'));
    expect(git(app, 'status', '--porcelain')).toBe('');
    // The next upload reuses both, registering and making nothing.
    const again = asc.requests.length;
    commit(origin, { 'src/next.ts': 'export {};\n' });
    git(app, 'pull', '-q');
    expect((await runUpload(apple())).code).toBe(0);
    expect(asc.requests.slice(again).filter((request) => request.startsWith('POST'))).toEqual([]);
  });

  test('an active profile without the App Group stops the upload before the build, with the steps for every App ID on one line, and makes nothing', async () => {
    const lacking = { id: 'OLD', uuid: 'uuid-old0', content: profileContent('uuid-old0'), type: 'IOS_APP_STORE', state: 'ACTIVE', certificates: [CERTIFICATE_RECORD.id] };
    await share({ profiles: [lacking, { ...lacking, id: 'OLDSHARE', uuid: 'uuid-old1', content: profileContent('uuid-old1'), bundle: 'BUNDLE0003' }], bundles: [SHARE_ID] });
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed).toEqual([
      `! the App Store profile for app.pastthebreak and ${SHARE_ID} lacks the App Group ${GROUP}, which Apple's API cannot add: on Apple's developer site, Certificates, Identifiers & Profiles, Identifiers, choose App Groups in the menu at the right, and if ${GROUP} is not listed, +, App Groups, Continue, a description and the identifier, Continue, Register; then choose App IDs in that menu and open app.pastthebreak (tick App Groups, Configure, tick ${GROUP}, Continue, Assign, Done, Save, Confirm), then ${SHARE_ID} (tick App Groups, Configure, tick ${GROUP}, Continue, Assign, Done, Save, Confirm); then run the upload again, which makes profiles that allow it`,
    ]);
    expect(asc.requests.filter((request) => request.startsWith('POST') || request.startsWith('DELETE'))).toEqual([]);
    expect(stand.named('tauri')).toEqual([]);
    expect(git(app, 'status', '--porcelain')).toBe('');
  });

  test('with no active profile, one is made; made without the App Group, it is kept and the upload stops with the steps', async () => {
    // The app's group is assigned; the extension's App ID exists without it.
    await share({ profiles: [withGroup('APP', 'uuid-app0')], bundles: [SHARE_ID] });
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toStartWith(`! the App Store profile for ${SHARE_ID} lacks the App Group ${GROUP}, which Apple's API cannot add:`);
    expect(asc.requests.filter((request) => request.startsWith('POST') || request.startsWith('DELETE'))).toEqual(['POST /v1/profiles']);
    expect(asc.profiles.at(-1)).toMatchObject({ bundle: 'BUNDLE0003', state: 'ACTIVE' });
    expect(stand.named('tauri')).toEqual([]);
    // Tried again before the step, the kept profile stops it with nothing more made.
    const before = asc.requests.length;
    expect((await runUpload(apple())).code).toBe(1);
    expect(asc.requests.slice(before).filter((request) => request.startsWith('POST'))).toEqual([]);
  });

  test("Apple's refusal to register the extension's App ID gives Apple's reason and the steps by hand", async () => {
    await share({ profiles: [withGroup('APP', 'uuid-app0')], refuseBundleIds: true });
    const stand = apple();
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed).toEqual([
      `! Apple refused registering the app extension's bundle id ${SHARE_ID} (App Store Connect answered 403 to /v1/bundleIds: The API key in use does not allow this request: The API key in use does not allow this request): register it once on Apple's developer site (Certificates, Identifiers & Profiles, Identifiers, +, App IDs, App, its description and the explicit bundle id ${SHARE_ID}, Continue, Register), and the next upload uses it`,
    ]);
    expect(stand.named('tauri')).toEqual([]);
  });

  test("a built app whose extension's signature lacks its App Group never goes up", async () => {
    await share({ profiles: [withGroup('APP', 'uuid-app0'), withGroup('SHARE', 'uuid-shr0', 'BUNDLE0003')], bundles: [SHARE_ID] });
    const stand = apple({ extensionEntitlements: groupEntitlements(SHARE_ID).replace(`<string>${GROUP}</string>`, '') });
    const { code, printed } = await runUpload(stand);
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe(`! Past the Break.ipa must not go up: its extension ${SHARE_ID}'s signature lacks the App Group ${GROUP} its entitlements ask for`);
    expect(stand.named('altool')).toEqual([]);
    expect(git(app, 'status', '--porcelain')).toBe('');
  });

  test('an app with no extension makes no extra calls and puts no xcodebuild on the build\'s path', async () => {
    const stand = apple();
    expect((await runUpload(stand)).code).toBe(0);
    expect(stand.during.xcodebuild).toBeNull();
    expect(asc.requests.filter((request) => request.startsWith('POST') || request.startsWith('/v1/bundleIds'))).toEqual(['/v1/bundleIds?filter[identifier]=app.pastthebreak&limit=200&fields[bundleIds]=identifier']);
  });

  test("the xcodebuild stand-in sets each extension's profile in the export settings, over an entry already there, and hands every call on", () => {
    const folder = join(place.folder, 'tools');
    mkdirSync(folder);
    writeXcodebuildStandIn(folder, [{ bundleId: SHARE_ID, profileUuid: 'uuid-shr0' }, { bundleId: 'app.pastthebreak.widget', profileUuid: 'uuid-wid0' }], '/bin/echo');
    // As Tauri 2.12 writes it: the app's profile alone; and as a later Tauri would, the extension's committed entry kept.
    const tauriWrote = join(place.folder, 'export.plist');
    writeFileSync(tauriWrote, plist(`\t<key>method</key>\n\t<string>app-store-connect</string>\n\t<key>provisioningProfiles</key>\n\t<dict>\n\t\t<key>app.pastthebreak</key>\n\t\t<string>uuid-app0</string>\n\t\t<key>${SHARE_ID}</key>\n\t\t<string>uuid-stale</string>\n\t</dict>\n`));
    const exported = Bun.spawnSync([join(folder, 'xcodebuild'), '-exportArchive', '-archivePath', 'a.xcarchive', '-exportOptionsPlist', tauriWrote, '-exportPath', 'out'], { stdout: 'pipe' });
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout.toString()).toBe(`-exportArchive -archivePath a.xcarchive -exportOptionsPlist ${tauriWrote} -exportPath out\n`);
    const read = Bun.spawnSync(['plutil', '-convert', 'json', '-o', '-', tauriWrote], { stdout: 'pipe' });
    expect(JSON.parse(read.stdout.toString()).provisioningProfiles).toEqual({ 'app.pastthebreak': 'uuid-app0', [SHARE_ID]: 'uuid-shr0', 'app.pastthebreak.widget': 'uuid-wid0' });
    // Export settings with no list get one; a build or an archive is handed on untouched.
    const bare = join(place.folder, 'bare.plist');
    writeFileSync(bare, plist('\t<key>method</key>\n\t<string>app-store-connect</string>\n'));
    expect(Bun.spawnSync([join(folder, 'xcodebuild'), '-exportArchive', '-exportOptionsPlist', bare]).exitCode).toBe(0);
    expect(JSON.parse(Bun.spawnSync(['plutil', '-convert', 'json', '-o', '-', bare], { stdout: 'pipe' }).stdout.toString()).provisioningProfiles[SHARE_ID]).toBe('uuid-shr0');
    const built = Bun.spawnSync([join(folder, 'xcodebuild'), 'archive', '-scheme', 'app'], { stdout: 'pipe' });
    expect(built.stdout.toString()).toBe('archive -scheme app\n');
    expect(() => writeXcodebuildStandIn(folder, [{ bundleId: 'a"; rm -rf /', profileUuid: 'x' }])).toThrow();
  });

  test("the extension's signing lines are set in its configurations alone, and put back with the app's", () => {
    const settings = extensionSigningSettings({ identity: 'Apple Distribution: Team (TEAM000000)', team: 'TEAM000000', profileUuid: 'uuid-shr0' });
    const signed = withBuildSettings(XCODE_PROJECT_WITH_SHARE, ['E1', 'E2'], settings)!;
    // The development identity is replaced, the other settings added, and the app's configurations untouched.
    expect(signed).not.toContain('iPhone Developer');
    expect(signed.match(/PROVISIONING_PROFILE_SPECIFIER = "uuid-shr0";/g)).toHaveLength(2);
    expect(signed.slice(signed.indexOf('A1 /* debug */'), signed.indexOf('E1 /* debug */'))).toBe(XCODE_PROJECT_WITH_SHARE.slice(XCODE_PROJECT_WITH_SHARE.indexOf('A1 /* debug */'), XCODE_PROJECT_WITH_SHARE.indexOf('E1 /* debug */')));
    // Set twice, each setting is still one line.
    expect(withBuildSettings(signed, ['E1', 'E2'], settings)).toBe(signed);
    const both = signedProject(signed, 'uuid-app0');
    expect(projectToPutBack(XCODE_PROJECT_WITH_SHARE, both, { team: 'TEAM000000', profileUuids: ['uuid-app0', 'uuid-shr0'] })).toBe(XCODE_PROJECT_WITH_SHARE);
    // Signed with a profile this build did not use, it is not put back.
    expect(projectToPutBack(XCODE_PROJECT_WITH_SHARE, both, { team: 'OTHERTEAM1', profileUuids: ['uuid-app0'] })).toBeNull();
    expect(withBuildSettings(XCODE_PROJECT_WITH_SHARE, ['NOPE'], settings)).toBeNull();
  });

  test("a profile's App Groups are read from the plist Apple signs into it", () => {
    expect(profileGroups(profileContent('uuid-1', [GROUP, 'group.other']))).toEqual([GROUP, 'group.other']);
    expect(profileGroups(profileContent('uuid-1'))).toEqual([]);
  });
});

describe('the pure parts', () => {
  test("the build's environment", () => {
    const env = buildEnv(
      { PATH: '/opt/homebrew/bin:/usr/bin', FORCE_COLOR: '3', APPLE_API_KEY: 'k', OP_SERVICE_ACCOUNT_TOKEN: 't', IOS_CERTIFICATE: 'c', IOS_CERTIFICATE_PASSWORD: 'p', IOS_MOBILE_PROVISION: 'm', HOME: '/h' },
      '/h',
    );
    expect(env).toEqual({ PATH: '/h/.cargo/bin:/opt/homebrew/bin:/usr/bin', HOME: '/h', LANG: 'en_US.UTF-8' });
    expect(buildEnv({ PATH: '/usr/bin', CARGO_HOME: '/rust' }, '/h').PATH).toBe('/rust/bin:/usr/bin');
  });

  test('a compile failure is told from a failure another try can clear', () => {
    expect(compileFailed('error: could not compile `app` (lib) due to 2 previous errors')).toBe(true);
    expect(compileFailed('Running beforeBuildCommand `bun run build`\nError beforeBuildCommand `bun run build` failed with exit code 2')).toBe(true);
    expect(compileFailed('/x/Sources/Plugin.swift:12:5: error: cannot find type')).toBe(true);
    // A link failure can be a Rust build made before llvm-tools was installed, which clears once its folder is removed.
    expect(compileFailed('ld: Undefined symbols for architecture arm64\nclang: error: linker command failed')).toBe(false);
    expect(compileFailed('error: No signing certificate "iOS Distribution" found')).toBe(false);
    expect(compileFailed('Command PhaseScriptExecution failed: errSecInternalComponent')).toBe(false);
  });

  test("altool's answer for a number already uploaded", () => {
    expect(alreadyUploaded("ERROR ITMS-90189: \"Redundant Binary Upload. You've already uploaded a build with build number '88' for version number '0.1.0'.\"")).toBe(true);
    expect(alreadyUploaded('The value for key CFBundleVersion [3] in the Info.plist file must contain a higher version')).toBe(false);
  });

  test("the built app's facts", () => {
    // Past the Break's build 108, as plutil and codesign read it.
    const pastTheBreak = {
      info: { CFBundleVersion: '108', CFBundleIdentifier: 'app.pastthebreak', ITSAppUsesNonExemptEncryption: false },
      entitlements: { 'application-identifier': 'TEAM000000.app.pastthebreak', 'beta-reports-active': true, 'get-task-allow': false },
    };
    expect(ipaProblems(pastTheBreak, 108)).toEqual([]);
    expect(ipaProblems(pastTheBreak, 109)).toEqual(['its CFBundleVersion is 108, not the build number 109']);
    // Argon's development build, as codesign read it: push for the sandbox, signed for development.
    const argonDevelopment = {
      info: { CFBundleVersion: '7', ITSAppUsesNonExemptEncryption: false },
      entitlements: { 'aps-environment': 'development', 'get-task-allow': true },
    };
    expect(ipaProblems(argonDevelopment, 7)).toEqual([
      "its aps-environment is development, not production, so push would go to Apple's sandbox",
      'its beta-reports-active is not true, so it is not signed for TestFlight',
      'its get-task-allow is not false, so it is signed for development',
    ]);
  });

  test("a PNG's pixels at each opacity, decoded", async () => {
    const least = (bytes: Uint8Array) => pngOpacities(bytes)?.findIndex((count) => count > 0) ?? null;
    expect(least(rgb())).toBe(255); // no alpha channel, as app-kit icons render draws the iPhone icons
    expect(least(rgba(255))).toBe(255); // an alpha channel, every pixel opaque, as getter's went up
    expect(least(rgba(254))).toBe(254); // metamax's, refused
    expect(pngOpacities(rgba(254))?.filter((count) => count > 0)).toEqual([1, 3]);
    expect(least(png(4, [[7, 255], [7, 0]]))).toBe(0); // grey with alpha
    expect(least(png(6, [[1, 2, 3, 65535], [1, 2, 3, 65534]], { depth: 16 }))).toBe(254); // 16 bits: only a full alpha is 255
    expect(least(png(6, [[1, 2, 3, 65535], [1, 2, 3, 65535]], { depth: 16 }))).toBe(255);
    // A palette's transparency counts only for the entries the pixels use.
    const palette: [string, number[]][] = [['PLTE', [9, 9, 9, 8, 8, 8]], ['tRNS', [255, 0]]];
    expect(least(png(3, [[0], [0]], { chunks: palette }))).toBe(255);
    expect(least(png(3, [[0], [1]], { chunks: palette }))).toBe(0);
    // A colour marked see-through counts only where a pixel is that colour.
    const key: [string, number[]][] = [['tRNS', [0, 1, 0, 2, 0, 3]]];
    expect(least(png(2, [[9, 9, 9], [9, 9, 9]], { chunks: key }))).toBe(255);
    expect(least(png(2, [[9, 9, 9], [1, 2, 3]], { chunks: key }))).toBe(0);
    expect(pngOpacities(png(2, [[9, 9, 9], [9, 9, 9]], { chunks: [['tRNS', [0, 1, 0]]] }))).toBeNull(); // a key cut short

    // As an encoder writes them, read pixel for pixel the same as sharp reads them back: bands of rows that make it
    // choose each of the five row filters, the alpha varying in all but the first, and noise at a fixed seed.
    let seed = 1;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16;
    const [width, height] = [64, 80];
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          const band = Math.floor(y / 16);
          const value = [
            channel === 3 ? 255 : (x + y + channel) & 1, // no filter
            (x * 3 + channel * 40) & 255, // across
            ((x * 7) ^ (channel * 50)) & 255, // down
            (x * 5 + y * 3 + channel) & 255, // average and Paeth
            random(),
          ][band]!;
          raw[(y * width + x) * 4 + channel] = channel === 3 && band > 0 ? 128 + (value & 127) : value;
        }
      }
    }
    const filtersOf = (bytes: Buffer) => {
      const data: Buffer[] = [];
      for (let at = 8; at < bytes.length; at += 12 + bytes.readUInt32BE(at)) {
        if (bytes.toString('latin1', at + 4, at + 8) === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + bytes.readUInt32BE(at)));
      }
      const rows = inflateSync(Buffer.concat(data));
      return new Set(Array.from({ length: height }, (_, y) => rows[y * (width * 4 + 1)]));
    };
    const asSharpReads = async (bytes: Buffer) => {
      const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const counts = Array.from({ length: 256 }, () => 0);
      for (let at = 3; at < data.length; at += 4) counts[data[at]!]!++;
      return counts;
    };
    const image = () => sharp(raw, { raw: { width, height, channels: 4 } });
    const filtered = await image().png({ adaptiveFiltering: true }).toBuffer();
    expect(filtersOf(filtered)).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(pngOpacities(filtered)).toEqual(await asSharpReads(filtered));
    // Interlaced: seven passes, each filtered on its own.
    const interlaced = await image().png({ progressive: true, adaptiveFiltering: true }).toBuffer();
    expect(interlaced[28]).toBe(1);
    expect(pngOpacities(interlaced)).toEqual(await asSharpReads(interlaced));
    // A palette sharp makes, with its transparency.
    const quantized = await image().png({ palette: true }).toBuffer();
    expect(quantized[25]).toBe(3);
    expect(pngOpacities(quantized)).toEqual(await asSharpReads(quantized));

    // Xcode's crushed PNGs, found inside a built app, put a chunk of their own before the header.
    const crushed = rgb();
    crushed.write('CgBI', 12, 'latin1');
    expect(pngOpacities(crushed)).toBeNull();
    expect(pngOpacities(Buffer.from('not a picture, but long enough to read a header from'))).toBeNull();
    expect(pngOpacities(rgba(255).subarray(0, 20))).toBeNull();
    // Image data cut short.
    const whole = rgba(255);
    expect(pngOpacities(whole.subarray(0, whole.length - 20))).toBeNull();
  });

  test('only the value the build wrote is put back, so an edit made during the build survives', () => {
    const written = INFO.replace('<key>CFBundleVersion</key>\n\t<string>0.1.0', '<key>CFBundleVersion</key>\n\t<string>42').replace('0.1.0</string>\n\t<key>CFBundleVersion', '0.2.0</string>\n\t<key>CFBundleVersion');
    const restored = restoreValue(written, 'CFBundleVersion', '42', '0.1.0');
    expect(restored).toContain('<key>CFBundleVersion</key>\n\t<string>0.1.0</string>');
    expect(restored).toContain('<string>0.2.0</string>');
    // A value someone changed meanwhile is left as they made it.
    expect(restoreValue(INFO.replace('<string>0.1.0</string>\n</dict>', '<string>9</string>\n</dict>'), 'CFBundleVersion', '42', '0.1.0')).toContain('<string>9</string>');
  });
});
