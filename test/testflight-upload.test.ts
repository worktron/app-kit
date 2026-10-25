// `app-kit testflight upload`: the checks before a build, the build's environment, the checks on the built app, the
// upload with the key in a folder of its own, and the wait for Apple's processing, against stand-ins for Tauri, altool,
// codesign, the keychain, 1Password and App Store Connect, in a real git repository reached over file://.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runCommand } from '../tauri/testflight/run.ts';
import { join } from 'node:path';
import {
  alreadyUploaded,
  buildEnv,
  compileFailed,
  ipaProblems,
  restoreValue,
  upload,
  type UploadOptions,
} from '../tauri/testflight/upload.ts';
import { apple as appleFor, ENTITLEMENTS_DEVELOPMENT, ENTITLEMENTS_PUSH, INFO, uploadFixture, type Apple } from './testflight-apple-stand-in.ts';
import { appStoreConnect, commit, git, KEY, scratch, TOKEN } from './testflight-stand-in.ts';

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
  // The key is read once.
  expect(stand.named('op item get')).toHaveLength(1);
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
    // As the watcher runs it: a process group of its own, signalled once the step is under way.
    const stopped = await runCommand(['bun', join(import.meta.dir, 'testflight-upload-child.ts'), app, cargoHome, at, marker], {
      output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
    });
    expect(stopped.timedOut).toBe(true);
    expect(stopped.out).toContain('[testflight] stopped by SIGTERM; stopping the programs it started and removing the key');
    // The hanging program was in a group of its own, out of reach of the signal to the upload's group.
    expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
    expect(git(app, 'status', '--porcelain')).toBe('');
    if (at === 'altool') expect(existsSync(readFileSync(`${marker}.keys`, 'utf8'))).toBe(false);
  }
});

describe('the pure parts', () => {
  test("the build's environment", () => {
    const env = buildEnv({ PATH: '/opt/homebrew/bin:/usr/bin', FORCE_COLOR: '3', APPLE_API_KEY: 'k', OP_SERVICE_ACCOUNT_TOKEN: 't', HOME: '/h' }, '/h');
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

  test('only the value the build wrote is put back, so an edit made during the build survives', () => {
    const written = INFO.replace('<key>CFBundleVersion</key>\n\t<string>0.1.0', '<key>CFBundleVersion</key>\n\t<string>42').replace('0.1.0</string>\n\t<key>CFBundleVersion', '0.2.0</string>\n\t<key>CFBundleVersion');
    const restored = restoreValue(written, 'CFBundleVersion', '42', '0.1.0');
    expect(restored).toContain('<key>CFBundleVersion</key>\n\t<string>0.1.0</string>');
    expect(restored).toContain('<string>0.2.0</string>');
    // A value someone changed meanwhile is left as they made it.
    expect(restoreValue(INFO.replace('<string>0.1.0</string>\n</dict>', '<string>9</string>\n</dict>'), 'CFBundleVersion', '42', '0.1.0')).toContain('<string>9</string>');
  });
});
