/*
 * `app-kit android run emulator`: builds a Tauri app's Android app from the checkout it runs in and starts it on an
 * Android emulator that opens no window and plays no sound, the Android half of `app-kit iphone run sim`.
 * - The tools come from fleet's machine setup: ANDROID_HOME (the SDK, with its emulator and adb), NDK_HOME and
 *   JAVA_HOME, and Rust's Android target. The run names any the shell lacks before it builds.
 * - Every checkout shares one emulator image, `app-kit`, made once from the system image fleet installs, on the
 *   Android version Google Play asks new apps to target, with Google Play and Chrome on it. Each run starts it
 *   read-only, so two runs at once never write over each other and the image stays as made: the app's data, a
 *   signed-in browser and all, is gone when the emulator shuts down.
 * - The debug build, for the 64-bit ARM emulator alone, signs with Android's debug key; nothing in 1Password.
 * - A page on this Mac's localhost (the shell's TAURI_PAGE_ADDRESS, read as the build reads it, and each --reverse
 *   port) is reached from the emulator through adb reverse, so the app keeps its own address for it.
 * - Before the boot the run takes one of two places on the Mac and gives the emulator a shut-down time and a watcher
 *   (./lifetime.ts); a run that fails after the start, or is stopped, shuts it down itself.
 * Every outside program goes through the kit's runner (command-line/run.ts), each in a process group of its own,
 * so a stop by Ctrl-C stops those groups too.
 *
 * Exit codes: 0 running; 1 anything else.
 */
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildEnv, type Env } from '../build-env.ts';
import { androidProblem } from '../play/upload.ts';
import { ANDROID_PROJECT, readApp } from '../play/app.ts';
import { alive, stateFolder } from '../state.ts';
import { lastLine } from '../testflight/key.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';
import { clock, emulatorOutput, type Lifetime, MINUTES, release, releaseNow, setTime, startEmulator, takePlace } from './lifetime.ts';

/** The one emulator image every run starts. */
export const AVD = 'app-kit';
/** The system image it is made from, which fleet's machine setup installs. */
export const SYSTEM_IMAGE = 'system-images;android-36;google_apis_playstore;arm64-v8a';
/** The phone it is shaped as. */
export const DEVICE = 'pixel_7';
/** Where the debug build leaves its app. */
export const APK_FOLDER = `${ANDROID_PROJECT}/app/build/outputs/apk`;
/** The README's section that tells an agent how to tap and look at the app it just started. */
export const TESTING_SECTION = 'Testing the Android app yourself';
/** How long the emulator has to finish booting, in milliseconds. */
const BOOT_MS = 5 * 60_000;
const BOOT_EVERY_MS = 2_000;

export type AndroidRunOptions = {
  /** The app's checkout. */
  cwd: string;
  /** Ports on this Mac the emulator reaches as its own localhost, besides the page's. */
  reverse?: number[];
  run?: Run;
  env?: Env;
  home?: string;
  print?: (line: string) => void;
  fail?: (line: string) => void;
  /** The build's own output as it comes. */
  output?: (chunk: string) => void;
  /** The emulator's shut-down time and place: its state folder, clock and watcher, which tests replace. */
  lifetime?: Partial<Lifetime>;
};

/** The SDK's programs, by their full paths, so a shell whose PATH lacks them runs them all the same. */
export function tools(env: Env): { adb: string; emulator: string; avdmanager: string } {
  const sdk = env.ANDROID_HOME ?? '';
  return { adb: join(sdk, 'platform-tools/adb'), emulator: join(sdk, 'emulator/emulator'), avdmanager: join(sdk, 'cmdline-tools/latest/bin/avdmanager') };
}

/** The ports on this Mac the page lives on, when its address is this Mac's own. */
export function localPorts(address: string | undefined, more: number[] = []): number[] {
  const ports = new Set(more);
  if (address) {
    try {
      const url = new URL(address);
      if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ports.add(Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
    } catch {
      // Not an address: the build says so.
    }
  }
  return [...ports];
}

/**
 * The APK the debug build writes. Tauri builds its one flavor, universal, even for one target, and the file is deleted
 * before each build, so what is installed is that build's and never one an earlier build left.
 */
export const DEBUG_APK = `${APK_FOLDER}/universal/debug/app-universal-debug.apk`;

/** The emulator a run holds a place for, which a stop by signal shuts down. */
type Holding = { current: { folder: string; serial: string } | null };

/**
 * Builds and starts the app, as the module's comment says. Stopped by a signal, it stops the programs it started, each
 * in a process group of its own that the terminal's Ctrl-C does not reach, shuts down the emulator it started, then
 * exits 1.
 */
export async function runAndroid(options: AndroidRunOptions): Promise<0 | 1> {
  const say = options.fail ?? ((line: string) => console.error(`[android] ${line}`));
  const holding: Holding = { current: null };
  const onSignal = (signal: NodeJS.Signals) => {
    say(`stopped by ${signal}; stopping the programs it started`);
    stopRunning('SIGTERM');
    stopRunning('SIGKILL');
    if (holding.current) {
      say(`shutting down the emulator ${holding.current.serial} it started`);
      releaseNow(holding.current.folder, holding.current.serial, `its run was stopped by ${signal}`);
    }
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await runSteps(options, holding);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
  }
}

async function runSteps(options: AndroidRunOptions, holding: Holding): Promise<0 | 1> {
  const { cwd } = options;
  const run = options.run ?? runCommand;
  const home = options.home ?? homedir();
  const print = options.print ?? ((line: string) => console.log(`[android] ${line}`));
  const say = options.fail ?? ((line: string) => console.error(`[android] ${line}`));
  const fail = (line: string): 1 => {
    say(line);
    return 1;
  };
  const output = options.output ?? ((chunk: string) => void process.stdout.write(chunk));
  const env = buildEnv(options.env ?? process.env, home);
  const sleep = options.lifetime?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.lifetime?.now ?? Date.now;

  const app = readApp(cwd);
  if (typeof app === 'string') return fail(app);
  const problem = androidProblem(cwd, env, { signed: false });
  if (problem) return fail(problem);
  const { adb, emulator, avdmanager } = tools(env);
  const id = app.packageName;

  const avds = await run([emulator, '-list-avds'], { env });
  if (avds.code !== 0) return fail(`could not list the emulator images (${lastLine(avds.out)}): the emulator comes from fleet's machine setup`);
  if (!avds.stdout.split('\n').map((line) => line.trim()).includes(AVD)) {
    // avdmanager asks whether to make a custom hardware profile; no keeps the phone's own.
    const made = await run([avdmanager, 'create', 'avd', '--name', AVD, '--package', SYSTEM_IMAGE, '--device', DEVICE], { env, input: 'no\n' });
    if (made.code !== 0) return fail(`could not make the emulator image "${AVD}" from ${SYSTEM_IMAGE}: ${lastLine(made.out)}. Fleet's machine setup installs that system image.`);
    print(`made the emulator image "${AVD}", a ${DEVICE} on ${SYSTEM_IMAGE}`);
  }

  const apk = join(cwd, DEBUG_APK);
  rmSync(apk, { force: true });
  const built = await run(['bunx', 'tauri', 'android', 'build', '--ci', '--debug', '--apk', '--target', 'aarch64'], { cwd, env, output });
  if (built.code !== 0) return fail('the Android build failed; its output is above');
  if (!existsSync(apk)) return fail(`the build made no ${DEBUG_APK}`);

  const lifetime: Lifetime = {
    folder: stateFolder('emulators', options.env ?? process.env, home),
    run: (command, more) => run(command[0] === 'adb' ? [adb, ...command.slice(1)] : command, { env, ...more }),
    print,
    ...options.lifetime,
  };
  let place;
  try {
    place = await takePlace(lifetime, cwd);
  } catch (error) {
    return fail(`could not take a place for the emulator: ${error instanceof Error ? error.message : String(error)}`);
  }
  if ('refused' in place) return fail(place.refused);
  const { serial, port } = place.held;
  holding.current = { folder: lifetime.folder, serial };
  const failed = async (line: string): Promise<1> => {
    await release(lifetime, serial, `its run failed: ${line}`);
    holding.current = null;
    say(line);
    say(`shut down the emulator ${serial}, since the run that started it failed`);
    return 1;
  };
  const started = startEmulator(lifetime, place.held, [emulator, '-avd', AVD, '-read-only', '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save', '-port', String(port)], env);
  print(`starting the emulator ${serial}, with no window`);
  const shell = (...args: string[]) => run([adb, '-s', serial, ...args], { env, timeoutMs: 120_000 });

  const giveUp = now() + BOOT_MS;
  for (;;) {
    const booted = await shell('shell', 'getprop', 'sys.boot_completed');
    if (booted.code === 0 && booted.stdout.trim() === '1') break;
    if (started.emulatorPid !== null && !(lifetime.alive ?? alive)(started.emulatorPid)) return failed(`the emulator quit as it started: ${lastLine(emulatorOutput(lifetime.folder, serial))}`);
    if (now() > giveUp) return failed(`the emulator ${serial} had not finished booting after ${BOOT_MS / 60_000} minutes: ${lastLine(emulatorOutput(lifetime.folder, serial))}`);
    await sleep(BOOT_EVERY_MS);
  }
  print(`the emulator ${serial} has booted`);

  const installed = await shell('install', '-r', apk);
  if (installed.code !== 0) return failed(`could not install ${apk} on the emulator: ${lastLine(installed.out)}`);
  for (const local of localPorts(env.TAURI_PAGE_ADDRESS, options.reverse)) {
    const reversed = await shell('reverse', `tcp:${local}`, `tcp:${local}`);
    if (reversed.code !== 0) return failed(`could not hand the emulator's localhost:${local} to this Mac's: ${lastLine(reversed.out)}`);
    print(`the emulator's localhost:${local} is this Mac's`);
  }
  const activity = await shell('shell', 'cmd', 'package', 'resolve-activity', '--brief', id);
  const component = lastLine(activity.stdout);
  if (activity.code !== 0 || !component.includes('/')) return failed(`installed ${id}, but Android names no activity that opens it: ${lastLine(activity.out)}`);
  const launched = await shell('shell', 'am', 'start', '-W', '-n', component);
  if (launched.code !== 0 || /Error/.test(launched.stdout)) return failed(`installed ${id}, but it did not open: ${lastLine(launched.out)}`);
  print(`running on the emulator ${serial}`);

  // The time counts from the app's start, not the place's.
  const timed = setTime(lifetime, serial);
  holding.current = null;
  if (timed) print(`the emulator shuts down at ${clock(timed.until)}, in ${MINUTES} minutes: app-kit android keep ${serial} moves it to ${MINUTES} minutes from then, and ${adb} -s ${serial} emu kill ends it when the check is done`);
  print(`screenshot: ${adb} -s ${serial} exec-out screencap -p > <file.png>`);
  print(`the app's log: ${adb} -s ${serial} logcat -d`);
  print(`to test it yourself, with no window: "${TESTING_SECTION}" in app-kit's README (node_modules/app-kit/README.md)`);
  return 0;
}
