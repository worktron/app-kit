/*
 * An iPhone Simulator that runs without a window, kept silent: its sound goes to BlackHole, a virtual audio device that
 * plays nowhere, instead of the Mac's speakers. `app-kit iphone-simulator quiet <udid>` runs it, right after
 * `xcrun simctl bootstatus <udid> -b` and before the app is installed.
 *
 * A booted simulator plays its notification tones and keyboard clicks on the Mac's default output, and Apple gives no
 * command to mute it. Silent mode and the simulator's own volume file were tried: the notification tone still played at
 * full volume. What works is the simulator's output device, the setting Xcode's Sound Output menu changes. It is saved
 * in the device's var/run/com.apple.coresimulator.audio.plist and read only at boot, so the device restarts once to
 * take it; edits while it runs are overwritten. The route only takes a device the Mac has, so BlackHole must be
 * installed (`brew install --cask blackhole-2ch`) and macOS's audio service restarted once after.
 *
 * Every outcome is one `[iphone-simulator]` line and exit code 0, so a missing BlackHole never stops a simulator run;
 * only a failed boot after the step's own shutdown is 1, since the device is then down.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type AudioRoute = {
  /** The output device's id, or null for the Mac's default device. */
  output: string | null;
  /** Each host audio device's id. */
  devices: string[];
};

/** The route saved in the simulator's audio settings file. */
export type SavedRoute = { useHostDefault: boolean; outputId: string | null };

export type Decision =
  | 'unreadable'
  | 'no-blackhole'
  | 'already-silent'
  | 'no-settings-file'
  | 'saved-but-not-applied'
  | 'route-and-restart';

/** Runs a command and gives whether it exited 0, with its output and errors together. */
export type Run = (command: string[]) => { ok: boolean; out: string };

export type Outcome = { code: 0 | 1; line: string };

/**
 * The HostRoute port of `xcrun simctl io <udid> enumerate`, or null when the listing has none. Device lines read
 * "<id>: <name> (n In / n Out)", and ids hold colons themselves, so the id ends at the first ": ".
 */
export function parseAudioRoute(listing: string): AudioRoute | null {
  const port = listing
    .split(/^Port:$/m)
    .find((block) => block.includes('Port Identifier: com.apple.CoreSimulator.Audio.HostRoute'));
  if (!port) return null;
  const outputLine = port.match(/^\s*Guest Audio Output -> (.*)$/m)?.[1]?.trim();
  if (!outputLine) return null;
  const output = outputLine.startsWith('Host Audio Device #') ? outputLine.slice('Host Audio Device #'.length) : null;
  const devices: string[] = [];
  const lines = port.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'Host Audio Devices:');
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (!line.trim()) break;
    const end = line.indexOf(': ');
    if (end > 0) devices.push(line.slice(0, end).trim());
  }
  return { output, devices };
}

/** BlackHole's device id (BlackHole2ch_UID, BlackHole16ch_UID and so on), if the Mac's audio service has loaded it. */
export function blackHoleId(route: AudioRoute): string | null {
  return route.devices.find((id) => /^BlackHole\d+ch_UID$/.test(id)) ?? null;
}

export function decide(route: AudioRoute | null, saved: SavedRoute | null): Decision {
  if (!route) return 'unreadable';
  const blackHole = blackHoleId(route);
  if (!blackHole) return 'no-blackhole';
  if (route.output === blackHole) return 'already-silent';
  if (!saved) return 'no-settings-file';
  // Saved but still playing elsewhere: the setting no longer takes, and restarting the simulator again would only
  // interrupt whoever is using it.
  if (!saved.useHostDefault && saved.outputId === blackHole) return 'saved-but-not-applied';
  return 'route-and-restart';
}

const runCommand: Run = ([command, ...args]) => {
  const done = spawnSync(command, args, { encoding: 'utf8' });
  return { ok: done.status === 0, out: (done.stdout ?? '') + (done.stderr ?? '') };
};

/** JSON a command printed, or null when it failed or printed something else. */
function json<T>(result: { ok: boolean; out: string }): T | null {
  if (!result.ok) return null;
  try {
    return JSON.parse(result.out) as T;
  } catch {
    return null;
  }
}

const where = (route: AudioRoute | null) => (route?.output ? `device ${route.output}` : "the Mac's default device");

/** Sends the simulator `udid`'s sound to BlackHole, restarting it once when its route differs. */
export function quietSimulator(udid: string, run: Run = runCommand): Outcome {
  const readRoute = () => {
    const listing = run(['xcrun', 'simctl', 'io', udid, 'enumerate']);
    return listing.ok ? parseAudioRoute(listing.out) : null;
  };
  const device = () => {
    const list = json<{ devices: Record<string, { udid: string; dataPath: string; state: string }[]> }>(
      run(['xcrun', 'simctl', 'list', 'devices', '-j']),
    );
    return (list && Object.values(list.devices).flat().find((d) => d.udid === udid)) ?? null;
  };
  const readSaved = (file: string | null): SavedRoute | null => {
    if (!file || !existsSync(file)) return null;
    const plist = json<{ useHostDefaultOutputDevice?: boolean; sim_output_device_uid?: string }>(
      run(['plutil', '-convert', 'json', '-o', '-', file]),
    );
    if (!plist) return null;
    return { useHostDefault: plist.useHostDefaultOutputDevice !== false, outputId: plist.sim_output_device_uid ?? null };
  };
  const done = (line: string, code: 0 | 1 = 0): Outcome => ({ code, line: `[iphone-simulator] ${line}` });

  const route = readRoute();
  const dataPath = device()?.dataPath;
  const file = dataPath ? join(dataPath, 'var/run/com.apple.coresimulator.audio.plist') : null;
  switch (decide(route, readSaved(file))) {
    case 'unreadable':
      return done("could not read the simulator's audio route; its sound may play on the Mac's speakers");
    case 'no-blackhole':
      return done(
        "BlackHole is not installed, so the simulator's sound plays on the Mac's speakers: install it with brew install --cask blackhole-2ch, then restart macOS's audio service (sudo killall coreaudiod)",
      );
    case 'already-silent':
      return done('simulator sound already goes to BlackHole (silent)');
    case 'no-settings-file':
      return done("the simulator has no audio settings file yet, so its sound plays on the Mac's speakers until the next run");
    case 'saved-but-not-applied':
      return done(`the simulator is set to send its sound to BlackHole but plays it on ${where(route)}; not restarting it again`);
    case 'route-and-restart':
      break;
  }
  // route-and-restart means both exist; this narrows them for the compiler.
  const blackHole = route && blackHoleId(route);
  if (!blackHole || !file) return done(`the simulator's sound plays on ${where(route)}`);
  // Shut down first: the simulator rewrites this file while it runs.
  run(['xcrun', 'simctl', 'shutdown', udid]); // "already shut down" is fine
  if (device()?.state !== 'Shutdown') {
    return done(`could not shut the simulator down to change its sound, so it plays on ${where(route)}`);
  }
  const wrote =
    run(['plutil', '-replace', 'sim_output_device_uid', '-string', blackHole, file]).ok &&
    run(['plutil', '-replace', 'useHostDefaultOutputDevice', '-bool', 'false', file]).ok;
  if (!run(['xcrun', 'simctl', 'bootstatus', udid, '-b']).ok) {
    return done('the simulator did not boot again after the restart for its sound', 1);
  }
  const after = readRoute();
  if (wrote && after?.output === blackHole) return done('restarted the simulator to send its sound to BlackHole (silent)');
  return done(`restarted the simulator for its sound, but it plays on ${where(after)}`);
}
