// `app-kit iphone run sim|phone`: the Simulator path in order, its device found or made for the checkout, its place
// and shut-down time, and its shut-down when the run fails after the boot, the phone path with and without the phone in
// a development profile, the Xcode project with a terminal's FORCE_COLOR written in, and the stop by signal, against
// stand-ins for xcrun, bunx, xcodebuild and security; git and plutil are real. The listings are written by hand in the
// shape this Mac's Xcode 27.1 prints, with made-up names, ids and team.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { colorWrittenIn, DEVICE_TYPE, pairedPhones, readApp, runIphone, TESTING_SECTION, type IphoneRunOptions } from '../tauri/iphone-run/index.ts';
import { runCommand } from '../command-line/run.ts';
import { clock, readHeld } from '../tauri/iphone-simulator/lifetime.ts';
import { alive, stateFolder } from '../tauri/state.ts';
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
/** The clock every run here reads, so the printed shut-down time is known. */
const NOW = Date.UTC(2026, 10, 2, 14, 0);
/** The stand-in watcher's process id: a live one, this test's, so the run never starts another. */
const WATCHER = process.pid;
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

type Stand = {
  registers?: boolean;
  build?: number;
  launch?: number;
  quiet?: 0 | 1;
  create?: number;
  /** The Simulators booted when the run starts; the stand-in boots and shuts them down as simctl would. */
  booted?: string[];
  /** Simulators in no fixture, by udid and name, booted by someone else. */
  others?: Record<string, string>;
};

/** Stand-ins for Apple's tools and Tauri, recording each call; the sound step and the watcher are recorded among them. */
function apple(stand: Stand = {}) {
  const booted = new Set([...(stand.booted ?? []), ...Object.keys(stand.others ?? {})]);
  const listing = () => {
    const parsed = JSON.parse(fixture('simctl-devices.json')) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
    parsed.devices.others = Object.entries(stand.others ?? {}).map(([udid, name]) => ({ udid, name, state: 'Booted' }));
    for (const device of Object.values(parsed.devices).flat()) device.state = booted.has(device.udid) ? 'Booted' : 'Shutdown';
    return JSON.stringify(parsed);
  };
  const answer: Answer = (command) => {
    const line = command.join(' ');
    if (line === 'xcrun simctl list devices -j') return ok(listing());
    if (line.startsWith('xcrun simctl bootstatus ')) {
      booted.add(command[3]);
      return ok();
    }
    if (line.startsWith('xcrun simctl shutdown ')) {
      booted.delete(command[3]);
      return ok();
    }
    if (line.startsWith('xcrun simctl create ')) return stand.create ? exit(stand.create, 'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=403):\nIncompatible device') : ok(`${NEW_SIMULATOR}\n`);
    if (line.startsWith('bunx tauri ios build')) return stand.build ? exit(stand.build, 'error: could not compile `sample-app`') : ok('    Finished `debug` profile\n');
    if (line.startsWith('xcrun simctl launch ') && stand.launch) return exit(stand.launch, 'An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=4):\nThe request to open "app.example.sample-app" failed.');
    if (/^xcrun simctl (terminate|install|launch) /.test(line)) return ok();
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
  const startWatcher = (udid: string) => {
    runner.calls.push({ command: ['watcher', udid], options: {} });
    return WATCHER;
  };
  return { ...runner, quiet, startWatcher, booted };
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
    lifetime: { startWatcher: stand.startWatcher, now: () => NOW },
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
      // The place, counted after the build, then the watcher, before the sound step can boot it.
      'xcrun simctl list devices -j',
      `watcher ${SIMULATOR}`,
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
      `the Simulator shuts down at ${clock(NOW + 10 * 60_000)}, in 10 minutes: app-kit iphone-simulator keep ${SIMULATOR} gives it 10 more, and xcrun simctl shutdown ${SIMULATOR} ends it when the check is done`,
      `screenshot: xcrun simctl io ${SIMULATOR} screenshot <file.png>`,
      `to test it yourself, with no window: "${TESTING_SECTION}" in app-kit's README (node_modules/app-kit/README.md)`,
    ]);
    // Its shut-down time counts from the app's start, and the watcher holds it.
    expect(readHeld(stateFolder('simulators', {}, home), SIMULATOR)).toEqual({
      udid: SIMULATOR,
      name: 'Sample App',
      checkout: app,
      until: NOW + 10 * 60_000,
      runPid: process.pid,
      watcherPid: WATCHER,
      booted: true,
    });
  });

  test('an install or launch that fails after the boot shuts the Simulator down, and frees its place', async () => {
    const stand = apple({ launch: 1 });
    const { code, printed, calls } = await runIn(app, stand, { target: 'sim' });
    expect(code).toBe(1);
    expect(calls.at(-1)).toBe(`xcrun simctl shutdown ${SIMULATOR}`);
    expect(stand.booted.has(SIMULATOR)).toBe(false);
    expect(printed.slice(-2)).toEqual([
      '! installed Sample App.app, but it did not open: The request to open "app.example.sample-app" failed.',
      `! shut down the Simulator ${SIMULATOR}, since the run that booted it failed`,
    ]);
    expect(readHeld(stateFolder('simulators', {}, home), SIMULATOR)).toBeNull();
  });

  test('a Simulator already running, booted some other way, is used with no shut-down time and left running when the run fails', async () => {
    const stand = apple({ booted: [SIMULATOR], launch: 1 });
    const { code, calls } = await runIn(app, stand, { target: 'sim' });
    expect(code).toBe(1);
    expect(calls.some((c) => c.startsWith('watcher') || c.includes('simctl shutdown'))).toBe(false);
    expect(stand.booted.has(SIMULATOR)).toBe(true);

    const fine = await runIn(app, apple({ booted: [SIMULATOR] }), { target: 'sim' });
    expect(fine.code).toBe(0);
    expect(fine.printed).toContain(`the Simulator was running before this run, booted some other way, so app-kit gives it no shut-down time: xcrun simctl shutdown ${SIMULATOR} when the check is done`);
  });

  test('with two Simulators running that app-kit has no time for, the run stops before the boot and names them', async () => {
    const stand = apple({ others: { 'OTHER-1': 'Getter (design)', 'OTHER-2': 'Getter (ui)' } });
    const { code, printed, calls } = await runIn(app, stand, { target: 'sim' });
    expect(code).toBe(1);
    expect(printed.at(-1)).toBe(
      '! 2 Simulators are running, the most at once: "Getter (design)" (OTHER-1) with no shut-down time, booted without app-kit, "Getter (ui)" (OTHER-2) with no shut-down time, booted without app-kit. app-kit has no shut-down time for any of them, so waiting would not free a place: shut one down with xcrun simctl shutdown <udid> if it is yours, or run again once another thread has finished with its own',
    );
    expect(calls.some((c) => c.startsWith('quiet') || c.includes('bootstatus'))).toBe(false);
  });

  test('the section the run points an agent at is in the README', () => {
    const readme = readFileSync(join(import.meta.dir, '../README.md'), 'utf8');
    expect(readme).toContain(`\n#### ${TESTING_SECTION}\n`);
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

  test('a udid picks the Simulator and skips the lookup by name', async () => {
    const { code, calls } = await runIn(app, apple(), { target: 'sim', udid: 'SCRATCH-UDID' });
    expect(code).toBe(0);
    expect(calls.some((c) => c.startsWith('xcrun simctl create'))).toBe(false);
    // The one listing is the count of places, after the build.
    expect(calls.slice(0, 5)).toEqual([
      'bunx tauri ios build --debug --target aarch64-sim',
      'xcrun simctl list devices -j',
      'watcher SCRATCH-UDID',
      'quiet SCRATCH-UDID',
      'xcrun simctl bootstatus SCRATCH-UDID -b',
    ]);
  });

  test('a failed build stops before the Simulator is touched, and a failed sound step before the boot', async () => {
    const failedBuild = await runIn(app, apple({ build: 1 }), { target: 'sim' });
    expect(failedBuild.code).toBe(1);
    expect(failedBuild.printed.at(-1)).toBe('! the Simulator build failed; its output is above');
    expect(failedBuild.calls.at(-1)).toBe('bunx tauri ios build --debug --target aarch64-sim');

    const failedQuiet = await runIn(app, apple({ quiet: 1 }), { target: 'sim' });
    expect(failedQuiet.code).toBe(1);
    expect(failedQuiet.printed.at(-2)).toBe('! [iphone-simulator] the simulator did not boot again after the restart for its sound');
    // Whatever state the sound step left it in, the Simulator it took a place for is shut down.
    expect(failedQuiet.calls.slice(-2)).toEqual([`quiet ${SIMULATOR}`, `xcrun simctl shutdown ${SIMULATOR}`]);
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
  const stopped = await runCommand(['bun', join(import.meta.dir, 'iphone-run-child.ts'), join(place.folder, 'child-app'), marker, 'build'], {
    env: simulatorTools(),
    output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
  });
  expect(stopped.timedOut).toBe(true);
  expect(stopped.out).toContain('[iphone] stopped by SIGTERM; stopping the programs it started');
  // The hanging build was in a process group of its own, out of reach of the signal to the command's.
  expect(Bun.spawnSync(['pgrep', '-f', marker]).stdout.toString()).toBe('');
  // Stopped before its place, it booted nothing and so shuts nothing down.
  expect(xcrunCalls()).toEqual([]);
});

/**
 * The environment for a run as a process of its own: a stand-in xcrun first on PATH, which writes each call to a file
 * and lists SCRATCH-UDID as booted, and the state folder in the scratch folder.
 */
function simulatorTools(): Record<string, string | undefined> {
  const bin = join(place.folder, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(place.folder, 'listing.json'), JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ name: 'Sample App', udid: 'SCRATCH-UDID', state: 'Booted' }] } }));
  writeFileSync(
    join(bin, 'xcrun'),
    `#!/bin/sh\necho "$*" >> "${join(place.folder, 'xcrun-calls')}"\n[ "$*" = "simctl list devices -j" ] && cat "${join(place.folder, 'listing.json')}"\nexit 0\n`,
  );
  chmodSync(join(bin, 'xcrun'), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(place.folder, 'state') };
}

const xcrunCalls = () => (existsSync(join(place.folder, 'xcrun-calls')) ? readFileSync(join(place.folder, 'xcrun-calls'), 'utf8').trim().split('\n') : []);
const simulatorsLog = () => readFileSync(join(place.folder, 'state/app-kit/simulators/simulators.log'), 'utf8');
/** The watcher's process id, from the line the run logged when it started it. */
const watcherPid = () => Number(simulatorsLog().match(/watcher (\d+)/)?.[1]);

/** Waits for a fact another process makes true; the test's own time limit is the bound. */
async function until(fact: () => boolean) {
  while (!fact()) await Bun.sleep(20);
}

describe('a run that ends after the boot', () => {
  test('stopped by a signal, it shuts down the Simulator it booted, and its watcher goes', async () => {
    const marker = join(place.folder, 'hang-install');
    cpSync(app, join(place.folder, 'child-app'), { recursive: true });
    const stopped = await runCommand(['bun', join(import.meta.dir, 'iphone-run-child.ts'), join(place.folder, 'child-app'), marker, 'install'], {
      env: simulatorTools(),
      output: (chunk) => (chunk.includes(`hanging ${marker}`) ? 0 : undefined),
    });
    expect(stopped.timedOut).toBe(true);
    expect(stopped.out).toContain('[iphone] shutting down the Simulator SCRATCH-UDID it booted');
    expect(xcrunCalls()).toContain('simctl shutdown SCRATCH-UDID');
    expect(simulatorsLog()).toContain('"SCRATCH-UDID" (SCRATCH-UDID): shut down, its run was stopped by SIGTERM');
    expect(readHeld(join(place.folder, 'state/app-kit/simulators'), 'SCRATCH-UDID')).toBeNull();
    // With the file gone, the watcher has nothing to do and ends.
    const pid = watcherPid();
    await until(() => !alive(pid));
  });

  test('killed outright, its Simulator is shut down by the watcher once its checkout is deleted', async () => {
    const marker = join(place.folder, 'hang-install');
    const checkout = join(place.folder, 'child-app');
    cpSync(app, checkout, { recursive: true });
    const child = Bun.spawn(['bun', join(import.meta.dir, 'iphone-run-child.ts'), checkout, marker, 'install'], { env: simulatorTools(), stdout: 'pipe', stderr: 'pipe' });
    let said = '';
    const reader = child.stdout.getReader();
    while (!said.includes(`hanging ${marker}`)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`the run ended before the install: ${said}`);
      said += new TextDecoder().decode(value);
    }
    child.kill('SIGKILL');
    await child.exited;
    // Nothing of the run is left to shut it down: the watcher, in a session of its own, still runs.
    const pid = watcherPid();
    expect(alive(pid)).toBe(true);
    expect(xcrunCalls()).not.toContain('simctl shutdown SCRATCH-UDID');
    rmSync(checkout, { recursive: true, force: true });
    await until(() => xcrunCalls().includes('simctl shutdown SCRATCH-UDID'));
    await until(() => !alive(pid));
    expect(simulatorsLog()).toContain(`shut down by its watcher, its checkout ${checkout} is gone`);
    expect(readHeld(join(place.folder, 'state/app-kit/simulators'), 'SCRATCH-UDID')).toBeNull();
  });
});
