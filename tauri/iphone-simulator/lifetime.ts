/*
 * How long an iPhone Simulator that `app-kit iphone run sim` boots stays up, and how many run on the Mac at once.
 *
 * A booted Simulator runs about 250 processes and 4 GB, and nothing in Apple's tools ever shuts one down: three left
 * booted by threads that had finished with them, for over four hours, made a Mac with 64 GB barely usable. So each one
 * the kit boots has a shut-down time, 10 minutes after its app starts, which `app-kit iphone-simulator keep <udid>`
 * moves while an agent is still tapping it, and a watcher process of its own that shuts it down at that time, or at once
 * when the checkout it belongs to is gone. The watcher runs in a session of its own, so it outlives the run, the agent's
 * shell and its thread; it runs from the state folder, since a process whose folder was deleted cannot start another
 * program there. A run that fails after the boot, or is stopped, shuts its Simulator down itself.
 *
 * At most two Simulators run at once, counted from the Mac's own list of booted ones, whoever booted them, together
 * with runs that have taken a place and not yet booted. A run that finds both places taken waits until the soonest of
 * the kit's shut-down times, and fails at once naming them when no holder has one. The count and the place are taken
 * under one lock, so two runs never take the last place together.
 *
 * A Simulator booted any other way (`xcrun simctl boot`, an `xcodebuild test` run, a project's own script) is timed by
 * `app-kit iphone-simulator shut-down-idle`, which a background job runs once a minute: it gives each one 10 minutes,
 * counted again from every look that finds a program using it, and shuts it down once they pass with nothing using it.
 * A program using it is a running xcodebuild, xcrun, simctl, devicectl, axe or idb whose arguments name its udid, its
 * name, or simctl's `booted`; only those programs count, so a shell loop or a grep that names it does not keep it up.
 * While Xcode's Device Hub (the Simulator app before Xcode 27) is open, every one counts as in use, since agents never
 * open it and an open one means a person is looking. `keep` moves its time, and a run that finds one booted uses it
 * without taking it over, so a failed run never shuts down a Simulator it did not boot; its app's start moves the time
 * as `keep` does. The kit's own runs' Simulators are left to their watchers. Every decision is one line, with its
 * reason, in simulators.log.
 *
 * A Simulator the run made for a linked worktree holds an iOS data folder of a few GB, and Apple's tools never delete
 * one, so they piled up as worktrees came and went. The run records each one it makes, and once that checkout is gone
 * the kit deletes it: its watcher, right after shutting it down, and every later run, under the lock, for any recorded
 * one that is shut down with no watcher of its own. Only a recorded Simulator is ever deleted: one made by hand, a main
 * checkout's, which every worktree of it shares, or one made before the kit kept records, never is. A recorded one used
 * from another checkout (by a worktree with the same folder name, or by its udid) is no longer the kit's to delete,
 * and its record goes.
 *
 * Files, under $XDG_STATE_HOME/app-kit/simulators (~/.local/state/app-kit/simulators by default):
 *   <udid>.json      the Simulator's name, checkout, shut-down time, the run's and the watcher's process ids, and whether
 *                    the run has seen it booted; written under another name and renamed into place
 *   made/<udid>.json a Simulator the run made for a linked worktree: its name and checkout, kept until it is deleted
 *   simulators.lock  held while places are counted and taken
 *   simulators.log   one line per decision, rotated to simulators.log.1 at 1 MB
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCommand, type Run } from '../../command-line/run.ts';
import { alive, appendLog, lock } from '../state.ts';

/** How many Simulators run on the Mac at once. */
export const AT_ONCE = 2;
/** How long a Simulator stays up after its app starts, and how long `keep` gives it, in minutes. */
export const MINUTES = 10;
/** How long a run has from taking its place to its app's start, when the 10 minutes begin: a first boot and install can be slow. */
export const STARTING_MINUTES = 20;
/** The most `keep` gives at once, in minutes. */
export const MOST_MINUTES = 30;
/** How often the watcher looks, in milliseconds. */
export const WATCH_EVERY_MS = 15_000;
/** How often a run waiting for a place looks again, in milliseconds. */
const WAIT_EVERY_MS = 5_000;
/** How long past the soonest shut-down time a waiting run goes on waiting: two of the watcher's looks. */
const WAIT_PAST_MS = 2 * WATCH_EVERY_MS;
/** How long a run waits for the lock, which is held while a few simctl calls run. */
const LOCK_WAIT_MS = 60_000;
/** How long a delete may take, held under the lock: past it, the record is kept for the next run. */
export const DELETE_LIMIT_MS = 30_000;
/** How long the idle check's shut-down may take, held under the lock: past it, the look stops and tries at the next. */
export const SHUTDOWN_LIMIT_MS = 30_000;
/** How often the background job runs the idle check, in milliseconds: a time it holds is met by the next look. */
export const IDLE_EVERY_MS = 60_000;

/** What the kit keeps for a Simulator it booted. */
export type Held = {
  udid: string;
  name: string;
  /**
   * The checkout the run started in; the Simulator goes when it is gone. Null for one the kit's run did not boot, which
   * the idle check times and which has no watcher.
   */
  checkout: string | null;
  /** When the Simulator shuts down, in milliseconds since 1970. */
  until: number;
  /** The run that took the place; a place not yet booted counts only while it runs. */
  runPid: number;
  watcherPid: number | null;
  /**
   * Whether the run has seen it booted. Until then a shut-down Simulator is one still on its way up, through the sound
   * step's own restart too, so the watcher waits for its time instead of taking the shut-down as the agent's.
   */
  booted: boolean;
  /** For one the idle check times: what it last saw using it, so the log has a line only when that changes. */
  usedBy?: string | null;
};

/** A Simulator the run made for a linked worktree, which the kit deletes once its checkout is gone. */
export type Made = { udid: string; name: string; checkout: string };

export type Lifetime = {
  /** The state folder. */
  folder: string;
  run?: Run;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Starts the watcher for a Simulator and gives its process id. */
  startWatcher?: (udid: string) => number;
  /** The run's process id, kept in the file. */
  pid?: number;
  /** How often the watcher looks; tests make it short. */
  watchEveryMs?: number;
  waitEveryMs?: number;
  print?: (line: string) => void;
};

type SimDevice = { name: string; udid: string; state: string };

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every Simulator in `xcrun simctl list devices -j`'s listing. */
export function listDevices(listing: string): SimDevice[] {
  const { devices } = JSON.parse(listing) as { devices: Record<string, SimDevice[]> };
  return Object.values(devices).flat();
}

/** The local hour and minute of a time, as a run prints it. */
export const clock = (time: number): string => new Date(time).toTimeString().slice(0, 5);

const fileOf = (folder: string, udid: string) => join(folder, `${udid}.json`);

export function readHeld(folder: string, udid: string): Held | null {
  try {
    return JSON.parse(readFileSync(fileOf(folder, udid), 'utf8')) as Held;
  } catch {
    return null;
  }
}

/** Writes `value` to `file` under another name and renames it into place, so no reader sees half of it. */
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.${process.pid}`, file);
}

const writeHeld = (folder: string, held: Held) => writeJson(fileOf(folder, held.udid), held);

/** The udids of the `.json` files in `folder`. */
function udidsIn(folder: string): string[] {
  return existsSync(folder) ? readdirSync(folder).flatMap((name) => (name.endsWith('.json') ? [name.slice(0, -'.json'.length)] : [])) : [];
}

const allHeld = (folder: string): Held[] => udidsIn(folder).flatMap((udid) => readHeld(folder, udid) ?? []);

const forget = (folder: string, udid: string) => rmSync(fileOf(folder, udid), { force: true });

const madeFile = (folder: string, udid: string) => join(folder, 'made', `${udid}.json`);

export function readMade(folder: string, udid: string): Made | null {
  try {
    return JSON.parse(readFileSync(madeFile(folder, udid), 'utf8')) as Made;
  } catch {
    return null;
  }
}

const forgetMade = (folder: string, udid: string) => rmSync(madeFile(folder, udid), { force: true });

function log(lifetime: Lifetime, line: string): void {
  appendLog(join(lifetime.folder, 'simulators.log'), `${new Date((lifetime.now ?? Date.now)()).toISOString()} ${line}`);
}

const label = (held: Pick<Held, 'name' | 'udid'>) => `"${held.name}" (${held.udid})`;

/** The Simulators simctl lists, or why it could not list them. */
async function devices(run: Run): Promise<SimDevice[] | string> {
  const listing = await run(['xcrun', 'simctl', 'list', 'devices', '-j']);
  if (listing.code !== 0) return `could not list the Simulators: ${listing.out.trim().split('\n').at(-1) ?? ''}`;
  try {
    return listDevices(listing.out);
  } catch {
    return `could not read simctl's list of Simulators: ${listing.out.slice(0, 200)}`;
  }
}

/** Why simctl did not shut a Simulator down, and whether that was its time limit running out. */
type Refusal = { why: string; timedOut: boolean };

/**
 * Shuts the Simulator down, giving whether it is down: simctl's refusal for one already shut down, or deleted, is a
 * success, read from its list rather than its words, and any other refusal leaves the kit's file for a later try.
 */
async function shutDown(run: Run, udid: string, timeoutMs?: number): Promise<true | Refusal> {
  const done = await run(['xcrun', 'simctl', 'shutdown', udid], timeoutMs ? { timeoutMs } : undefined);
  if (done.code === 0) return true;
  const listed = await devices(run);
  if (typeof listed !== 'string' && isDown(listed, udid)) return true;
  if (done.timedOut) return { why: `it took over ${timeoutMs! / 1000} seconds`, timedOut: true };
  return { why: done.out.trim().split('\n').at(-1) ?? `exit ${done.code}`, timedOut: false };
}

/** Whether simctl's list has the Simulator shut down, or no longer has it at all. */
const isDown = (listed: SimDevice[], udid: string) => (listed.find((d) => d.udid === udid)?.state ?? 'Shutdown') === 'Shutdown';

/** Records a Simulator the run just made for a linked worktree, for deleting once its checkout is gone. */
export function recordMade(lifetime: Lifetime, made: Made): void {
  writeJson(madeFile(lifetime.folder, made.udid), made);
  log(lifetime, `${label(made)}: made for ${made.checkout}; deleted once that checkout is gone`);
}

/**
 * A run is about to use the Simulator from `checkout`. When the kit made it for another checkout, it is shared from now
 * on and its record goes, so it is never deleted under the one still using it.
 */
export function claimMade(lifetime: Lifetime, udid: string, checkout: string): void {
  const made = readMade(lifetime.folder, udid);
  if (!made || made.checkout === checkout) return;
  forgetMade(lifetime.folder, udid);
  log(lifetime, `${label(made)}: made for ${made.checkout}, now used from ${checkout} too, so kept from now on and never deleted by app-kit`);
}

/**
 * Deletes a recorded Simulator whose checkout is gone, and forgets it once simctl's list no longer has it. A refusal,
 * a delete past its time limit, or a list simctl cannot give keeps the record for the next run. Gives false only for a
 * delete past its time limit.
 */
async function deleteMade(lifetime: Lifetime, run: Run, made: Made): Promise<boolean> {
  const done = await run(['xcrun', 'simctl', 'delete', made.udid], { timeoutMs: DELETE_LIMIT_MS });
  if (done.code !== 0) {
    const why = done.timedOut ? `it took over ${DELETE_LIMIT_MS / 1000} seconds` : (done.out.trim().split('\n').at(-1) ?? `exit ${done.code}`);
    const listed = await devices(run);
    if (typeof listed === 'string' || listed.some((d) => d.udid === made.udid)) {
      log(lifetime, `${label(made)}: its checkout ${made.checkout} is gone, and simctl would not delete it (${why}${typeof listed === 'string' ? `; ${listed}` : ''}); trying again at the next run`);
      return !done.timedOut;
    }
  }
  forgetMade(lifetime.folder, made.udid);
  log(lifetime, `${label(made)}: deleted, its checkout ${made.checkout} is gone`);
  return true;
}

/**
 * Deletes every recorded Simulator whose checkout is gone and that simctl lists as shut down, other than `udid`, the
 * one this run is taking a place for; one the kit holds a time for is its watcher's. Called holding the lock, so it
 * stops at the first delete past its time limit: a few more would hold the lock past other runs' minute of waiting.
 */
async function deleteGone(lifetime: Lifetime, run: Run, listed: SimDevice[], udid: string): Promise<void> {
  for (const made of udidsIn(join(lifetime.folder, 'made')).flatMap((each) => readMade(lifetime.folder, each) ?? [])) {
    if (made.udid === udid || existsSync(made.checkout) || readHeld(lifetime.folder, made.udid)) continue;
    const device = listed.find((d) => d.udid === made.udid);
    if (!device) {
      forgetMade(lifetime.folder, made.udid);
      log(lifetime, `${label(made)}: its checkout ${made.checkout} is gone, and so is the Simulator; forgotten`);
    } else if (device.state === 'Shutdown') {
      if (!(await deleteMade(lifetime, run, made))) return;
    }
  }
}

/** In-process turns at the lock, which the file lock alone cannot give: its holder is this same process. */
let turn: Promise<unknown> = Promise.resolve();

/** Runs `step` holding the Simulators' lock, against other processes and other calls in this one. */
async function locked<T>(lifetime: Lifetime, step: () => Promise<T>): Promise<T> {
  const file = join(lifetime.folder, 'simulators.lock');
  const mine = turn.then(async () => {
    const sleep = lifetime.sleep ?? sleepFor;
    const now = lifetime.now ?? Date.now;
    const giveUp = now() + LOCK_WAIT_MS;
    while (!lock(file)) {
      if (now() > giveUp) throw new Error(`another run has held ${file} for over a minute`);
      await sleep(100);
    }
    try {
      return await step();
    } finally {
      rmSync(file, { force: true });
    }
  });
  turn = mine.catch(() => undefined);
  return mine;
}

/** What `takePlace` gives: the Simulator is the kit's to shut down (`held`), or was running already (`borrowed`), or why no place. */
export type Place = { held: Held } | { borrowed: true } | { refused: string };

/**
 * Takes one of the places for the Simulator `udid`, waiting as the module's comment says, and starts its watcher. A
 * Simulator past its time is shut down first, whichever checkout it belongs to.
 */
export async function takePlace(lifetime: Lifetime, device: { udid: string; name: string; checkout: string }): Promise<Place> {
  const run = lifetime.run ?? runCommand;
  const now = lifetime.now ?? Date.now;
  const sleep = lifetime.sleep ?? sleepFor;
  const print = lifetime.print ?? (() => {});
  let waitUntil: number | null = null;
  for (;;) {
    const answer = await locked(lifetime, async (): Promise<Place | { full: string; soonest: number | null }> => {
      await shutDownPast(lifetime, run);
      const listed = await devices(run);
      if (typeof listed === 'string') return { refused: listed };
      await deleteGone(lifetime, run, listed, device.udid);
      const up = (udid: string) => listed.some((d) => d.udid === udid && d.state !== 'Shutdown');
      const mine = readHeld(lifetime.folder, device.udid);
      if (up(device.udid) && (!mine || mine.checkout === null)) {
        // Its 10 minutes start again now, so the idle check never shuts it down between here and the app's start.
        if (mine) writeHeld(lifetime.folder, { ...mine, until: Math.max(mine.until, now() + MINUTES * 60_000) });
        log(lifetime, `${label(device)}: was running already, booted some other way; used and left to app-kit's idle check`);
        return { borrowed: true };
      }
      const holders = [
        ...listed.filter((d) => d.state !== 'Shutdown' && d.udid !== device.udid).map((d) => ({ udid: d.udid, name: d.name })),
        ...allHeld(lifetime.folder)
          .filter((h) => h.udid !== device.udid && !h.booted && !up(h.udid) && alive(h.runPid))
          .map((h) => ({ udid: h.udid, name: h.name })),
      ];
      if (!up(device.udid) && holders.length >= AT_ONCE) {
        // One the idle check times goes at its first look past its time, so a run waits that much longer for it.
        const times = holders.map((h) => {
          const theirs = readHeld(lifetime.folder, h.udid);
          return theirs ? theirs.until + (theirs.checkout === null ? IDLE_EVERY_MS : 0) : null;
        });
        const named = holders.map((h, i) => `${label(h)} ${times[i] ? `until ${clock(times[i])}` : 'with no shut-down time, booted without app-kit'}`);
        const known = times.filter((t): t is number => t !== null);
        return { full: `${holders.length} Simulators are running, the most at once: ${named.join(', ')}`, soonest: known.length ? Math.min(...known) : null };
      }
      const held: Held = {
        ...device,
        until: now() + STARTING_MINUTES * 60_000,
        runPid: lifetime.pid ?? process.pid,
        watcherPid: null,
        booted: false,
      };
      writeHeld(lifetime.folder, held);
      held.watcherPid = (lifetime.startWatcher ?? startWatcher(lifetime.folder))(device.udid);
      writeHeld(lifetime.folder, held);
      log(lifetime, `${label(device)}: place taken, shuts down by ${clock(held.until)} unless its run moves the time; watcher ${held.watcherPid}`);
      return { held };
    });
    if (!('full' in answer)) return answer;
    if (answer.soonest === null) {
      const line = `${answer.full}. app-kit has no shut-down time for any of them, so waiting would not free a place: shut one down with xcrun simctl shutdown <udid> if it is yours, or run again once another thread has finished with its own`;
      log(lifetime, `${label(device)}: refused, ${line}`);
      return { refused: line };
    }
    if (waitUntil === null) {
      waitUntil = answer.soonest + WAIT_PAST_MS;
      print(`${answer.full}; waiting until ${clock(answer.soonest)} for one to shut down`);
      log(lifetime, `${label(device)}: waiting, ${answer.full}`);
    } else if (now() > waitUntil) {
      const line = `${answer.full}; waited until ${clock(waitUntil)} and none shut down`;
      log(lifetime, `${label(device)}: refused, ${line}`);
      return { refused: line };
    }
    await sleep(lifetime.waitEveryMs ?? WAIT_EVERY_MS);
  }
}

/**
 * Shuts down every Simulator a run booted that is past its time, for a watcher that is gone; called holding the lock.
 * One the idle check times is its alone: only it knows whether something still uses it.
 */
async function shutDownPast(lifetime: Lifetime, run: Run, only?: string): Promise<void> {
  const now = (lifetime.now ?? Date.now)();
  for (const held of allHeld(lifetime.folder)) {
    if (held.checkout === null || held.until > now || (only && held.udid !== only)) continue;
    const down = await shutDown(run, held.udid, SHUTDOWN_LIMIT_MS);
    if (down !== true) {
      log(lifetime, `${label(held)}: past its time of ${clock(held.until)}, and simctl would not shut it down (${down.why}); trying again at the next run`);
      // Past its time limit, more shut-downs would hold the lock past a run's minute of waiting.
      if (down.timedOut) return;
      continue;
    }
    forget(lifetime.folder, held.udid);
    log(lifetime, `${label(held)}: shut down, past its time of ${clock(held.until)} with no watcher to do it`);
  }
}

/** The run has seen its Simulator booted; from now on a shut-down is someone's own. */
export function markBooted(lifetime: Lifetime, udid: string): void {
  const held = readHeld(lifetime.folder, udid);
  if (held) writeHeld(lifetime.folder, { ...held, booted: true });
}

/** Sets the Simulator's shut-down time `minutes` from now, at most 30, and gives it, or null when the kit holds no time for it. */
export function setTime(lifetime: Lifetime, udid: string, minutes = MINUTES): Held | null {
  const held = readHeld(lifetime.folder, udid);
  if (!held) return null;
  const next: Held = { ...held, until: (lifetime.now ?? Date.now)() + Math.min(minutes, MOST_MINUTES) * 60_000 };
  // A watcher that is gone, stopped by hand, is started again, so the new time is kept. One the idle check times has
  // none: the check keeps its time, and a watcher naming it would only add a process.
  if (next.checkout !== null && (!next.watcherPid || !alive(next.watcherPid))) {
    next.watcherPid = (lifetime.startWatcher ?? startWatcher(lifetime.folder))(udid);
  }
  writeHeld(lifetime.folder, next);
  log(lifetime, `${label(next)}: shuts down at ${clock(next.until)}`);
  return next;
}

/**
 * `app-kit iphone-simulator keep`: sets the Simulator's time as `setTime` does, under the lock the idle check holds, and
 * for one booted a moment ago that the idle check has not seen yet, starts its record first. Gives null when the kit
 * holds no time for it and it is not booted.
 */
export async function keep(lifetime: Lifetime, udid: string, minutes = MINUTES): Promise<Held | null> {
  return locked(lifetime, async () => {
    if (!readHeld(lifetime.folder, udid)) {
      const listed = await devices(lifetime.run ?? runCommand);
      const device = typeof listed === 'string' ? undefined : listed.find((d) => d.udid === udid && d.state === 'Booted');
      if (!device) return null;
      writeHeld(lifetime.folder, idleRecord(lifetime, device, null));
      log(lifetime, `${label(device)}: booted without app-kit's run; timed by app-kit's idle check from now`);
    }
    return setTime(lifetime, udid, minutes);
  });
}

/** The programs that count as using a Simulator when their arguments name it, by the base name of their path. */
const USERS = new Set(['xcodebuild', 'xcrun', 'simctl', 'devicectl', 'axe', 'idb', 'idb_companion']);
/** The ones whose `booted` stands for every booted Simulator. */
const BOOTED_SHORTHAND = new Set(['xcrun', 'simctl', 'devicectl']);
/** Xcode 27's Device Hub, either of its programs, and the Simulator app before it. */
const DEVICE_HUB = ['/DeviceHub.app/Contents/MacOS/', '/Simulator.app/Contents/MacOS/Simulator'];

/** One line of `ps -axww -o pid=,command=`: the process id, its program's base name, and its whole command line. */
export type Process = { pid: number; program: string; command: string };

export function parseProcesses(listing: string): Process[] {
  return listing.split('\n').flatMap((line) => {
    const found = line.match(/^\s*(\d+)\s+(\S.*)$/);
    if (!found) return [];
    const command = found[2];
    const path = command.split(' ')[0];
    return [{ pid: Number(found[1]), program: path.slice(path.lastIndexOf('/') + 1), command }];
  });
}

/** What is using the Simulator, as the module's comment says, named with its process id; null when nothing is. */
export function usedBy(processes: Process[], device: Pick<SimDevice, 'udid' | 'name'>): string | null {
  const hub = processes.find((p) => DEVICE_HUB.some((path) => p.command.includes(path)));
  if (hub) return `Device Hub (${hub.pid})`;
  const user = processes.find(
    (p) =>
      USERS.has(p.program) &&
      (p.command.includes(device.udid) ||
        (device.name !== '' && p.command.includes(device.name)) ||
        (BOOTED_SHORTHAND.has(p.program) && /(^|\s)booted(\s|$)/.test(p.command))),
  );
  return user ? `${user.program} (${user.pid})` : null;
}

/** A new record for a Simulator the idle check times, its 10 minutes from now. */
function idleRecord(lifetime: Lifetime, device: Pick<SimDevice, 'udid' | 'name'>, user: string | null): Held {
  return {
    udid: device.udid,
    name: device.name,
    checkout: null,
    until: (lifetime.now ?? Date.now)() + MINUTES * 60_000,
    runPid: lifetime.pid ?? process.pid,
    watcherPid: null,
    booted: true,
    usedBy: user,
  };
}

/**
 * The idle check, `app-kit iphone-simulator shut-down-idle [<udid>]`, one look as the module's comment says: under the
 * lock, it shuts down a run's Simulator past its time with no watcher left, times every booted Simulator no run of the
 * kit holds, and shuts down each one whose time has come with nothing using it. With `only`, it looks at that
 * Simulator alone.
 */
export async function shutDownIdle(lifetime: Lifetime, only?: string): Promise<void> {
  const run = lifetime.run ?? runCommand;
  const now = lifetime.now ?? Date.now;
  await locked(lifetime, async () => {
    await shutDownPast(lifetime, run, only);
    const listed = await devices(run);
    if (typeof listed === 'string') {
      log(lifetime, `idle check: ${listed}; nothing shut down`);
      return;
    }
    for (const held of allHeld(lifetime.folder)) {
      if (held.checkout !== null || (only && held.udid !== only) || !isDown(listed, held.udid)) continue;
      forget(lifetime.folder, held.udid);
      log(lifetime, `${label(held)}: shut down or deleted by someone else; the idle check forgets it`);
    }
    const timed = listed.filter((d) => d.state === 'Booted' && (!only || d.udid === only) && (readHeld(lifetime.folder, d.udid)?.checkout ?? null) === null);
    if (!timed.length) return;
    const ps = await run(['ps', '-axww', '-o', 'pid=,command=']);
    if (ps.code !== 0) {
      log(lifetime, `idle check: could not list the Mac's processes (${ps.out.trim().split('\n').at(-1) ?? `exit ${ps.code}`}); nothing shut down`);
      return;
    }
    const processes = parseProcesses(ps.out);
    for (const device of timed) {
      const held = readHeld(lifetime.folder, device.udid);
      const user = usedBy(processes, device);
      if (!held) {
        const next = idleRecord(lifetime, device, user);
        writeHeld(lifetime.folder, next);
        log(lifetime, `${label(device)}: booted without app-kit's run${user ? `, in use by ${user}` : ''}; shuts down at ${clock(next.until)} unless something uses it`);
        continue;
      }
      if (user) {
        const until = Math.max(held.until, now() + MINUTES * 60_000);
        writeHeld(lifetime.folder, { ...held, until, usedBy: user });
        if (user !== held.usedBy) log(lifetime, `${label(held)}: in use by ${user}; shuts down no sooner than ${clock(until)}`);
        continue;
      }
      if (held.until > now()) {
        if (held.usedBy) {
          writeHeld(lifetime.folder, { ...held, usedBy: null });
          log(lifetime, `${label(held)}: no longer in use by ${held.usedBy}; shuts down at ${clock(held.until)} unless something uses it`);
        }
        continue;
      }
      const down = await shutDown(run, device.udid, SHUTDOWN_LIMIT_MS);
      if (down === true) {
        forget(lifetime.folder, device.udid);
        log(lifetime, `${label(held)}: shut down by the idle check, its time of ${clock(held.until)} came with nothing using it`);
        continue;
      }
      log(lifetime, `${label(held)}: its time of ${clock(held.until)} came with nothing using it, and simctl would not shut it down (${down.why}); trying again at the next look`);
      // Past its time limit, more shut-downs would hold the lock past a run's minute of waiting.
      if (down.timedOut) return;
    }
  });
}

/**
 * Shuts the Simulator down now and forgets it, for a run that failed or was stopped after taking its place. Gives true
 * once it is down, or, when simctl would not shut it down, why and when its watcher tries again.
 */
export async function release(lifetime: Lifetime, udid: string, why: string): Promise<true | string> {
  const held = readHeld(lifetime.folder, udid);
  // One the idle check times was booted some other way: no run of the kit shuts it down.
  if (!held || held.checkout === null) return true;
  const down = await shutDown(lifetime.run ?? runCommand, udid);
  if (down !== true) {
    // The file stays, so its watcher tries again at its time.
    const still = `simctl would not shut it down (${down.why}); its watcher tries again at ${clock(held.until)}`;
    log(lifetime, `${label(held)}: ${why}, and ${still}`);
    return still;
  }
  forget(lifetime.folder, udid);
  log(lifetime, `${label(held)}: shut down, ${why}`);
  return true;
}

/** The same, for a signal handler, which cannot wait on a promise. */
export function releaseNow(folder: string, udid: string, why: string, spawnSync = Bun.spawnSync): void {
  const held = readHeld(folder, udid);
  if (!held || held.checkout === null) return;
  const done = spawnSync(['xcrun', 'simctl', 'shutdown', udid], { stdout: 'ignore', stderr: 'pipe' });
  if (!done.success) {
    // Already shut down or not, the watcher settles it at its time: it reads the Simulator's state.
    appendLog(join(folder, 'simulators.log'), `${new Date().toISOString()} ${label(held)}: ${why}, and simctl would not shut it down (${done.stderr.toString().trim().split('\n').at(-1)}); its watcher tries again at ${clock(held.until)}`);
    return;
  }
  forget(folder, udid);
  appendLog(join(folder, 'simulators.log'), `${new Date().toISOString()} ${label(held)}: shut down, ${why}`);
}

/** Starts `app-kit iphone-simulator watch <udid>` in a session of its own, from the state folder, and gives its process id. */
export function startWatcher(folder: string, everyMs?: number): (udid: string) => number {
  return (udid) => {
    mkdirSync(folder, { recursive: true });
    const bin = join(import.meta.dir, '../../bin/app-kit.ts');
    const args = [bin, 'iphone-simulator', 'watch', udid, ...(everyMs ? ['--every', String(everyMs)] : [])];
    const child = spawn(process.execPath, args, { cwd: folder, detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid ?? 0;
  };
}

/** Why the watcher stopped: it shut the Simulator down, or found nothing left to do. */
export type Watched = 'shut down' | 'nothing to do';

/** The watcher's loop, as the module's comment says. */
export async function watchSimulator(lifetime: Lifetime, udid: string): Promise<Watched> {
  const run = lifetime.run ?? runCommand;
  const now = lifetime.now ?? Date.now;
  const sleep = lifetime.sleep ?? sleepFor;
  const pid = lifetime.pid ?? process.pid;
  for (;;) {
    const held = readHeld(lifetime.folder, udid);
    if (!held) return 'nothing to do';
    // A later run of the same checkout started a watcher of its own. Null is the moment before the run writes this one's.
    if (held.watcherPid !== null && held.watcherPid !== pid) return 'nothing to do';
    // The run's record went and the idle check now times the Simulator.
    if (held.checkout === null) return 'nothing to do';
    const gone = !existsSync(held.checkout);
    if (gone || now() >= held.until) {
      const down = await shutDown(run, udid);
      if (down === true) {
        forget(lifetime.folder, udid);
        log(lifetime, `${label(held)}: shut down by its watcher, ${gone ? `its checkout ${held.checkout} is gone` : `its time of ${clock(held.until)} came`}`);
        const made = gone ? readMade(lifetime.folder, udid) : null;
        if (made && !existsSync(made.checkout)) await deleteMade(lifetime, run, made);
        return 'shut down';
      }
      log(lifetime, `${label(held)}: its watcher could not shut it down (${down.why}); trying again`);
    }
    if (held.booted) {
      const listed = await devices(run);
      if (typeof listed !== 'string' && isDown(listed, udid)) {
        forget(lifetime.folder, udid);
        log(lifetime, `${label(held)}: shut down by someone else, before its time; its place is free`);
        return 'nothing to do';
      }
    }
    await sleep(lifetime.watchEveryMs ?? WATCH_EVERY_MS);
  }
}
