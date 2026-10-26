// The iPhone simulator's quiet step: reading its audio route from `xcrun simctl io <udid> enumerate`, deciding what to
// do, the restart that changes the route of a booted one, and the setting saved for a shut-down one's next boot, run
// against a stand-in for xcrun and plutil.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { type AudioRoute, blackHoleIdFromNames, decide, decideShutDown, parseAudioRoute, parseMacAudioDevices, quietSimulator, type Run } from '../tauri/iphone-simulator/index.ts';

// `xcrun simctl io <udid> enumerate` recorded under Xcode 27.1 and iOS 27.0, from its audio port on, with the Studio
// Display's serial numbers replaced; system-profiler-audio.json is `system_profiler SPAudioDataType -json` on the same
// Mac, other apps' devices left out.
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

describe("the Mac's audio devices", () => {
  const profile = listing('system-profiler-audio.json');

  test('system_profiler names every device', () => {
    expect(parseMacAudioDevices(profile)).toEqual([
      'Studio Display XDR Speakers',
      'Studio Display XDR Microphone',
      'Studio Display XDR Speakers',
      'Studio Display XDR Microphone',
      'BlackHole 2ch',
      'Mac Studio Speakers',
    ]);
    expect(parseMacAudioDevices('')).toBeNull();
    expect(parseMacAudioDevices('{}')).toBeNull();
  });

  test("BlackHole's name gives the id the simulator's listing pairs with it", () => {
    const [id, name] = listing('enumerate-default-route.txt')
      .split('\n')
      .map((line) => line.trim().match(/^(BlackHole\S*): (.*) \(/))
      .find(Boolean)!
      .slice(1);
    expect(blackHoleIdFromNames(parseMacAudioDevices(profile)!)).toBe(id);
    expect(blackHoleIdFromNames([name])).toBe(id);
    expect(blackHoleIdFromNames(['BlackHole 16ch'])).toBe('BlackHole16ch_UID');
    expect(blackHoleIdFromNames(['Studio Display XDR Speakers', 'BlackHole Speakers'])).toBeNull();
  });
});

describe('decideShutDown', () => {
  const mac = ['Studio Display XDR Speakers', 'BlackHole 2ch'];

  test('a shut-down simulator with no settings file, as after an erase, or one on the speakers, is saved', () => {
    expect(decideShutDown(mac, null)).toBe('save');
    expect(decideShutDown(mac, { useHostDefault: true, outputId: STUDIO_DISPLAY })).toBe('save');
  });

  test('one already saved to BlackHole is left alone', () => {
    expect(decideShutDown(mac, { useHostDefault: false, outputId: 'BlackHole2ch_UID' })).toBe('already-saved');
  });

  test("BlackHole missing, or the Mac's devices unreadable, saves nothing", () => {
    expect(decideShutDown(['Studio Display XDR Speakers'], null)).toBe('no-blackhole');
    expect(decideShutDown(null, null)).toBe('unreadable');
  });
});

describe('quietSimulator', () => {
  const UDID = '00000000-0000-0000-0000-000000000001';

  /**
   * A stand-in for xcrun and plutil over one simulator whose data folder is real, so the settings file exists unless
   * `erased`. It records each command, and a boot reads the route from the settings file as the simulator does, except
   * that listing a shut-down simulator's ports loads its route then, and the next boot takes that one.
   */
  function simulator(
    options: { blackHoleInstalled?: boolean; routed?: boolean; bootFails?: boolean; stuckBooted?: boolean; unlisted?: boolean; shutDown?: boolean; erased?: boolean } = {},
  ) {
    const cache = join(import.meta.dir, '../node_modules/.cache');
    mkdirSync(cache, { recursive: true });
    const dataPath = mkdtempSync(join(cache, 'iphone-simulator-'));
    mkdirSync(join(dataPath, 'var/run'), { recursive: true });
    const settings = join(dataPath, 'var/run/com.apple.coresimulator.audio.plist');
    if (!options.erased) writeFileSync(settings, '');
    let saved: Record<string, string | boolean> | null = options.erased
      ? null
      : { useHostDefaultOutputDevice: !options.routed, sim_output_device_uid: options.routed ? 'BlackHole2ch_UID' : STUDIO_DISPLAY };
    // A shut-down simulator's listing names the default device whatever its settings file says.
    let output = options.routed && !options.shutDown ? 'BlackHole2ch_UID' : null;
    let state = options.shutDown ? 'Shutdown' : 'Booted';
    const routeSaved = () => (!saved || saved.useHostDefaultOutputDevice ? null : String(saved.sim_output_device_uid));
    let loaded: string | null | undefined;
    const commands: string[] = [];
    const run: Run = (command) => {
      commands.push(command.join(' '));
      const [tool, a, b, c] = command;
      if (tool === 'xcrun' && b === 'io') {
        if (state === 'Shutdown' && loaded === undefined) loaded = routeSaved();
        const name = options.blackHoleInstalled === false ? 'enumerate-no-blackhole.txt' : output ? 'enumerate-blackhole-route.txt' : 'enumerate-default-route.txt';
        return { ok: true, out: listing(name) };
      }
      if (tool === 'xcrun' && b === 'list') {
        if (options.unlisted) return { ok: true, out: JSON.stringify({ devices: {} }) };
        return { ok: true, out: JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: UDID, dataPath, state }] } }) };
      }
      if (tool === 'xcrun' && b === 'shutdown') {
        if (!options.stuckBooted) state = 'Shutdown';
        return { ok: true, out: '' };
      }
      if (tool === 'xcrun' && b === 'bootstatus') {
        if (options.bootFails) return { ok: false, out: 'Unable to boot device' };
        state = 'Booted';
        output = loaded === undefined ? routeSaved() : loaded;
        loaded = undefined;
        return { ok: true, out: '' };
      }
      if (tool === 'mkdir' && a === '-p' && b === join(dataPath, 'var/run')) return { ok: true, out: '' };
      if (tool === 'system_profiler') {
        const profile = JSON.parse(listing('system-profiler-audio.json'));
        if (options.blackHoleInstalled === false) profile.SPAudioDataType[0]._items = profile.SPAudioDataType[0]._items.filter((item: { _name: string }) => !item._name.startsWith('BlackHole'));
        return { ok: true, out: JSON.stringify(profile) };
      }
      if (tool === 'plutil' && a === '-convert') return saved ? { ok: true, out: JSON.stringify(saved) } : { ok: false, out: 'file does not exist' };
      if (tool === 'plutil' && a === '-create' && b === 'binary1') {
        writeFileSync(settings, '');
        saved = {};
        return { ok: true, out: '' };
      }
      if (tool === 'plutil' && a === '-replace') {
        if (!saved) return { ok: false, out: 'file does not exist' };
        saved = { ...saved, [b]: command[4] === 'false' ? false : command[4] === 'true' ? true : command[4] };
        return { ok: c === '-string' || c === '-bool', out: '' };
      }
      return { ok: false, out: `unexpected: ${command.join(' ')}` };
    };
    return { run, commands, settings, saved: () => saved, done: () => rmSync(dataPath, { recursive: true, force: true }) };
  }

  /** The commands that change something, without the listings and reads. */
  const changes = (commands: string[]) =>
    commands.filter((c) => !c.includes(' list ') && !c.includes(' io ') && !c.includes('-convert') && !c.startsWith('system_profiler'));

  test('a simulator on the speakers is shut down, routed to BlackHole in its settings file, and booted again', () => {
    const sim = simulator();
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({ code: 0, line: '[iphone-simulator] restarted the simulator to send its sound to BlackHole (silent)' });
      const settings = sim.settings;
      expect(changes(sim.commands)).toEqual([
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
    const sim = simulator({ unlisted: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({
        code: 0,
        line: "[iphone-simulator] the simulator has no audio settings file yet, so its sound plays on the Mac's speakers until the next run",
      });
      expect(sim.commands.some((c) => c.includes('shutdown') || c.includes('-replace'))).toBe(false);
    } finally {
      sim.done();
    }
    const unreadable = quietSimulator(UDID, () => ({ ok: false, out: 'Invalid device' }));
    expect(unreadable).toEqual({ code: 0, line: "[iphone-simulator] could not read the simulator's audio route; its sound may play on the Mac's speakers" });
  });

  test('a freshly erased simulator gets a settings file holding all four keys, with no boot of its own', () => {
    const sim = simulator({ shutDown: true, erased: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({
        code: 0,
        line: '[iphone-simulator] set the shut-down simulator to send its sound to BlackHole when it boots (silent)',
      });
      expect(changes(sim.commands)).toEqual([
        `mkdir -p ${dirname(sim.settings)}`,
        `plutil -create binary1 ${sim.settings}`,
        `plutil -replace sim_input_device_uid -string BlackHole2ch_UID ${sim.settings}`,
        `plutil -replace useHostDefaultInputDevice -bool true ${sim.settings}`,
        `plutil -replace sim_output_device_uid -string BlackHole2ch_UID ${sim.settings}`,
        `plutil -replace useHostDefaultOutputDevice -bool false ${sim.settings}`,
      ]);
      expect(sim.saved()).toEqual({
        sim_input_device_uid: 'BlackHole2ch_UID',
        useHostDefaultInputDevice: true,
        sim_output_device_uid: 'BlackHole2ch_UID',
        useHostDefaultOutputDevice: false,
      });
      // It never listed the shut-down simulator's ports, so the next boot, the script's own, takes the setting.
      expect(sim.commands.some((c) => c.includes(' io '))).toBe(false);
      expect(sim.run(['xcrun', 'simctl', 'bootstatus', UDID, '-b']).ok).toBe(true);
      expect(parseAudioRoute(sim.run(['xcrun', 'simctl', 'io', UDID, 'enumerate']).out)?.output).toBe('BlackHole2ch_UID');
    } finally {
      sim.done();
    }
  });

  test('a shut-down simulator saved on the speakers has only its output keys changed', () => {
    const sim = simulator({ shutDown: true });
    try {
      expect(quietSimulator(UDID, sim.run).line).toBe('[iphone-simulator] set the shut-down simulator to send its sound to BlackHole when it boots (silent)');
      expect(changes(sim.commands)).toEqual([
        `plutil -replace sim_output_device_uid -string BlackHole2ch_UID ${sim.settings}`,
        `plutil -replace useHostDefaultOutputDevice -bool false ${sim.settings}`,
      ]);
    } finally {
      sim.done();
    }
  });

  test('a shut-down simulator already saved to BlackHole is left alone', () => {
    const sim = simulator({ shutDown: true, routed: true });
    try {
      expect(quietSimulator(UDID, sim.run)).toEqual({
        code: 0,
        line: '[iphone-simulator] the shut-down simulator is already set to send its sound to BlackHole when it boots (silent)',
      });
      expect(changes(sim.commands)).toEqual([]);
    } finally {
      sim.done();
    }
  });

  test('a shut-down simulator without BlackHole gets no settings file and stays shut down', () => {
    const sim = simulator({ shutDown: true, erased: true, blackHoleInstalled: false });
    try {
      const { code, line } = quietSimulator(UDID, sim.run);
      expect(code).toBe(0);
      expect(line).toContain('brew install --cask blackhole-2ch');
      expect(changes(sim.commands)).toEqual([]);
      expect(sim.saved()).toBeNull();
    } finally {
      sim.done();
    }
  });

  test('a shut-down simulator whose settings cannot be written says so and exits 0', () => {
    const sim = simulator({ shutDown: true });
    const refuse: Run = (command) => (command.includes('-replace') ? { ok: false, out: 'Permission denied' } : sim.run(command));
    try {
      expect(quietSimulator(UDID, refuse)).toEqual({
        code: 0,
        line: "[iphone-simulator] could not save BlackHole in the shut-down simulator's audio settings, so it will play on the Mac's speakers",
      });
    } finally {
      sim.done();
    }
  });

  test('an erased simulator whose data folder cannot be made says so and exits 0, writing nothing', () => {
    const sim = simulator({ shutDown: true, erased: true });
    const refuse: Run = (command) => (command[0] === 'mkdir' ? { ok: false, out: 'Permission denied' } : sim.run(command));
    try {
      expect(quietSimulator(UDID, refuse)).toEqual({
        code: 0,
        line: "[iphone-simulator] could not save BlackHole in the shut-down simulator's audio settings, so it will play on the Mac's speakers",
      });
      expect(sim.saved()).toBeNull();
    } finally {
      sim.done();
    }
  });
});
