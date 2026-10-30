/*
 * `app-kit iphone run sim|phone`: builds a Tauri app's iPhone app from the checkout it runs in and starts it on an
 * iPhone Simulator that opens no window and plays no sound, or on the iPhone paired with this Mac. It replaces the
 * scripts/iphone.sh each app carried, and holds what they learned:
 * - Every build and Xcode call runs in the shared build environment (../build-env.ts), which drops a terminal's
 *   FORCE_COLOR; and since an Xcode project regenerated outside the kit can already have the value written into its
 *   Rust build step, a project holding one is refused before the build, with the line to fix.
 * - A new Simulator is made with no runtime named, so simctl takes the newest runtime that can run an iPhone 17: the
 *   newest runtime itself can be one made for a single new model, and naming it failed with "Incompatible device".
 * - Each checkout has its own Simulator, named after the app and, in a linked worktree, the worktree's folder, so two
 *   threads running the same app never install over each other's build or screenshot the other's.
 * - The sound step (../iphone-simulator) runs before the boot, so a new Simulator's first boot is already silent and
 *   no second boot is needed.
 * - Signing for a phone needs the phone in the team's development profile for the app. Xcode adds it during a build
 *   for that phone; Tauri's own build is a generic one that never does, so when no profile holds the phone, one Xcode
 *   build for it runs first. That build stops at the Rust step, which only runs under Tauri; the profile is what it is
 *   for.
 * Every outside program goes through the kit's runner (command-line/run.ts), each in a process group of its own,
 * so a stop by Ctrl-C stops those groups too.
 *
 * Exit codes: 0 running; 1 anything else.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildEnv, type Env } from '../build-env.ts';
import { quietSimulator, type Outcome } from '../iphone-simulator/index.ts';
import { lastLine } from '../testflight/key.ts';
import { runCommand, STOP_SIGNALS, stopRunning, type Run } from '../../command-line/run.ts';

const APPLE = 'src-tauri/gen/apple';
/** The iPhone a new Simulator is: the one the apps' scripts made. */
export const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';
/** Where Xcode keeps the provisioning profiles it downloads, below the home folder. */
const PROFILES = 'Library/Developer/Xcode/UserData/Provisioning Profiles';

export type IphoneRunOptions = {
  target: 'sim' | 'phone';
  /** A Simulator's or a phone's udid; the checkout's own Simulator, or the paired phone, when left out. */
  udid?: string;
  /** The app's checkout. */
  cwd: string;
  run?: Run;
  env?: Env;
  home?: string;
  /** The sound step, given the Simulator's udid. */
  quiet?: (udid: string) => Outcome;
  print?: (line: string) => void;
  fail?: (line: string) => void;
  /** The build's own output as it comes. */
  output?: (chunk: string) => void;
};

/** What the command reads from the app's Tauri config and Xcode project. */
export type App = {
  /** The product name: the Simulator's name, and the built app's. */
  name: string;
  /** The bundle id, as Tauri makes it for iOS: the identifier with `_` made `-`. */
  bundleId: string;
  /** The development team, or null when the config names none. */
  team: string | null;
  /** The Xcode project's name, without .xcodeproj; its scheme is this with `_iOS`. */
  project: string;
};

type Config = { productName?: string; identifier?: string; bundle?: { iOS?: { developmentTeam?: string } } };

const readJson = (path: string): Config => JSON.parse(readFileSync(path, 'utf8')) as Config;

/** The app as its config and Xcode project say, or why it cannot be read. */
export function readApp(cwd: string): App | string {
  const conf = join(cwd, 'src-tauri/tauri.conf.json');
  if (!existsSync(conf)) return `no src-tauri/tauri.conf.json in ${cwd}: run this from a Tauri app's checkout`;
  const base = readJson(conf);
  const iosConf = join(cwd, 'src-tauri/tauri.ios.conf.json');
  const ios = existsSync(iosConf) ? readJson(iosConf) : {};
  const name = ios.productName ?? base.productName;
  const identifier = ios.identifier ?? base.identifier;
  if (!name || !identifier) return 'src-tauri/tauri.conf.json names no productName or identifier';
  const team = ios.bundle?.iOS?.developmentTeam ?? base.bundle?.iOS?.developmentTeam ?? null;
  const apple = join(cwd, APPLE);
  const projects = existsSync(apple) ? readdirSync(apple).filter((entry) => entry.endsWith('.xcodeproj')) : [];
  if (projects.length !== 1) {
    return projects.length ? `${APPLE} holds ${projects.length} Xcode projects; expected one` : `no Xcode project in ${APPLE}: run bunx tauri ios init`;
  }
  return { name, bundleId: identifier.replace(/_/g, '-'), team, project: projects[0].replace(/\.xcodeproj$/, '') };
}

/**
 * What stands in the Rust build step's place for ${FORCE_COLOR} when a terminal's value was written in, or null when
 * the step still holds the placeholder (or a flag such as Tauri's own --force-color).
 */
export function colorWrittenIn(pbxproj: string): string | null {
  const step = pbxproj.match(/--configuration \\"\$\{CONFIGURATION:\?\}\\" (\S+) \$\{ARCHS:\?\}/);
  const value = step?.[1];
  return value && value !== '${FORCE_COLOR}' && !value.startsWith('-') ? value : null;
}

type SimDevice = { name: string; udid: string; isAvailable?: boolean };

/** The available Simulator named `name` in `xcrun simctl list devices -j`'s listing. */
export function findSimulator(listing: string, name: string): SimDevice | null {
  const { devices } = JSON.parse(listing) as { devices: Record<string, SimDevice[]> };
  return (
    Object.values(devices)
      .flat()
      .find((device) => device.name === name && device.isAvailable !== false) ?? null
  );
}

export type Phone = { udid: string; name: string; connected: boolean };

type DevicectlDevice = {
  properties?: {
    hardware?: { reality?: string; deviceType?: string; udid?: string };
    connection?: { pairingState?: string; state?: string };
    state?: { name?: string };
  };
};

/**
 * The iPhones paired with this Mac in `devicectl list devices`'s JSON, connected ones first. devicectl lists every
 * phone the Mac ever paired, and in Xcode 27 the Simulators too, as simulated.
 */
export function pairedPhones(listing: string): Phone[] {
  const devices = (JSON.parse(listing) as { result?: { devices?: DevicectlDevice[] } }).result?.devices ?? [];
  return devices
    .map((device) => device.properties ?? {})
    .filter((p) => p.hardware?.reality === 'physical' && p.hardware.deviceType === 'iPhone' && p.connection?.pairingState === 'paired' && p.hardware.udid)
    .map((p) => ({ udid: p.hardware!.udid!, name: p.state?.name ?? p.hardware!.udid!, connected: p.connection?.state === 'connected' }))
    .sort((a, b) => Number(b.connected) - Number(a.connected));
}

/** The one entry of `folder` ending in `extension`, preferring `<name><extension>`, or null when there is none. */
function built(folder: string, extension: string, names: string[]): string | null {
  const entries = existsSync(folder) ? readdirSync(folder).filter((entry) => entry.endsWith(extension)) : [];
  const entry = names.map((name) => `${name}${extension}`).find((wanted) => entries.includes(wanted)) ?? entries[0];
  return entry ? join(folder, entry) : null;
}

/**
 * Builds and starts the app, as the module's comment says. Stopped by a signal, it stops the programs it started, each
 * in a process group of its own that the terminal's Ctrl-C does not reach, then exits 1.
 */
export async function runIphone(options: IphoneRunOptions): Promise<0 | 1> {
  const say = options.fail ?? ((line: string) => console.error(`[iphone] ${line}`));
  const onSignal = (signal: NodeJS.Signals) => {
    say(`stopped by ${signal}; stopping the programs it started`);
    stopRunning('SIGTERM');
    stopRunning('SIGKILL');
    process.exit(1);
  };
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await runSteps(options);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
  }
}

async function runSteps(options: IphoneRunOptions): Promise<0 | 1> {
  const { cwd } = options;
  const run = options.run ?? runCommand;
  const home = options.home ?? homedir();
  const print = options.print ?? ((line: string) => console.log(`[iphone] ${line}`));
  const say = options.fail ?? ((line: string) => console.error(`[iphone] ${line}`));
  const fail = (line: string): 1 => {
    say(line);
    return 1;
  };
  const output = options.output ?? ((chunk: string) => void process.stdout.write(chunk));
  const env = buildEnv(options.env ?? process.env, home);

  const read = readApp(cwd);
  if (typeof read === 'string') return fail(read);
  const app = read;
  const pbxproj = join(cwd, APPLE, `${app.project}.xcodeproj/project.pbxproj`);
  const written = existsSync(pbxproj) ? colorWrittenIn(readFileSync(pbxproj, 'utf8')) : null;
  if (written) {
    return fail(
      `${APPLE}/${app.project}.xcodeproj/project.pbxproj's Rust build step passes "${written}" where it should say \${FORCE_COLOR}: a terminal's FORCE_COLOR was written in when the project was made again, and Tauri reads it as a chip architecture. Put \${FORCE_COLOR} back before \${ARCHS:?} and commit it.`,
    );
  }
  const build = async (...args: string[]) => {
    const done = await run(['bunx', 'tauri', 'ios', 'build', ...args], { cwd, env, output });
    return done.code === 0;
  };
  return options.target === 'sim' ? simulator() : phone();

  async function simulator(): Promise<0 | 1> {
    let udid = options.udid;
    if (udid) {
      print(`using the Simulator ${udid}`);
    } else {
      // In a linked worktree, git's own folder is not the shared one.
      const where = await run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'], { cwd, env });
      const [gitDir, commonDir, top] = where.out.trim().split('\n');
      const name = where.code === 0 && gitDir !== commonDir ? `${app.name} (${basename(top)})` : app.name;
      const listing = await run(['xcrun', 'simctl', 'list', 'devices', '-j'], { cwd, env });
      if (listing.code !== 0) return fail(`could not list the Simulators (${lastLine(listing.out)}): is Xcode installed, with an iOS Simulator runtime?`);
      const found = findSimulator(listing.out, name);
      if (found) {
        udid = found.udid;
        print(`using the Simulator "${name}" (${udid})`);
      } else {
        const made = await run(['xcrun', 'simctl', 'create', name, DEVICE_TYPE], { cwd, env });
        if (made.code !== 0) {
          return fail(`could not make the Simulator "${name}": ${lastLine(made.out)}. Install an iOS Simulator runtime that runs the iPhone 17 in Xcode, Settings, Components.`);
        }
        udid = lastLine(made.out);
        print(`made the Simulator "${name}" (${udid}), an iPhone 17 on the newest runtime that runs one`);
      }
    }
    if (!(await build('--debug', '--target', 'aarch64-sim'))) return fail('the Simulator build failed; its output is above');
    const bundle = built(join(cwd, APPLE, 'build/arm64-sim'), '.app', [app.name]);
    if (!bundle) return fail(`the build made no .app in ${APPLE}/build/arm64-sim`);
    // Before the boot: a shut-down Simulator has the setting saved for the boot, and a booted one restarts once.
    const quiet = (options.quiet ?? quietSimulator)(udid);
    if (quiet.code !== 0) return fail(quiet.line);
    print(quiet.line);
    // Booting through simctl opens no Simulator window.
    const booted = await run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], { cwd, env });
    if (booted.code !== 0) return fail(`the Simulator ${udid} did not boot: ${lastLine(booted.out)}`);
    await run(['xcrun', 'simctl', 'terminate', udid, app.bundleId], { cwd, env }); // not running is fine
    const installed = await run(['xcrun', 'simctl', 'install', udid, bundle], { cwd, env });
    if (installed.code !== 0) return fail(`could not install ${basename(bundle)} in the Simulator: ${lastLine(installed.out)}`);
    const launched = await run(['xcrun', 'simctl', 'launch', udid, app.bundleId], { cwd, env });
    if (launched.code !== 0) return fail(`installed ${basename(bundle)}, but it did not open: ${lastLine(launched.out)}`);
    print(`running in the Simulator ${udid}`);
    print(`screenshot: xcrun simctl io ${udid} screenshot <file.png>`);
    return 0;
  }

  async function phone(): Promise<0 | 1> {
    let chosen: Phone | undefined = options.udid ? { udid: options.udid, name: options.udid, connected: true } : undefined;
    if (!chosen) {
      const folder = mkdtempSync(join(tmpdir(), 'app-kit-iphone-'));
      try {
        const file = join(folder, 'devices.json');
        const listed = await run(['xcrun', 'devicectl', 'list', 'devices', '--omit-deprecated-fields-in-json', '--json-output', file], { cwd, env });
        if (listed.code !== 0 || !existsSync(file)) return fail(`could not list the paired devices: ${lastLine(listed.out)}`);
        chosen = pairedPhones(readFileSync(file, 'utf8'))[0];
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
      if (!chosen) return fail('no iPhone is paired with this Mac: plug it in, unlock it and tap Trust');
      print(`using ${chosen.name} (${chosen.udid})${chosen.connected ? '' : ', paired but not connected now: plug it in or put it on the same network'}`);
    }
    const { udid, name } = chosen;

    if (await profileHolds(udid)) {
      print(`${name} is in a development profile for ${app.bundleId}`);
    } else {
      print(`adding ${name} to the team's development profile for ${app.bundleId}: one Xcode build for the phone, which stops at the Rust step`);
      const registered = await run(
        [
          'xcodebuild',
          '-project',
          `${app.project}.xcodeproj`,
          '-scheme',
          `${app.project}_iOS`,
          '-configuration',
          'debug',
          '-destination',
          `id=${udid}`,
          '-allowProvisioningUpdates',
          '-allowProvisioningDeviceRegistration',
          'build',
        ],
        { cwd: join(cwd, APPLE), env },
      );
      if (!(await profileHolds(udid))) {
        return fail(`Xcode did not add ${name} to a development profile (${lastLine(registered.out)}): is Xcode signed in to the team, in Xcode, Settings, Accounts?`);
      }
      print(`${name} is now in a development profile for ${app.bundleId}`);
    }

    if (!(await build('--debug', '--export-method', 'debugging'))) return fail('the iPhone build failed; its output is above');
    const ipa = built(join(cwd, APPLE, 'build/arm64'), '.ipa', [app.name, app.project]);
    if (!ipa) return fail(`the build made no .ipa in ${APPLE}/build/arm64`);
    const installed = await run(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', udid, ipa], { cwd, env });
    if (installed.code !== 0) return fail(`could not install ${basename(ipa)} on ${name}: ${lastLine(installed.out)}`);
    const launched = await run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', udid, app.bundleId], { cwd, env });
    if (launched.code !== 0) {
      return fail(`installed ${basename(ipa)} on ${name}, but it did not open: ${lastLine(launched.out)}. A locked phone opens nothing: unlock it and open the app.`);
    }
    print(`running on ${name} (${udid})`);
    return 0;
  }

  /** Whether a provisioning profile for this app, or the team's one for every app, holds the phone. */
  async function profileHolds(udid: string): Promise<boolean> {
    const folder = join(home, PROFILES);
    const files = existsSync(folder) ? readdirSync(folder).filter((entry) => entry.endsWith('.mobileprovision')) : [];
    for (const file of files) {
      const decoded = await run(['security', 'cms', '-D', '-i', join(folder, file)], { cwd, env });
      if (decoded.code !== 0) continue;
      // -o - prints to standard output; without it, plutil writes a file named "-".
      const extract = (key: string, format: string) => run(['plutil', '-extract', key, format, '-o', '-', '-'], { cwd, env, input: decoded.out });
      const id = (await extract('Entitlements.application-identifier', 'raw')).out.trim();
      const [team, ...rest] = id.split('.');
      const appId = rest.join('.');
      if (app.team && team !== app.team) continue;
      if (appId !== app.bundleId && appId !== '*') continue;
      // A profile for distribution holds no devices, and plutil exits 1 on the missing key.
      const devices = await extract('ProvisionedDevices', 'json');
      if (devices.code === 0 && (JSON.parse(devices.out) as string[]).includes(udid)) return true;
    }
    return false;
  }
}
