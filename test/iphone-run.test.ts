// `app-kit iphone run sim|phone`: the Simulator path in order, its device found or made for the checkout, the phone
// path with and without the phone in a development profile, the Xcode project with a terminal's FORCE_COLOR written
// in, and the stop by signal, against stand-ins for xcrun, bunx, xcodebuild and security; git and plutil are real. The
// listings are written by hand in the shape this Mac's Xcode 27.1 prints, with made-up names, ids and team.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { colorWrittenIn, DEVICE_TYPE, pairedPhones, readApp, runIphone, type IphoneRunOptions } from '../tauri/iphone-run/index.ts';
import { runCommand } from '../command-line/run.ts';
import { exit, git, ok, repository, scratch, standInRunner, type Answer } from './testflight-stand-in.ts';

// The worktree test runs real git a few times.
setDefaultTimeout(15_000);

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/iphone-run', name), 'utf8');
const SIMULATOR = '00000000-0000-0000-0000-00000000A001';
const NEW_SIMULATOR = '00000000-0000-0000-0000-00000000B002';
const PHONE = '00008100-0000000000000002';
const TEAM = 'TEAM000000';
const BUNDLE = 'app.example.sample-app';
const PROFILES = 'Library/Developer/Xcode/UserData/Provisioning Profiles';
/** The Rust build step as Tauri's project template writes it, with ${FORCE_COLOR} in place. */
const RUST_STEP =
  'shellScript = "bun tauri ios xcode-script -v --platform \\"${PLATFORM_DISPLAY_NAME:?}\\" --sdk-root \\"${SDKROOT:?}\\" --framework-search-paths \\"${FRAMEWORK_SEARCH_PATHS:?}\\" --header-search-paths \\"${HEADER_SEARCH_PATHS:?}\\" --gcc-preprocessor-definitions \\"${GCC_PREPROCESSOR_DEFINITIONS:-}\\" --configuration \\"${CONFIGURATION:?}\\" ${FORCE_COLOR} ${ARCHS:?}\\n";';

let place: ReturnType<typeof scratch>;
let app: string;
let home: string;

/** An app's files: its config with an identifier Tauri changes for iOS, and an Xcode project named unlike the product. */
function appFiles(): Record<string, string> {
  return {
    'src-tauri/tauri.conf.json': JSON.stringify({ productName: 'Sample App', identifier: 'app.example.sample_app', bundle: { iOS: { developmentTeam: TEAM } } }),
    'src-tauri/gen/apple/sample-shell.xcodeproj/project.pbxproj': `// !$*UTF8*$!\n{\n\t\t\t${RUST_STEP}\n}\n`,
    'src-tauri/gen/apple/build/arm64-sim/Sample App.app/Info.plist': '',
    'src-tauri/gen/apple/build/arm64/sample-shell.ipa': '',
  };
}

function write(folder: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

/** A provisioning profile as `security cms -D` prints it: its app id and the phones it holds, if any. */
function profile(appId: string, devices?: string[]): string {
  const held = devices ? `\t<key>ProvisionedDevices</key>\n\t<array>\n${devices.map((d) => `\t\t<string>${d}</string>`).join('\n')}\n\t</array>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Entitlements</key>
\t<dict>
\t\t<key>application-identifier</key>
\t\t<string>${appId}</string>
\t\t<key>get-task-allow</key>
\t\t<true/>
\t</dict>
\t<key>Name</key>
\t<string>iOS Team Provisioning Profile</string>
${held}\t<key>TeamIdentifier</key>
\t<array>
\t\t<string>${appId.split('.')[0]}</string>
\t</array>
</dict>
</plist>
`;
}

function addProfile(name: string, text: string) {
  write(home, { [`${PROFILES}/${name}.mobileprovision`]: text });
}

type Stand = { registers?: boolean; build?: number; launch?: number; quiet?: 0 | 1; create?: number };

/** Stand-ins for Apple's tools and Tauri, recording each call; the sound step is recorded among them. */
function apple(stand: Stand = {}) {
  const answer: Answer = (command) => {
    const line = command.join(' ');
    if (line === 'xcrun simctl list devices -j') return ok(fixture('simctl-devices.json'));
    if (line.startsWith('xcrun simctl create ')) return stand.create ? exit(stand.create, 'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=403):\nIncompatible device') : ok(`${NEW_SIMULATOR}\n`);
    if (line.startsWith('bunx tauri ios build')) return stand.build ? exit(stand.build, 'error: could not compile `sample-app`') : ok('    Finished `debug` profile\n');
    if (/^xcrun simctl (bootstatus|terminate|install|launch) /.test(line)) return ok();
    if (line.startsWith('xcrun devicectl list devices')) {
      writeFileSync(command[command.indexOf('--json-output') + 1], fixture('devicectl-devices.json'));
      return ok();
    }
    if (command[0] === 'security') return ok(readFileSync(command.at(-1)!, 'utf8'));
    if (command[0] === 'xcodebuild') {
      const scheme = command[command.indexOf('-scheme') + 1];
      if (scheme !== 'sample-shell_iOS') return exit(65, `xcodebuild: error: The project does not contain a scheme named "${scheme}".`);
      if (stand.registers) addProfile('registered', profile(`${TEAM}.${BUNDLE}`, [PHONE]));
      return exit(65, "error: Rust build step can only run under Tauri\n** BUILD FAILED **");
    }
    if (line.startsWith('xcrun devicectl device install app')) return ok('App installed:\n');
    if (line.startsWith('xcrun devicectl device process launch')) {
      return stand.launch ? exit(stand.launch, 'ERROR: The application failed to launch. (com.apple.dt.CoreDeviceError error 10002.)\n   BSErrorCodeDescription = Locked') : ok('Launched application');
    }
    return undefined;
  };
  const runner = standInRunner(answer, ['git', 'plutil']);
  const quiet = (udid: string) => {
    runner.calls.push({ command: ['quiet', udid], options: {} });
    return stand.quiet ? { code: 1 as const, line: '[iphone-simulator] the simulator did not boot again after the restart for its sound' } : { code: 0 as const, line: '[iphone-simulator] simulator sound already goes to BlackHole (silent)' };
  };
  return { ...runner, quiet };
}

async function runIn(cwd: string, stand: ReturnType<typeof apple>, options: Partial<IphoneRunOptions> & Pick<IphoneRunOptions, 'target'>) {
  const printed: string[] = [];
  const code = await runIphone({
    cwd,
    run: stand.run,
    quiet: stand.quiet,
    env: { PATH: '/usr/bin:/bin', HOME: home, FORCE_COLOR: '3' },
    home,
    print: (line) => printed.push(line),
    fail: (line) => printed.push(`! ${line}`),
    output: () => {},
    ...options,
  });
  // What ran, as words, without the stand-in's scratch paths.
  const calls = stand.calls.map((c) => c.command.join(' ').replaceAll(cwd, '<app>').replaceAll(home, '<home>'));
  return { code, printed, calls };
}

beforeEach(() => {
  place = scratch('iphone-run-');
  app = join(place.folder, 'app');
  home = join(place.folder, 'home');
  // A checkout of its own: the scratch folder is inside the kit's, which can be a linked worktree.
  repository(app, appFiles());
  mkdirSync(home);
});

afterEach(() => place.done());

describe('iphone run sim', () => {
  test("finds the checkout's Simulator, builds, quiets it before the boot, then stops the old copy, installs and starts it", async () => {
    const stand = apple();
    const { code, printed, calls } = await runIn(app, stand, { target: 'sim' });
    expect(code).toBe(0);
    expect(calls.filter((c) => !c.startsWith('git '))).toEqual([
      'xcrun simctl list devices -j',
      'bunx tauri ios build --debug --target aarch64-sim',
      `quiet ${SIMULATOR}`,
      `xcrun simctl bootstatus ${SIMULATOR} -b`,
      `xcrun simctl terminate ${SIMULATOR} ${BUNDLE}`,
      `xcrun simctl install ${SIMULATOR} <app>/src-tauri/gen/apple/build/arm64-sim/Sample App.app`,
      `xcrun simctl launch ${SIMULATOR} ${BUNDLE}`,
    ]);
    expect(printed).toEqual([
      `using the Simulator "Sample App" (${SIMULATOR})`,
      '[iphone-simulator] simulator sound already goes to BlackHole (silent)',
      `running in the Simulator ${SIMULATOR}`,
      `screenshot: xcrun simctl io ${SIMULATOR} screenshot <file.png>`,
    ]);
  });

  test('every build runs with no FORCE_COLOR, with Rust first on its PATH', async () => {
    const stand = apple();
    await runIn(app, stand, { target: 'sim' });
    const builds = stand.named('tauri ios build');
    expect(builds).toHaveLength(1);
    expect(builds[0].options.env?.FORCE_COLOR).toBeUndefined();
    expect(builds[0].options.env?.PATH).toBe(`${home}/.cargo/bin:/usr/bin:/bin`);
  });

  test("a linked worktree has a Simulator of its own, made once as an iPhone 17 with no runtime named, so simctl picks one that runs it", async () => {
    const worktree = join(place.folder, 'feature-x');
    git(app, 'worktree', 'add', '-q', worktree);
    const stand = apple();
    const { code, printed, calls } = await runIn(worktree, stand, { target: 'sim' });
    expect(code).toBe(0);
    expect(calls).toContain(`xcrun simctl create Sample App (feature-x) ${DEVICE_TYPE}`);
    expect(stand.named('simctl create')[0].command).toEqual(['xcrun', 'simctl', 'create', 'Sample App (feature-x)', DEVICE_TYPE]);
    expect(printed[0]).toBe(`made the Simulator "Sample App (feature-x)" (${NEW_SIMULATOR}), an iPhone 17 on the newest runtime that runs one`);
    expect(calls).toContain(`quiet ${NEW_SIMULATOR}`);
    // The app's main checkout keeps the plain name, and finds the device that has it.
    const fromMain = await runIn(app, apple(), { target: 'sim' });
    expect(fromMain.printed[0]).toBe(`using the Simulator "Sample App" (${SIMULATOR})`);
  });

  test("a Simulator simctl cannot make stops the run before the build, saying what to install", async () => {
    const worktree = join(place.folder, 'feature-y');
    git(app, 'worktree', 'add', '-q', worktree);
    const { code, printed, calls } = await runIn(worktree, apple({ create: 1 }), { target: 'sim' });
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe('! could not make the Simulator "Sample App (feature-y)": Incompatible device. Install an iOS Simulator runtime that runs the iPhone 17 in Xcode, Settings, Components.');
    expect(calls.some((c) => c.startsWith('bunx'))).toBe(false);
  });

  test('a udid picks the Simulator and skips the lookup', async () => {
    const { code, calls } = await runIn(app, apple(), { target: 'sim', udid: 'SCRATCH-UDID' });
    expect(code).toBe(0);
    expect(calls.some((c) => c.startsWith('xcrun simctl list') || c.startsWith('xcrun simctl create'))).toBe(false);
    expect(calls.slice(1, 3)).toEqual(['quiet SCRATCH-UDID', 'xcrun simctl bootstatus SCRATCH-UDID -b']);
  });

  test('a failed build stops before the Simulator is touched, and a failed sound step before the boot', async () => {
    const failedBuild = await runIn(app, apple({ build: 1 }), { target: 'sim' });
    expect(failedBuild.code).toBe(1);
    expect(failedBuild.printed.at(-1)).toBe('! the Simulator build failed; its output is above');
    expect(failedBuild.calls.at(-1)).toBe('bunx tauri ios build --debug --target aarch64-sim');

    const failedQuiet = await runIn(app, apple({ quiet: 1 }), { target: 'sim' });
    expect(failedQuiet.code).toBe(1);
    expect(failedQuiet.printed.at(-1)).toBe('! [iphone-simulator] the simulator did not boot again after the restart for its sound');
    expect(failedQuiet.calls.at(-1)).toBe(`quiet ${SIMULATOR}`);
  });
});

describe('iphone run phone', () => {
  test('a phone already in a profile for the app is built for, installed on and started on, with no Xcode build of its own', async () => {
    // The team's catch-all profile holds the phone; a distribution profile, with no devices, and another team's are passed over.
    addProfile('distribution', profile(`${TEAM}.${BUNDLE}`));
    addProfile('other-team', profile(`OTHERTEAM1.${BUNDLE}`, [PHONE]));
    addProfile('catch-all', profile(`${TEAM}.*`, [PHONE]));
    const stand = apple();
    const { code, printed, calls } = await runIn(app, stand, { target: 'phone' });
    expect(code).toBe(0);
    expect(calls.filter((c) => !c.startsWith('security') && !c.startsWith('plutil'))).toEqual([
      expect.stringMatching(/^xcrun devicectl list devices --omit-deprecated-fields-in-json --json-output \S+\/devices\.json$/),
      'bunx tauri ios build --debug --export-method debugging',
      `xcrun devicectl device install app --device ${PHONE} <app>/src-tauri/gen/apple/build/arm64/sample-shell.ipa`,
      `xcrun devicectl device process launch --device ${PHONE} ${BUNDLE}`,
    ]);
    expect(printed).toEqual([`using Test iPhone (${PHONE})`, `Test iPhone is in a development profile for ${BUNDLE}`, `running on Test iPhone (${PHONE})`]);
    // plutil printed what it extracted rather than writing it to a file named "-".
    expect(existsSync(join(app, '-'))).toBe(false);
  });

  test("a phone in no profile gets one Xcode build for it, with the project's scheme and no FORCE_COLOR, then the check again", async () => {
    const stand = apple({ registers: true });
    const { code, printed } = await runIn(app, stand, { target: 'phone' });
    expect(code).toBe(0);
    const [registration] = stand.named('xcodebuild');
    expect(registration.command).toEqual([
      'xcodebuild',
      '-project',
      'sample-shell.xcodeproj',
      '-scheme',
      'sample-shell_iOS',
      '-configuration',
      'debug',
      '-destination',
      `id=${PHONE}`,
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      'build',
    ]);
    expect(registration.options.cwd).toBe(join(app, 'src-tauri/gen/apple'));
    expect(registration.options.env?.FORCE_COLOR).toBeUndefined();
    expect(printed.slice(1, 3)).toEqual([
      `adding Test iPhone to the team's development profile for ${BUNDLE}: one Xcode build for the phone, which stops at the Rust step`,
      `Test iPhone is now in a development profile for ${BUNDLE}`,
    ]);
    expect(stand.named('tauri ios build')).toHaveLength(1);
  });

  test("when Xcode does not add the phone, the run stops before the build and asks after Xcode's account", async () => {
    const stand = apple();
    const { code, printed } = await runIn(app, stand, { target: 'phone' });
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe("! Xcode did not add Test iPhone to a development profile (** BUILD FAILED **): is Xcode signed in to the team, in Xcode, Settings, Accounts?");
    expect(stand.named('tauri ios build')).toHaveLength(0);
  });

  test('an app that does not open after a good install says so, with the unlock hint, and exits 1', async () => {
    addProfile('app', profile(`${TEAM}.${BUNDLE}`, [PHONE]));
    const { code, printed } = await runIn(app, apple({ launch: 1 }), { target: 'phone' });
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe('! installed sample-shell.ipa on Test iPhone, but it did not open: BSErrorCodeDescription = Locked. A locked phone opens nothing: unlock it and open the app.');
  });

  test('a udid picks the phone and skips the listing', async () => {
    addProfile('app', profile(`${TEAM}.${BUNDLE}`, ['OTHER-PHONE']));
    const { code, calls } = await runIn(app, apple(), { target: 'phone', udid: 'OTHER-PHONE' });
    expect(code).toBe(0);
    expect(calls.some((c) => c.includes('devicectl list'))).toBe(false);
    expect(calls.at(-1)).toBe(`xcrun devicectl device process launch --device OTHER-PHONE ${BUNDLE}`);
  });
});

describe('the pure parts', () => {
  test("the app's names come from its Tauri config, the iOS one over it, and its one Xcode project", () => {
    expect(readApp(app)).toEqual({ name: 'Sample App', bundleId: BUNDLE, team: TEAM, project: 'sample-shell' });
    write(app, { 'src-tauri/tauri.ios.conf.json': JSON.stringify({ identifier: 'app.example.ios', bundle: { iOS: { developmentTeam: 'TEAM000001' } } }) });
    expect(readApp(app)).toMatchObject({ bundleId: 'app.example.ios', team: 'TEAM000001' });
    expect(readApp(join(place.folder, 'nowhere'))).toContain("run this from a Tauri app's checkout");
  });

  test('the paired iPhones, connected ones first, without Simulators or iPads', () => {
    expect(pairedPhones(fixture('devicectl-devices.json'))).toEqual([
      { udid: PHONE, name: 'Test iPhone', connected: true },
      { udid: '00008100-0000000000000001', name: 'Old Test iPhone', connected: false },
    ]);
  });

  test("a terminal's FORCE_COLOR written into the Rust build step is found; the placeholder and Tauri's own flag are not", () => {
    expect(colorWrittenIn(RUST_STEP)).toBeNull();
    expect(colorWrittenIn(RUST_STEP.replace('${FORCE_COLOR}', '--force-color'))).toBeNull();
    expect(colorWrittenIn(RUST_STEP.replace('${FORCE_COLOR}', '3'))).toBe('3');
  });

  test('a project with the value written in is refused before anything runs, naming the line to fix', async () => {
    const pbxproj = 'src-tauri/gen/apple/sample-shell.xcodeproj/project.pbxproj';
    writeFileSync(join(app, pbxproj), readFileSync(join(app, pbxproj), 'utf8').replace('${FORCE_COLOR}', '3'));
    const stand = apple();
    const { code, printed } = await runIn(app, stand, { target: 'sim' });
    expect(code).toBe(1);
    expect(printed).toEqual([
      `! ${pbxproj}'s Rust build step passes "3" where it should say \${FORCE_COLOR}: a terminal's FORCE_COLOR was written in when the project was made again, and Tauri reads it as a chip architecture. Put \${FORCE_COLOR} back before \${ARCHS:?} and commit it.`,
    ]);
    expect(stand.calls).toEqual([]);
  });
});

test('stopped by a signal, as Ctrl-C stops it, the command stops the build it started', async () => {
  const marker = join(place.folder, 'hang-build');
  cpSync(app, join(place.folder, 'child-app'), { recursive: true });
  const stopped = await runCommand(['bun', join(import.meta.dir, 'iphone-run-child.ts'), join(place.folder, 'child-app'), marker], {
    output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
  });
  expect(stopped.timedOut).toBe(true);
  expect(stopped.out).toContain('[iphone] stopped by SIGTERM; stopping the programs it started');
  // The hanging build was in a process group of its own, out of reach of the signal to the command's.
  expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
});
