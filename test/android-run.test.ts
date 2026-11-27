// `app-kit android run emulator` and its emulators' lifetime, against a stand-in for every Android program: the build,
// avdmanager, the emulator and adb, with a fake clock and fake process ids, so no emulator starts.
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run, RunResult } from '../command-line/run.ts';
import { applicationId, AVD, DEBUG_APK, localPorts, runAndroid, SYSTEM_IMAGE } from '../tauri/android-run/index.ts';
import { type Held, keep, type Lifetime, MOST_MINUTES, readHeld, takePlace, watchEmulator } from '../tauri/android-run/lifetime.ts';

const done = (stdout = '', code = 0): RunResult => ({ code, out: stdout, stdout, stderr: '', timedOut: false });
const SDK = '/sdk';

/** A clock that moves only when the code sleeps, and process ids that are alive until a test says otherwise. */
function machine() {
  const state = { time: Date.parse('2026-11-27T10:00:00'), dead: new Set<number>() };
  const lifetime = (folder: string, more: Partial<Lifetime> = {}): Lifetime => ({
    folder,
    now: () => state.time,
    sleep: async (ms) => void (state.time += ms),
    alive: (pid) => !state.dead.has(pid),
    kill: (pid) => void state.dead.add(pid),
    startWatcher: () => 7000,
    pid: 9000,
    ...more,
  });
  return { state, lifetime };
}

/** A Tauri app's checkout with an Android project, as `tauri android init` leaves one. */
function checkout(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'android-run-'));
  mkdirSync(join(cwd, 'src-tauri/gen/android/app'), { recursive: true });
  writeFileSync(join(cwd, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'Fixture', identifier: 'com.example.fixture-app' }));
  writeFileSync(join(cwd, 'src-tauri/gen/android/app/build.gradle.kts'), 'android {\n    defaultConfig {\n        applicationId = "com.example.fixture_app"\n    }\n}\n');
  return cwd;
}

const ENV = { ANDROID_HOME: SDK, NDK_HOME: `${SDK}/ndk`, JAVA_HOME: '/java', PATH: '/usr/bin', TAURI_PAGE_ADDRESS: 'http://localhost:4123/' };

/** What the debug build writes, as the fake build makes it. */
function buildApk(cwd: string) {
  mkdirSync(join(cwd, 'src-tauri/gen/android/app/build/outputs/apk/universal/debug'), { recursive: true });
  writeFileSync(join(cwd, DEBUG_APK), 'apk');
}

test('an APK an earlier build left is never installed: a build that writes none fails, naming the file', async () => {
  const cwd = checkout();
  buildApk(cwd);
  const calls: string[] = [];
  const printed: string[] = [];
  const run: Run = async (command) => {
    calls.push(command.join(' '));
    if (command.join(' ').endsWith('-list-avds')) return done(`${AVD}\n`);
    return done();
  };
  const { lifetime } = machine();
  const code = await runAndroid({ cwd, run, env: ENV, home: cwd, print: () => {}, fail: (line) => printed.push(line), output: () => {}, lifetime: lifetime(join(cwd, 'state')) });
  expect(code).toBe(1);
  expect(printed).toEqual([`the build made no ${DEBUG_APK}`]);
  expect(calls.some((line) => line.includes(' install '))).toBe(false);
  rmSync(cwd, { recursive: true, force: true });
});

test('builds the app, makes the shared image once, boots an emulator with no window, opens the app and gives it ten minutes', async () => {
  const cwd = checkout();
  const folder = join(cwd, 'state');
  const { state, lifetime } = machine();
  const calls: string[] = [];
  let bootPolls = 0;
  const run: Run = async (command) => {
    const line = command.join(' ').replaceAll(SDK, '$SDK');
    calls.push(line);
    if (line === '$SDK/emulator/emulator -list-avds') return done('Pixel_8\n');
    if (line.startsWith('bunx tauri android build')) buildApk(cwd);
    if (line === '$SDK/platform-tools/adb devices') return done('List of devices attached\nemulator-5554\tdevice\n\n');
    if (line.endsWith('getprop sys.boot_completed')) return done(++bootPolls < 3 ? '' : '1\n', bootPolls < 2 ? 1 : 0);
    if (line.includes('resolve-activity')) return done('priority=0 preferredOrder=0\ncom.example.fixture_app/.MainActivity\n');
    if (line.includes('am start')) return done('Status: ok\nLaunchState: COLD\n');
    return done();
  };
  const printed: string[] = [];
  let started: string[] = [];
  const code = await runAndroid({
    cwd,
    run,
    env: ENV,
    home: cwd,
    print: (line) => printed.push(line),
    fail: (line) => printed.push(`failed: ${line}`),
    output: () => {},
    reverse: [4124],
    lifetime: lifetime(folder, {
      spawn: (command) => {
        started = command;
        return 8000;
      },
    }),
  });
  expect(printed.filter((line) => line.startsWith('failed'))).toEqual([]);
  expect(code).toBe(0);
  expect(calls).toContain(`$SDK/cmdline-tools/latest/bin/avdmanager create avd --name ${AVD} --package ${SYSTEM_IMAGE} --device pixel_7`);
  expect(calls).toContain('bunx tauri android build --ci --debug --apk --target aarch64');
  // 5554 is an emulator started some other way, so the run takes the next port.
  expect(started).toEqual(['$SDK/emulator/emulator', '-avd', AVD, '-read-only', '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save', '-port', '5556'].map((part) => part.replace('$SDK', SDK)));
  const adb = calls.filter((line) => line.startsWith('$SDK/platform-tools/adb -s emulator-5556')).map((line) => line.slice('$SDK/platform-tools/adb -s emulator-5556 '.length));
  expect(adb.filter((line) => !line.includes('boot_completed'))).toEqual([
    `install -r ${join(cwd, 'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk')}`,
    'reverse tcp:4124 tcp:4124',
    'reverse tcp:4123 tcp:4123',
    'shell cmd package resolve-activity --brief com.example.fixture_app',
    'shell am start -W -n com.example.fixture_app/.MainActivity',
  ]);
  const held = readHeld(folder, 'emulator-5556')!;
  expect(held).toMatchObject({ checkout: cwd, emulatorPid: 8000, watcherPid: 7000, until: state.time + 10 * 60_000 });
  expect(printed).toContain(`screenshot: ${SDK}/platform-tools/adb -s emulator-5556 exec-out screencap -p > <file.png>`);
  rmSync(cwd, { recursive: true, force: true });
});

test('an emulator that quits as it boots is let go, its place freed, and the reason named', async () => {
  const cwd = checkout();
  const folder = join(cwd, 'state');
  const { state, lifetime } = machine();
  const run: Run = async (command) => {
    if (command.join(' ').startsWith('bunx tauri android build')) buildApk(cwd);
    if (command.join(' ').endsWith('-list-avds')) return done(`${AVD}\n`);
    if (command.join(' ').endsWith('boot_completed')) {
      state.dead.add(8000);
      return done('', 1);
    }
    return done();
  };
  const printed: string[] = [];
  const code = await runAndroid({
    cwd,
    run,
    env: ENV,
    home: cwd,
    print: () => {},
    fail: (line) => printed.push(line),
    output: () => {},
    lifetime: lifetime(folder, { spawn: () => 8000 }),
  });
  expect(code).toBe(1);
  expect(printed[0]).toStartWith('the emulator quit as it started');
  expect(readHeld(folder, 'emulator-5554')).toBeNull();
  rmSync(cwd, { recursive: true, force: true });
});

test('names the Android tools a shell lacks before building anything', async () => {
  const cwd = checkout();
  const calls: string[] = [];
  const printed: string[] = [];
  const code = await runAndroid({ cwd, run: async (command) => (calls.push(command.join(' ')), done()), env: { PATH: '/usr/bin' }, home: cwd, fail: (line) => printed.push(line) });
  expect(code).toBe(1);
  expect(printed[0]).toContain('this shell has no ANDROID_HOME, NDK_HOME, JAVA_HOME');
  expect(calls).toEqual([]);
  rmSync(cwd, { recursive: true, force: true });
});

test('two emulators at once: a third run waits for a place, and fails naming both once they are past their time', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'emulators-'));
  const { state, lifetime } = machine();
  const run: Run = async () => done('List of devices attached\n');
  const first = await takePlace(lifetime(folder, { run, pid: 1 }), '/one');
  const second = await takePlace(lifetime(folder, { run, pid: 2 }), '/two');
  expect([first, second].map((place) => ('held' in place ? place.held.serial : place.refused))).toEqual(['emulator-5554', 'emulator-5556']);
  const told: string[] = [];
  const third = await takePlace(lifetime(folder, { run, pid: 3, print: (line) => told.push(line) }), '/three');
  expect(told[0]).toContain('2 emulators already run');
  expect('refused' in third && third.refused).toContain('emulator-5554 (/one');
  // A run that died before starting its emulator holds no place.
  state.dead.add(1);
  const fourth = await takePlace(lifetime(folder, { run, pid: 4 }), '/four');
  expect('held' in fourth && fourth.held.serial).toBe('emulator-5554');
  rmSync(folder, { recursive: true, force: true });
});

test('keep moves the shut-down time, at most thirty minutes on', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'emulators-'));
  const { state, lifetime } = machine();
  const place = await takePlace(lifetime(folder, { run: async () => done() }), folder);
  const serial = 'held' in place ? place.held.serial : '';
  expect((await keep(lifetime(folder), serial, 90))?.until).toBe(state.time + MOST_MINUTES * 60_000);
  expect(await keep(lifetime(folder), 'emulator-5600')).toBeNull();
  rmSync(folder, { recursive: true, force: true });
});

test('the watcher asks the emulator to quit at its time, kills it when it will not, and forgets it once someone else shut it down', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'emulators-'));
  const { state, lifetime } = machine();
  const asked: string[] = [];
  const place = async (pid: number, checkout: string): Promise<Held> => {
    const taken = await takePlace(lifetime(folder, { run: async () => done(), pid }), checkout);
    if (!('held' in taken)) throw new Error(taken.refused);
    const held = { ...taken.held, emulatorPid: pid + 100, watcherPid: pid + 200 };
    writeFileSync(join(folder, `${held.serial}.json`), JSON.stringify(held));
    return held;
  };
  const stubborn = await place(1, folder);
  const watched = watchEmulator(lifetime(folder, { run: async (command) => (asked.push(command.join(' ')), done()), pid: 201 }), stubborn.serial);
  expect(await watched).toBe('shut down');
  expect(asked).toEqual([`adb -s ${stubborn.serial} emu kill`]);
  expect(state.dead.has(101)).toBe(true);
  expect(existsSync(join(folder, `${stubborn.serial}.json`))).toBe(false);

  const goneCheckout = mkdtempSync(join(tmpdir(), 'checkout-'));
  const orphan = await place(2, goneCheckout);
  rmSync(goneCheckout, { recursive: true });
  expect(await watchEmulator(lifetime(folder, { run: async () => (state.dead.add(102), done()), pid: 202 }), orphan.serial)).toBe('shut down');

  const ended = await place(3, folder);
  state.dead.add(103);
  expect(await watchEmulator(lifetime(folder, { run: async () => done(), pid: 203 }), ended.serial)).toBe('nothing to do');
  rmSync(folder, { recursive: true, force: true });
});

test("the page's port on this Mac's localhost, and the Android app's id from its gradle file", () => {
  expect(localPorts('http://localhost:5173/app', [9000])).toEqual([9000, 5173]);
  expect(localPorts('https://app.example.com/')).toEqual([]);
  expect(localPorts(undefined)).toEqual([]);
  const cwd = checkout();
  expect(applicationId(cwd, 'com.example.fixture-app')).toBe('com.example.fixture_app');
  rmSync(join(cwd, 'src-tauri/gen/android/app/build.gradle.kts'));
  expect(applicationId(cwd, 'com.example.other-app')).toBe('com.example.other_app');
  rmSync(cwd, { recursive: true, force: true });
});
