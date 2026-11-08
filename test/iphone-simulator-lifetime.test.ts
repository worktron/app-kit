// How long a Simulator the kit boots stays up, and how many run at once: places taken, waited for and refused, a place
// whose run died, the watcher's shut-down at its time, when its checkout is gone, and its standing down when someone
// else shut the Simulator, `keep`, and the deleting of a Simulator the kit made once its worktree is gone. Against a stand-in for simctl, which boots and shuts down as told, and a fake
// clock that each wait moves on, so nothing here waits on time.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimMade, DELETE_LIMIT_MS, type Held, type Lifetime, readHeld, readMade, recordMade, release, setTime, takePlace, watchSimulator } from '../tauri/iphone-simulator/lifetime.ts';
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

/** A Mac's Simulators by udid, with their names and whether each is booted, and the clock; `onSleep` runs at each wait. */
function mac(devices: Record<string, { name: string; booted?: boolean }>, onSleep: (now: number) => void = () => {}, refusals = 0) {
  let now = T0;
  let refuse = refusals;
  const sleeps: number[] = [];
  const printed: string[] = [];
  const watchers: string[] = [];
  /** simctl's answers to change mid-test: a listing that fails, and deletes it refuses or that run past their time. */
  const simctl = { listFails: false, deleteRefusals: 0, deleteTimesOut: false };
  const runner = standInRunner((command, options) => {
    const line = command.join(' ');
    if (line === 'xcrun simctl list devices -j' && simctl.listFails) return { code: 1, out: 'CoreSimulatorService connection became invalid', stdout: '', stderr: '', timedOut: false };
    if (line === 'xcrun simctl list devices -j') {
      const listed = Object.entries(devices).map(([udid, d]) => ({ udid, name: d.name, state: d.booted ? 'Booted' : 'Shutdown' }));
      return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': listed } }));
    }
    if (line.startsWith('xcrun simctl shutdown ')) {
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
