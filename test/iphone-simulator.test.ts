// The iPhone simulator's quiet step: reading its audio route from `xcrun simctl io <udid> enumerate`, deciding what to
// do, and the restart that changes the route, run against a stand-in for xcrun and plutil.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { type AudioRoute, decide, parseAudioRoute, quietSimulator, type Run } from '../tauri/iphone-simulator/index.ts';

// `xcrun simctl io <udid> enumerate` recorded under Xcode 27.1 and iOS 27.0, from its audio port on, with the Studio
// Display's serial numbers replaced.
const listing = (name: string) => readFileSync(join(import.meta.dir, 'fixtures/iphone-simulator', name), 'utf8');
const STUDIO_DISPLAY = 'AppleUSBAudioEngine:Apple Inc.:Studio Display XDR:00000000-0000000000000001:10,11';

describe('parseAudioRoute', () => {
  test("the Mac's default device, with BlackHole installed", () => {
    const route = parseAudioRoute(listing('enumerate-default-route.txt'));
    expect(route?.output).toBeNull();
    expect(route?.devices).toEqual([
      STUDIO_DISPLAY,
      'AppleUSBAudioEngine:Apple Inc.:Studio Display XDR:00000000-0000000000000001:8,9',
      'AppleUSBAudioEngine:Apple Inc.:Studio Display XDR:00000000-0000000000000002:10,11',
      'AppleUSBAudioEngine:Apple Inc.:Studio Display XDR:00000000-0000000000000002:8,9',
      'BlackHole2ch_UID',
      'BuiltInSpeakerDevice',
    ]);
  });

  test('a route to BlackHole names its device id', () => {
    expect(parseAudioRoute(listing('enumerate-blackhole-route.txt'))?.output).toBe('BlackHole2ch_UID');
  });

  test('before BlackHole is installed, it is not among the devices', () => {
    expect(parseAudioRoute(listing('enumerate-no-blackhole.txt'))?.devices).not.toContain('BlackHole2ch_UID');
  });

  test('a listing with no audio port reads as nothing', () => {
    const withoutAudio = listing('enumerate-default-route.txt')
      .split(/^Port:$/m)
      .filter((block) => !block.includes('Audio.HostRoute'))
      .join('Port:');
    expect(parseAudioRoute(withoutAudio)).toBeNull();
    expect(parseAudioRoute('')).toBeNull();
  });
});

describe('decide', () => {
  const route = (output: string | null, devices = [STUDIO_DISPLAY, 'BlackHole2ch_UID']): AudioRoute => ({ output, devices });
  const onDefault = { useHostDefault: true, outputId: STUDIO_DISPLAY };
  const onBlackHole = { useHostDefault: false, outputId: 'BlackHole2ch_UID' };

  test('a simulator on the default device is routed and restarted', () => {
    expect(decide(route(null), onDefault)).toBe('route-and-restart');
  });

  test('one pinned to the speakers is routed too', () => {
    expect(decide(route(STUDIO_DISPLAY), { useHostDefault: false, outputId: STUDIO_DISPLAY })).toBe('route-and-restart');
  });

  test('one already on BlackHole is left alone', () => {
    expect(decide(route('BlackHole2ch_UID'), onBlackHole)).toBe('already-silent');
  });

  test('BlackHole missing is never reported silent, whatever the route names', () => {
    expect(decide(route(null, [STUDIO_DISPLAY]), onDefault)).toBe('no-blackhole');
    expect(decide(route('BlackHole2ch_UID', [STUDIO_DISPLAY]), onBlackHole)).toBe('no-blackhole');
  });

  test('saved but not taking effect warns instead of restarting again', () => {
    expect(decide(route(null), onBlackHole)).toBe('saved-but-not-applied');
  });

  test('no settings file yet, or no listing, changes nothing', () => {
    expect(decide(route(null), null)).toBe('no-settings-file');
    expect(decide(null, onDefault)).toBe('unreadable');
  });
});

describe('quietSimulator', () => {
  const UDID = '00000000-0000-0000-0000-000000000001';

  /**
   * A stand-in for xcrun and plutil over one simulator whose data folder is real, so the settings file exists. It
   * records each command, and a boot reads the route from the settings file as the simulator does.
   */
  function simulator(options: { blackHoleInstalled?: boolean; routed?: boolean; bootFails?: boolean; stuckBooted?: boolean } = {}) {
    const cache = join(import.meta.dir, '../node_modules/.cache');
    mkdirSync(cache, { recursive: true });
    const dataPath = mkdtempSync(join(cache, 'iphone-simulator-'));
    mkdirSync(join(dataPath, 'var/run'), { recursive: true });
    const settings = join(dataPath, 'var/run/com.apple.coresimulator.audio.plist');
    writeFileSync(settings, '');
    let saved = { useHostDefaultOutputDevice: !options.routed, sim_output_device_uid: options.routed ? 'BlackHole2ch_UID' : STUDIO_DISPLAY };
    let output = options.routed ? 'BlackHole2ch_UID' : null;
    let state = 'Booted';
    const commands: string[] = [];
    const run: Run = (command) => {
      commands.push(command.join(' '));
      const [tool, a, b, c] = command;
      if (tool === 'xcrun' && b === 'io') {
        const name = options.blackHoleInstalled === false ? 'enumerate-no-blackhole.txt' : output ? 'enumerate-blackhole-route.txt' : 'enumerate-default-route.txt';
        return { ok: true, out: listing(name) };
      }
      if (tool === 'xcrun' && b === 'list') {
        return { ok: true, out: JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: UDID, dataPath, state }] } }) };
      }
      if (tool === 'xcrun' && b === 'shutdown') {
        if (!options.stuckBooted) state = 'Shutdown';
        return { ok: true, out: '' };
      }
      if (tool === 'xcrun' && b === 'bootstatus') {
        if (options.bootFails) return { ok: false, out: 'Unable to boot device' };
        state = 'Booted';
        output = saved.useHostDefaultOutputDevice ? null : saved.sim_output_device_uid;
        return { ok: true, out: '' };
      }
      if (tool === 'plutil' && a === '-convert') return { ok: true, out: JSON.stringify(saved) };
      if (tool === 'plutil' && a === '-replace') {
        saved = { ...saved, [b]: command[4] === 'false' ? false : command[4] };
        return { ok: c === '-string' || c === '-bool', out: '' };
      }
      return { ok: false, out: `unexpected: ${command.join(' ')}` };
    };
    return { run, commands, dataPath, saved: () => saved, done: () => rmSync(dataPath, { recursive: true, force: true }) };
  }

  test('a simulator on the speakers is shut down, routed to BlackHole in its settings file, and booted again', () => {
    const sim = simulator();
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({ code: 0, line: '[iphone-simulator] restarted the simulator to send its sound to BlackHole (silent)' });
      const settings = join(sim.dataPath, 'var/run/com.apple.coresimulator.audio.plist');
      expect(sim.commands.filter((c) => !c.includes(' list ') && !c.includes(' io ') && !c.includes('-convert'))).toEqual([
        `xcrun simctl shutdown ${UDID}`,
        `plutil -replace sim_output_device_uid -string BlackHole2ch_UID ${settings}`,
        `plutil -replace useHostDefaultOutputDevice -bool false ${settings}`,
        `xcrun simctl bootstatus ${UDID} -b`,
      ]);
      expect(sim.saved()).toEqual({ useHostDefaultOutputDevice: false, sim_output_device_uid: 'BlackHole2ch_UID' });
    } finally {
      sim.done();
    }
  });

  test('a second run finds it silent and restarts nothing', () => {
    const sim = simulator({ routed: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({ code: 0, line: '[iphone-simulator] simulator sound already goes to BlackHole (silent)' });
      expect(sim.commands.some((c) => c.includes('shutdown') || c.includes('bootstatus'))).toBe(false);
    } finally {
      sim.done();
    }
  });

  test('without BlackHole it says how to install it, exits 0 and leaves the simulator running', () => {
    const sim = simulator({ blackHoleInstalled: false });
    try {
      const { code, line } = quietSimulator(UDID, sim.run);
      expect(code).toBe(0);
      expect(line).toContain('brew install --cask blackhole-2ch');
      expect(sim.commands.some((c) => c.includes('shutdown'))).toBe(false);
    } finally {
      sim.done();
    }
  });

  test('a simulator that will not shut down is left as it was, its settings untouched', () => {
    const sim = simulator({ stuckBooted: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({
        code: 0,
        line: "[iphone-simulator] could not shut the simulator down to change its sound, so it plays on the Mac's default device",
      });
      expect(sim.commands.some((c) => c.includes('-replace'))).toBe(false);
    } finally {
      sim.done();
    }
  });

  test('a failed boot after its own shutdown exits 1, since the simulator is then down', () => {
    const sim = simulator({ bootFails: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({ code: 1, line: '[iphone-simulator] the simulator did not boot again after the restart for its sound' });
    } finally {
      sim.done();
    }
  });

  test('a simulator the listing does not know, or one xcrun cannot read, changes nothing', () => {
    const unreadable = quietSimulator(UDID, () => ({ ok: false, out: 'Invalid device' }));
    expect(unreadable).toEqual({ code: 0, line: "[iphone-simulator] could not read the simulator's audio route; its sound may play on the Mac's speakers" });
  });
});
