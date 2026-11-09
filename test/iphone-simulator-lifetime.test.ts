// How long a Simulator the kit boots stays up, and how many run at once: places taken, waited for and refused, a place
// whose run died, the watcher's shut-down at its time, when its checkout is gone, and its standing down when someone
// else shut the Simulator, `keep`, the deleting of a Simulator the kit made once its worktree is gone, and the idle check
// that shuts down a Simulator booted some other way once nothing uses it. Against a stand-in for simctl, which boots and shuts down as told, and a fake
// clock that each wait moves on, so nothing here waits on time.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimMade,
  clock,
  DELETE_LIMIT_MS,
  type Held,
  keep,
  type Lifetime,
  parseProcesses,
  readHeld,
  readIdle,
  readMade,
  recordMade,
  release,
  setTime,
  SHUTDOWN_LIMIT_MS,
  shutDownIdle,
  takePlace,
  usedBy,
  watchSimulator,
} from '../tauri/iphone-simulator/lifetime.ts';
import { ok, scratch, standInRunner } from './testflight-stand-in.ts';

const T0 = Date.UTC(2026, 10, 2, 14, 0);
const MINUTE = 60_000;

let place: ReturnType<typeof scratch>;
let folder: string;
let checkout: string;

beforeEach(() => {
  place = scratch('simulator-lifetime-');
  folder = join(place.folder, 'simulators');
  checkout = join(place.folder, 'app');
  mkdirSync(checkout);
});

afterEach(() => place.done());

/** ps's `comm` listing for a `command` listing whose program paths hold no spaces: each line's first word. */
const programsOf = (commands: string) => commands.replace(/^(\s*\d+ \S+).*$/gm, '$1');

/** A Mac's Simulators by udid, with their names and whether each is booted, and the clock; `onSleep` runs at each wait. */
function mac(devices: Record<string, { name: string; booted?: boolean }>, onSleep: (now: number) => void = () => {}, refusals = 0) {
  let now = T0;
  let refuse = refusals;
  const sleeps: number[] = [];
  const printed: string[] = [];
  const watchers: string[] = [];
  /**
   * simctl's answers to change mid-test: a listing that fails, deletes it refuses or that run past their time, and
   * shut-downs past theirs; and the Mac's processes as `ps -axww -o pid=,command=` prints them, or null when ps fails.
   */
  const simctl = { listFails: false, deleteRefusals: 0, deleteTimesOut: false, shutdownTimesOut: false, processes: '' as string | null };
  const runner = standInRunner((command, options) => {
    const line = command.join(' ');
    if (line === 'xcrun simctl list devices -j' && simctl.listFails) return { code: 1, out: 'CoreSimulatorService connection became invalid', stdout: '', stderr: '', timedOut: false };
    if (line === 'xcrun simctl list devices -j') {
      const listed = Object.entries(devices).map(([udid, d]) => ({ udid, name: d.name, state: d.booted ? 'Booted' : 'Shutdown' }));
      return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': listed } }));
    }
    if (line.startsWith('ps -axww -o pid=,')) {
      if (simctl.processes === null) return { code: 1, out: 'ps: not permitted', stdout: '', stderr: '', timedOut: false };
      return ok(line.endsWith('comm=') ? programsOf(simctl.processes) : simctl.processes);
    }
    if (line.startsWith('xcrun simctl shutdown ')) {
      if (simctl.shutdownTimesOut) return { code: -1, out: '', stdout: '', stderr: '', timedOut: true };
      if (refuse-- > 0) return { code: 1, out: 'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):\nUnable to shutdown device in current state: Booting', stdout: '', stderr: '', timedOut: false };
      const device = devices[command[3]];
      if (device) device.booted = false;
      return ok();
    }
    if (line.startsWith('xcrun simctl delete ')) {
      expect(options?.timeoutMs).toBe(DELETE_LIMIT_MS);
      if (simctl.deleteTimesOut) return { code: -1, out: '', stdout: '', stderr: '', timedOut: true };
      if (simctl.deleteRefusals-- > 0) return { code: 1, out: 'An error was encountered processing the command (domain=NSCocoaErrorDomain, code=513):\nYou don’t have permission to access “Deleting-0000”.', stdout: '', stderr: '', timedOut: false };
      // CoreSimulator shuts a booted Simulator down and deletes it; it never refuses one for being booted.
      if (!devices[command[3]]) return { code: 148, out: `Invalid device: ${command[3]}`, stdout: '', stderr: '', timedOut: false };
      delete devices[command[3]];
      return ok();
    }
    return undefined;
  });
  const lifetime: Lifetime = {
    folder,
    run: runner.run,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
      onSleep(now);
    },
    // A live process stands for each watcher, this test's own, so nothing starts another.
    startWatcher: (udid) => {
      watchers.push(udid);
      return process.pid;
    },
    print: (line) => printed.push(line),
  };
  const shutdowns = () => runner.calls.map((c) => c.command.join(' ')).filter((c) => c.startsWith('xcrun simctl shutdown'));
  const deletes = () => runner.calls.map((c) => c.command.join(' ')).filter((c) => c.startsWith('xcrun simctl delete'));
  return { lifetime, devices, simctl, sleeps, printed, watchers, shutdowns, deletes, at: () => now, setNow: (time: number) => (now = time) };
}

function hold(held: Partial<Held> & Pick<Held, 'udid'>) {
  mkdirSync(folder, { recursive: true });
  const full: Held = { name: held.udid, checkout, until: T0 + 10 * MINUTE, runPid: process.pid, watcherPid: process.pid, booted: true, ...held };
  writeFileSync(join(folder, `${held.udid}.json`), JSON.stringify(full));
}

/** A process id that has ended. */
function deadPid(): number {
  const done = Bun.spawnSync(['true']);
  return done.pid;
}

const MINE = { udid: 'MINE', name: 'Sample App (feature)', checkout: '' };

describe('takePlace', () => {
  test('on a Mac with a free place, it writes the shut-down time and starts the watcher', async () => {
    const m = mac({ MINE: { name: MINE.name }, OTHER: { name: 'Getter', booted: true } });
    const placed = await takePlace(m.lifetime, { ...MINE, checkout });
    // Twenty minutes for the boot and install; the run sets ten from the app's start.
    expect(placed).toEqual({ held: { ...MINE, checkout, until: T0 + 20 * MINUTE, runPid: process.pid, watcherPid: process.pid, booted: false } });
    expect(readHeld(folder, 'MINE')).toEqual((placed as { held: Held }).held);
    expect(m.watchers).toEqual(['MINE']);
    expect(m.sleeps).toEqual([]);
  });

  test('with both places held by Simulators app-kit has no time for, it refuses at once, naming them', async () => {
    const m = mac({ MINE: { name: MINE.name }, A: { name: 'Getter (design)', booted: true }, B: { name: 'Getter (ui)', booted: true } });
    const placed = await takePlace(m.lifetime, { ...MINE, checkout });
    expect(placed).toEqual({ refused: expect.stringContaining('2 Simulators are running, the most at once: "Getter (design)" (A) with no shut-down time') });
    expect(m.sleeps).toEqual([]);
    expect(readHeld(folder, 'MINE')).toBeNull();
  });

  test('with both places held, it waits for the soonest shut-down time, and takes the place once that one is shut down', async () => {
    const m = mac({ MINE: { name: MINE.name }, A: { name: 'Getter (design)', booted: true }, B: { name: 'Getter (ui)', booted: true } });
    hold({ udid: 'A', name: 'Getter (design)', until: T0 + 3 * MINUTE });
    const placed = await takePlace(m.lifetime, { ...MINE, checkout });
    expect(m.printed[0]).toMatch(/^2 Simulators are running, the most at once: "Getter \(design\)" \(A\) until \d\d:\d\d, "Getter \(ui\)" \(B\) with no shut-down time, booted without app-kit; waiting until \d\d:\d\d for one to shut down$/);
    // A watcher gone, the run itself shut down the one past its time.
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown A']);
    expect('held' in placed).toBe(true);
    expect(m.at()).toBeGreaterThanOrEqual(T0 + 3 * MINUTE);
    expect(m.at()).toBeLessThan(T0 + 4 * MINUTE);
  });

  test('a holder whose time keeps moving: it waits past the soonest time, then gives up with the holders', async () => {
    const m = mac({ MINE: { name: MINE.name }, A: { name: 'Getter (design)', booted: true }, B: { name: 'Getter (ui)', booted: true } }, (now) =>
      hold({ udid: 'A', name: 'Getter (design)', until: now + 10 * MINUTE }),
    );
    hold({ udid: 'A', name: 'Getter (design)', until: T0 + 3 * MINUTE });
    const placed = await takePlace(m.lifetime, { ...MINE, checkout });
    expect(placed).toEqual({ refused: expect.stringMatching(/; waited until \d\d:\d\d and none shut down$/) });
    expect(m.shutdowns()).toEqual([]);
    expect(m.at()).toBeGreaterThan(T0 + 3 * MINUTE + 30_000);
    expect(m.at()).toBeLessThan(T0 + 4 * MINUTE);
  });

  test('two runs after the last place at once: one takes it, the other counts it and waits', async () => {
    const m = mac({ A: { name: 'App A' }, B: { name: 'App B' }, OTHER: { name: 'Getter', booted: true } });
    const [a, b] = await Promise.all([takePlace(m.lifetime, { udid: 'A', name: 'App A', checkout }), takePlace(m.lifetime, { udid: 'B', name: 'App B', checkout })]);
    expect('held' in a).toBe(true);
    // B saw A's place, not yet booted, as taken, and waited out A's time; A's watcher being this test, the run shut it down.
    expect(m.printed).toEqual([expect.stringContaining('"App A" (A) until')]);
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown A']);
    expect('held' in b).toBe(true);
  });

  test('a place taken by a run that died before the boot is free', async () => {
    const m = mac({ MINE: { name: MINE.name }, X: { name: 'Gone run' }, OTHER: { name: 'Getter', booted: true } });
    hold({ udid: 'X', name: 'Gone run', booted: false, runPid: deadPid() });
    expect('held' in (await takePlace(m.lifetime, { ...MINE, checkout }))).toBe(true);
    expect(m.sleeps).toEqual([]);
  });

  test('its own Simulator running with no time from app-kit is borrowed: no file, no watcher', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true }, A: { name: 'A', booted: true }, B: { name: 'B', booted: true } });
    expect(await takePlace(m.lifetime, { ...MINE, checkout })).toEqual({ borrowed: true });
    expect(readHeld(folder, 'MINE')).toBeNull();
    expect(m.watchers).toEqual([]);
  });

  test('a rerun whose Simulator app-kit booted takes no new place, and starts a watcher of its own with a fresh time', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true }, A: { name: 'A', booted: true }, B: { name: 'B', booted: true } });
    hold({ udid: 'MINE', name: MINE.name, until: T0 + MINUTE, watcherPid: deadPid() });
    const placed = await takePlace(m.lifetime, { ...MINE, checkout });
    expect(placed).toEqual({ held: expect.objectContaining({ until: T0 + 20 * MINUTE, watcherPid: process.pid, booted: false }) });
    expect(m.watchers).toEqual(['MINE']);
  });
});

describe('the watcher', () => {
  test('holds through a slow boot, a Simulator still shut down, and shuts it down at its time', async () => {
    const m = mac({ MINE: { name: MINE.name } });
    hold({ udid: 'MINE', booted: false });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE']);
    expect(m.at()).toBe(T0 + 10 * MINUTE);
    expect(readHeld(folder, 'MINE')).toBeNull();
  });

  test('a shut-down simctl refuses is tried again at the next look, with the file kept until it works', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } }, () => {}, 1);
    hold({ udid: 'MINE', until: T0 });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE', 'xcrun simctl shutdown MINE']);
    expect(m.at()).toBe(T0 + 15_000);
    expect(readHeld(folder, 'MINE')).toBeNull();
  });

  test('shuts it down at once when its checkout is gone', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    hold({ udid: 'MINE', checkout: join(place.folder, 'deleted-worktree') });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.at()).toBe(T0);
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE']);
  });

  test('stands down, freeing the place, when someone shut the booted Simulator down before its time', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } }, (now) => {
      if (now >= T0 + MINUTE) m.devices.MINE.booted = false;
    });
    hold({ udid: 'MINE' });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('nothing to do');
    expect(m.shutdowns()).toEqual([]);
    expect(readHeld(folder, 'MINE')).toBeNull();
  });

  test("ends when a later run's watcher holds the Simulator", async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    hold({ udid: 'MINE', watcherPid: deadPid() });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('nothing to do');
    expect(m.shutdowns()).toEqual([]);
    expect(readHeld(folder, 'MINE')).not.toBeNull();
  });
});

describe('keep and release', () => {
  test('keep moves the time from now, 30 minutes at most, and starts a watcher again when its own is gone', () => {
    const m = mac({});
    expect(setTime(m.lifetime, 'MINE')).toBeNull();
    hold({ udid: 'MINE', watcherPid: deadPid() });
    m.setNow(T0 + 5 * MINUTE);
    expect(setTime(m.lifetime, 'MINE', 120)).toMatchObject({ until: T0 + 35 * MINUTE, watcherPid: process.pid });
    expect(m.watchers).toEqual(['MINE']);
    expect(setTime(m.lifetime, 'MINE')).toMatchObject({ until: T0 + 15 * MINUTE });
    expect(m.watchers).toEqual(['MINE']);
  });

  test('a release simctl refuses keeps the file, for the watcher to try again at its time', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } }, () => {}, 1);
    hold({ udid: 'MINE' });
    await release(m.lifetime, 'MINE', 'its run failed');
    expect(readHeld(folder, 'MINE')).not.toBeNull();
  });

  test('a Simulator already shut down counts as shut down, though simctl refuses', async () => {
    const m = mac({ MINE: { name: MINE.name } }, () => {}, 1);
    hold({ udid: 'MINE' });
    await release(m.lifetime, 'MINE', 'its run failed');
    expect(readHeld(folder, 'MINE')).toBeNull();
  });

  test('a Simulator deleted while it was held counts as shut down: its watcher ends', async () => {
    const m = mac({}, () => {}, 1);
    hold({ udid: 'GONE', until: T0 });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'GONE')).toBe('shut down');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown GONE']);
    expect(readHeld(folder, 'GONE')).toBeNull();
  });

  test('release shuts the Simulator down and forgets it; one app-kit holds no time for is left alone', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true }, OTHER: { name: 'Getter', booted: true } });
    hold({ udid: 'MINE' });
    await release(m.lifetime, 'MINE', 'its run failed');
    await release(m.lifetime, 'OTHER', 'its run failed');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE']);
    expect(readHeld(folder, 'MINE')).toBeNull();
  });
});

describe("deleting a worktree's Simulator", () => {
  const made = (udid: string, at = join(place.folder, 'deleted-worktree')) => ({ udid, name: `Sample App (${udid})`, checkout: at });
  const log = () => readFileSync(join(folder, 'simulators.log'), 'utf8');

  test('the watcher deletes the Simulator it made once its worktree is gone, after shutting it down', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    const gone = join(place.folder, 'deleted-worktree');
    recordMade(m.lifetime, made('MINE', gone));
    hold({ udid: 'MINE', checkout: gone });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE']);
    expect(m.deletes()).toEqual(['xcrun simctl delete MINE']);
    expect(m.devices.MINE).toBeUndefined();
    expect(readMade(folder, 'MINE')).toBeNull();
    expect(log()).toContain(`"Sample App (MINE)" (MINE): deleted, its checkout ${gone} is gone`);
  });

  test('the watcher shuts down, and never deletes, a Simulator the kit did not make', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    hold({ udid: 'MINE', checkout: join(place.folder, 'deleted-worktree') });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown MINE']);
    expect(m.deletes()).toEqual([]);
    expect(m.devices.MINE).toEqual({ name: MINE.name, booted: false });
  });

  test('the watcher shutting down at its time deletes nothing: the worktree is still there', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    recordMade(m.lifetime, made('MINE', checkout));
    hold({ udid: 'MINE', until: T0 });
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.deletes()).toEqual([]);
    expect(readMade(folder, 'MINE')).not.toBeNull();
  });

  test("a run's sweep deletes a shut-down Simulator whose worktree is gone, and leaves a booted one, a held one, the run's own and one with no record", async () => {
    const m = mac({
      MINE: { name: MINE.name },
      GONE: { name: 'Sample App (GONE)' },
      BOOTED: { name: 'Sample App (BOOTED)', booted: true },
      HELD: { name: 'Sample App (HELD)' },
      LIVE: { name: 'Sample App (LIVE)' },
      HAND: { name: 'Sample App (deleted-worktree)' },
    });
    for (const udid of ['GONE', 'BOOTED', 'HELD', 'MINE']) recordMade(m.lifetime, made(udid));
    recordMade(m.lifetime, made('LIVE', checkout));
    recordMade(m.lifetime, made('VANISHED'));
    hold({ udid: 'HELD', checkout: join(place.folder, 'deleted-worktree'), booted: false, until: T0 + MINUTE, runPid: deadPid() });
    expect('held' in (await takePlace(m.lifetime, { ...MINE, checkout }))).toBe(true);
    expect(m.deletes()).toEqual(['xcrun simctl delete GONE']);
    expect(readMade(folder, 'GONE')).toBeNull();
    for (const kept of ['BOOTED', 'HELD', 'MINE', 'LIVE']) expect(readMade(folder, kept)).not.toBeNull();
    expect(Object.keys(m.devices).sort()).toEqual(['BOOTED', 'HAND', 'HELD', 'LIVE', 'MINE']);
    // A record whose Simulator someone else deleted is forgotten with no delete.
    expect(readMade(folder, 'VANISHED')).toBeNull();
  });

  test('a delete simctl refuses, or that runs past its time, keeps the record for the next run, which deletes it', async () => {
    const m = mac({ GONE: { name: 'Sample App (GONE)' } });
    recordMade(m.lifetime, made('GONE'));
    m.simctl.deleteRefusals = 1;
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(readMade(folder, 'GONE')).not.toBeNull();
    expect(log()).toContain('simctl would not delete it (You don’t have permission to access “Deleting-0000”.); trying again at the next run');
    await release(m.lifetime, 'MINE', 'its run ended');
    m.simctl.deleteTimesOut = true;
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(readMade(folder, 'GONE')).not.toBeNull();
    expect(log()).toContain(`simctl would not delete it (it took over ${DELETE_LIMIT_MS / 1000} seconds)`);
    await release(m.lifetime, 'MINE', 'its run ended');
    m.simctl.deleteTimesOut = false;
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(m.deletes()).toEqual(['xcrun simctl delete GONE', 'xcrun simctl delete GONE', 'xcrun simctl delete GONE']);
    expect(readMade(folder, 'GONE')).toBeNull();
    expect(m.devices.GONE).toBeUndefined();
  });

  test('the sweep stops at the first delete past its time limit, so the lock is never held for several', async () => {
    const m = mac({ ONE: { name: 'Sample App (ONE)' }, TWO: { name: 'Sample App (TWO)' } });
    recordMade(m.lifetime, made('ONE'));
    recordMade(m.lifetime, made('TWO'));
    m.simctl.deleteTimesOut = true;
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(m.deletes()).toHaveLength(1);
    expect(readMade(folder, 'ONE')).not.toBeNull();
    expect(readMade(folder, 'TWO')).not.toBeNull();
  });

  test('a delete that fails with a listing simctl cannot give keeps the record: a failed list is not an empty one', async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    const gone = join(place.folder, 'deleted-worktree');
    recordMade(m.lifetime, made('MINE', gone));
    hold({ udid: 'MINE', checkout: gone });
    m.simctl.deleteRefusals = 1;
    // The listing fails once the Simulator is shut down, so only the delete's own look reads it.
    const shutdown = m.lifetime.run!;
    m.lifetime.run = async (command, options) => {
      const done = await shutdown(command, options);
      if (command.join(' ') === 'xcrun simctl shutdown MINE') m.simctl.listFails = true;
      return done;
    };
    expect(await watchSimulator({ ...m.lifetime, pid: process.pid }, 'MINE')).toBe('shut down');
    expect(m.deletes()).toEqual(['xcrun simctl delete MINE']);
    expect(readMade(folder, 'MINE')).not.toBeNull();
    expect(log()).toContain('could not list the Simulators: CoreSimulatorService connection became invalid');
  });

  test('a Simulator used from another checkout loses its record, so its first worktree going never deletes it', async () => {
    const m = mac({ SHARED: { name: 'Sample App (feature)' } });
    recordMade(m.lifetime, made('SHARED'));
    claimMade(m.lifetime, 'SHARED', checkout);
    expect(readMade(folder, 'SHARED')).toBeNull();
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(m.deletes()).toEqual([]);
    expect(log()).toContain(`now used from ${checkout} too, so kept from now on and never deleted by app-kit`);
  });
});

describe('shutting down idle Simulators booted some other way', () => {
  const log = () => readFileSync(join(folder, 'simulators.log'), 'utf8');
  const lines = () => log().trim().split('\n').map((line) => line.slice(line.indexOf(' ') + 1));
  const HAND = 'AAAAAAAA-0000-0000-0000-00000000B001';
  const HAND_NAME = 'Metamax (photos)';
  // Lines shaped as this Mac's `ps -axww -o pid=,command=` prints them: right-aligned ids, full program paths.
  const BUSY = '    1 /sbin/launchd\n  316 /usr/libexec/PerfPowerServices\n87339 /Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/XPCServices/com.apple.CoreSimulator.CoreSimulatorService.xpc/Contents/MacOS/com.apple.CoreSimulator.CoreSimulatorService\n';
  const xcodebuildTest = (destination: string) => `${BUSY}41207 /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test -scheme Sample -destination ${destination} -only-testing:SampleTests/SampleTests/testOne\n`;
  const processes = (commands: string) => parseProcesses(programsOf(commands), commands);
  /** Each look the background job takes, a minute apart, until `minutes` have passed. */
  async function looks(m: ReturnType<typeof mac>, minutes: number, between: (minute: number) => void = () => {}) {
    for (let minute = 1; minute <= minutes; minute++) {
      m.setNow(T0 + minute * MINUTE);
      between(minute);
      await shutDownIdle(m.lifetime);
    }
  }

  test('a Simulator booted with simctl boot and used by nothing is shut down once 10 minutes pass, with a line for each decision', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    expect(readIdle(folder, HAND)).toEqual({ udid: HAND, name: HAND_NAME, until: T0 + 10 * MINUTE, usedBy: null });
    // Older kits, sharing this folder, read only its top-level records: none is there for them to misread.
    expect(readHeld(folder, HAND)).toBeNull();
    expect(readdirSync(folder).filter((name) => name.endsWith('.json'))).toEqual([]);
    await looks(m, 9);
    expect(m.shutdowns()).toEqual([]);
    await looks(m, 10);
    expect(m.shutdowns()).toEqual([`xcrun simctl shutdown ${HAND}`]);
    expect(m.devices[HAND].booted).toBe(false);
    expect(readIdle(folder, HAND)).toBeNull();
    expect(m.watchers).toEqual([]);
    expect(lines()).toEqual([
      `"${HAND_NAME}" (${HAND}): booted without app-kit's run; shuts down at ${clock(T0 + 10 * MINUTE)} unless something uses it`,
      `"${HAND_NAME}" (${HAND}): shut down by the idle check, its time of ${clock(T0 + 10 * MINUTE)} came with nothing using it`,
    ]);
  });

  test('a Simulator an xcodebuild test run names by id or by name stays up while the run lasts and shuts down 10 minutes after it ends', async () => {
    // ps prints the arguments as the program got them, with no shell quotes around the destination.
    for (const destination of [`id=${HAND}`, `platform=iOS Simulator,name=${HAND_NAME}`]) {
      const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
      // The test run lasts 25 minutes, then nothing uses the Simulator.
      await looks(m, 40, (minute) => (m.simctl.processes = minute <= 25 ? xcodebuildTest(destination) : BUSY));
      expect(m.shutdowns()).toEqual([`xcrun simctl shutdown ${HAND}`]);
      expect(lines()).toEqual([
        `"${HAND_NAME}" (${HAND}): booted without app-kit's run, in use by xcodebuild (41207); shuts down at ${clock(T0 + 11 * MINUTE)} unless something uses it`,
        `"${HAND_NAME}" (${HAND}): no longer in use by xcodebuild (41207); shuts down at ${clock(T0 + 35 * MINUTE)} unless something uses it`,
        `"${HAND_NAME}" (${HAND}): shut down by the idle check, its time of ${clock(T0 + 35 * MINUTE)} came with nothing using it`,
      ]);
      place.done();
      place = scratch('simulator-lifetime-');
      folder = join(place.folder, 'simulators');
    }
  });

  test("simctl's booted shorthand counts as using every booted Simulator", () => {
    const listing = processes(`${BUSY}52001 /Applications/Xcode.app/Contents/Developer/usr/bin/simctl spawn booted log stream --level debug\n`);
    expect(usedBy(listing, { udid: HAND, name: HAND_NAME })).toBe('simctl (52001)');
    expect(usedBy(listing, { udid: 'OTHER', name: 'Getter' })).toBe('simctl (52001)');
  });

  test("a shell loop, a grep or the kit's own watcher naming the Simulator does not count as use", () => {
    const listing = processes(
      `${BUSY}60001 /bin/zsh -c while true; do bun bin/app-kit.ts iphone-simulator shut-down-idle ${HAND}; sleep 60; done\n` +
        `60002 grep ${HAND}\n` +
        `60003 /opt/homebrew/bin/bun /kit/bin/app-kit.ts iphone-simulator watch ${HAND}\n` +
        `60004 /var/devices/CoreSimulator/Devices/${HAND}/data/Containers/Bundle/Application/X/Sample.app/Sample\n`,
    );
    expect(usedBy(listing, { udid: HAND, name: HAND_NAME })).toBeNull();
    expect(usedBy(processes(`70001 /opt/homebrew/bin/axe tap --udid ${HAND} -x 10 -y 20\n`), { udid: HAND, name: HAND_NAME })).toBe('axe (70001)');
    // ps prints the program's path in a column of its own, spaces and all.
    const spaced = `70002 /Applications/Xcode 26.app/Contents/Developer/usr/bin/xcodebuild test -destination id=${HAND}\n`;
    expect(usedBy(parseProcesses('70002 /Applications/Xcode 26.app/Contents/Developer/usr/bin/xcodebuild\n', spaced), { udid: HAND, name: HAND_NAME })).toBe('xcodebuild (70002)');
    const shell = `70003 /bin/zsh -c while true; do /usr/bin/xcrun simctl io ${HAND} screenshot x.png; sleep 60; done\n`;
    expect(usedBy(parseProcesses('70003 /bin/zsh\n', shell), { udid: HAND, name: HAND_NAME })).toBeNull();
    // A shell that only mentions Device Hub's program is not Device Hub.
    const mention = '70004 /bin/zsh -c ls /Applications/Xcode.app/Contents/Applications/DeviceHub.app/Contents/MacOS/; sleep 600\n';
    expect(usedBy(parseProcesses('70004 /bin/zsh\n', mention), { udid: HAND, name: HAND_NAME })).toBeNull();
  });

  test('a destination or a simctl argument naming one Simulator is not a use of another whose name starts the same', () => {
    const pro = processes(`${BUSY}41300 /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test -scheme Sample -destination platform=iOS Simulator,name=iPhone 17 Pro -only-testing:SampleTests\n`);
    expect(usedBy(pro, { udid: 'PLAIN', name: 'iPhone 17' })).toBeNull();
    expect(usedBy(pro, { udid: 'PRO', name: 'iPhone 17 Pro' })).toBe('xcodebuild (41300)');
    const last = processes(`41301 /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test -destination platform=iOS Simulator,name=iPhone 17,OS=27.2\n`);
    expect(usedBy(last, { udid: 'PLAIN', name: 'iPhone 17' })).toBe('xcodebuild (41301)');
    // simctl takes the name where the udid goes.
    const spawn = processes(`52002 /Applications/Xcode.app/Contents/Developer/usr/bin/simctl spawn ${HAND_NAME} log stream\n`);
    expect(usedBy(spawn, { udid: HAND, name: HAND_NAME })).toBe('simctl (52002)');
    expect(usedBy(spawn, { udid: 'OTHER', name: 'Getter' })).toBeNull();
    // ps joins the arguments with spaces and loses where each ends, so a name that is a whole word at the head of
    // another's counts as used too: it errs toward keeping a Simulator up, never toward shutting one down in use.
    expect(usedBy(spawn, { udid: 'OTHER', name: 'Metamax' })).toBe('simctl (52002)');
  });

  test('Device Hub open keeps every Simulator up, logged once, and its 10 minutes count from its closing', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true }, OTHER: { name: 'Getter', booted: true } });
    const hub = `${BUSY}88001 /Applications/Xcode.app/Contents/Applications/DeviceHub.app/Contents/MacOS/DeviceHub\n`;
    await looks(m, 50, (minute) => (m.simctl.processes = minute <= 30 ? hub : BUSY));
    expect(m.shutdowns().sort()).toEqual([`xcrun simctl shutdown ${HAND}`, 'xcrun simctl shutdown OTHER']);
    expect(lines().filter((line) => line.includes('Device Hub (88001)'))).toHaveLength(4);
    expect(lines().filter((line) => line.includes('shut down by the idle check')).every((line) => line.includes(clock(T0 + 40 * MINUTE)))).toBe(true);
    expect(usedBy(processes('5 /Applications/Xcode-26.app/Contents/Developer/Applications/Simulator.app/Contents/MacOS/Simulator\n'), { udid: HAND, name: HAND_NAME })).toBe('Device Hub (5)');
  });

  test("a Simulator the kit's run booted is left to its watcher", async () => {
    const m = mac({ MINE: { name: MINE.name, booted: true } });
    hold({ udid: 'MINE', until: T0 + 30 * MINUTE });
    await looks(m, 20);
    expect(m.shutdowns()).toEqual([]);
    expect(readHeld(folder, 'MINE')).toMatchObject({ checkout, until: T0 + 30 * MINUTE });
  });

  test("a run's look for Simulators past their time leaves the idle check's alone, though their time has passed", async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true }, MINE: { name: MINE.name } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    m.setNow(T0 + 30 * MINUTE);
    await takePlace(m.lifetime, { ...MINE, checkout });
    expect(m.shutdowns()).toEqual([]);
    expect(m.devices[HAND].booted).toBe(true);
  });

  test('a run on a Simulator the idle check times past its time starts its 10 minutes again, so no look shuts it down before the app starts', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    m.setNow(T0 + 10 * MINUTE);
    expect(await takePlace(m.lifetime, { udid: HAND, name: HAND_NAME, checkout })).toEqual({ borrowed: true });
    m.setNow(T0 + 11 * MINUTE);
    await shutDownIdle(m.lifetime);
    expect(m.shutdowns()).toEqual([]);
    expect(readIdle(folder, HAND)).toMatchObject({ until: T0 + 20 * MINUTE });
  });

  test("a run's shut-down of a Simulator past its time that runs over its limit stops the look", async () => {
    const m = mac({ A: { name: 'App A', booted: true }, B: { name: 'App B', booted: true } });
    hold({ udid: 'A', until: T0 - MINUTE });
    hold({ udid: 'B', until: T0 - MINUTE });
    m.simctl.shutdownTimesOut = true;
    await shutDownIdle(m.lifetime);
    expect(m.shutdowns()).toHaveLength(1);
    expect(log()).toContain(`simctl would not shut it down (it took over ${SHUTDOWN_LIMIT_MS / 1000} seconds); trying again at the next run`);
  });

  test("a run on a Simulator the idle check times uses it without taking it over, so its failure never shuts it down", async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    expect(await takePlace(m.lifetime, { udid: HAND, name: HAND_NAME, checkout })).toEqual({ borrowed: true });
    expect(await release(m.lifetime, HAND, 'its run failed')).toBe(true);
    expect(m.shutdowns()).toEqual([]);
    expect(m.watchers).toEqual([]);
    expect(readIdle(folder, HAND)).not.toBeNull();
    expect(readHeld(folder, HAND)).toBeNull();
  });

  test("keep moves an idle-check Simulator's time and starts no watcher; on one booted a moment ago it writes the record first", async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true }, DOWN: { name: 'Getter' } });
    m.simctl.processes = BUSY;
    expect(await keep(m.lifetime, HAND, 25)).toMatchObject({ until: T0 + 25 * MINUTE });
    expect(readHeld(folder, HAND)).toBeNull();
    await looks(m, 24);
    expect(m.shutdowns()).toEqual([]);
    await looks(m, 25);
    expect(m.shutdowns()).toEqual([`xcrun simctl shutdown ${HAND}`]);
    expect(m.watchers).toEqual([]);
    expect(await keep(m.lifetime, 'DOWN')).toBeNull();
    expect(lines()[0]).toBe(`"${HAND_NAME}" (${HAND}): booted without app-kit's run; timed by app-kit's idle check from now`);
  });

  test('a shut-down that runs over its time limit stops the look and keeps the record for the next', async () => {
    const m = mac({ A: { name: 'Getter (a)', booted: true }, B: { name: 'Getter (b)', booted: true } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    m.simctl.shutdownTimesOut = true;
    m.setNow(T0 + 11 * MINUTE);
    await shutDownIdle(m.lifetime);
    expect(m.shutdowns()).toEqual(['xcrun simctl shutdown A']);
    expect(readIdle(folder, 'A')).not.toBeNull();
    expect(log()).toContain(`simctl would not shut it down (it took over ${SHUTDOWN_LIMIT_MS / 1000} seconds); trying again at the next look`);
    m.simctl.shutdownTimesOut = false;
    m.setNow(T0 + 12 * MINUTE);
    await shutDownIdle(m.lifetime);
    expect(m.devices.A.booted).toBe(false);
    expect(m.devices.B.booted).toBe(false);
  });

  test('ps failing shuts nothing down, and says so', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
    m.simctl.processes = null;
    await looks(m, 20);
    expect(m.shutdowns()).toEqual([]);
    expect(log()).toContain("idle check: could not list the Mac's processes (ps: not permitted); nothing shut down");
  });

  test('a Simulator someone else shut down is forgotten, and one booted again later starts a new 10 minutes', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true } });
    m.simctl.processes = BUSY;
    await shutDownIdle(m.lifetime);
    m.devices[HAND].booted = false;
    await looks(m, 3);
    expect(readIdle(folder, HAND)).toBeNull();
    m.devices[HAND].booted = true;
    await looks(m, 4);
    // The looks start again at minute 1, which finds it booted anew.
    expect(readIdle(folder, HAND)).toMatchObject({ until: T0 + 11 * MINUTE });
    expect(log()).toContain('shut down or deleted by someone else; the idle check forgets it');
  });

  test('shut-down-idle <udid> looks at that Simulator only', async () => {
    const m = mac({ [HAND]: { name: HAND_NAME, booted: true }, OTHER: { name: 'Getter', booted: true } });
    m.simctl.processes = BUSY;
    for (let minute = 0; minute <= 15; minute++) {
      m.setNow(T0 + minute * MINUTE);
      await shutDownIdle(m.lifetime, HAND);
    }
    expect(m.shutdowns()).toEqual([`xcrun simctl shutdown ${HAND}`]);
    expect(readIdle(folder, 'OTHER')).toBeNull();
    expect(m.devices.OTHER.booted).toBe(true);
  });
});
