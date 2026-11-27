/*
 * How long an Android emulator that `app-kit android run emulator` starts stays up, and how many run on the Mac at once:
 * what the iPhone Simulators taught (../iphone-simulator/lifetime.ts), for a device the kit itself starts.
 *
 * Every run starts the one shared emulator image read-only, so each run is an emulator process of its own that saves
 * nothing back, and the kit holds its process id. It shuts down 10 minutes after its app starts, which
 * `app-kit android keep <serial>` moves while an agent is still tapping it, by a watcher process in a session of its own
 * that outlives the run, the agent's shell and its thread, and shuts it down at once when the checkout it belongs to is
 * gone. A run that fails after the start, or is stopped, shuts its emulator down itself. Emulators started any other way
 * are not the kit's: agents start them only through it.
 *
 * At most two run at once, counted from the kit's records whose emulator or run is still alive. A run that finds both
 * places taken waits until the soonest shut-down time, and fails naming them past it. The count and the place, with
 * its console port, are taken under one lock, so two runs never take the last place or the same port together.
 *
 * Files, under $XDG_STATE_HOME/app-kit/emulators (~/.local/state/app-kit/emulators by default):
 *   <serial>.json   the emulator's checkout, port, shut-down time, and the run's, the emulator's and the watcher's
 *                   process ids; written under another name and renamed into place
 *   <serial>.out    the emulator's own output, for a start that fails
 *   emulators.lock  held while places are counted and taken
 *   emulators.log   one line per decision, rotated to emulators.log.1 at 1 MB
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runCommand, type Run } from '../../command-line/run.ts';
import { alive, appendLog, lock } from '../state.ts';

/** How many emulators run on the Mac at once. */
export const AT_ONCE = 2;
/** How long an emulator stays up after its app starts, and how long `keep` gives it, in minutes. */
export const MINUTES = 10;
/** How long a run has from taking its place to its app's start: a cold boot and an install. */
export const STARTING_MINUTES = 20;
/** The most `keep` gives at once, in minutes. */
export const MOST_MINUTES = 30;
/** How often the watcher looks, in milliseconds. */
export const WATCH_EVERY_MS = 15_000;
/** The console ports an emulator takes, even, from the emulator's own first; its serial is `emulator-<port>`. */
export const FIRST_PORT = 5554;
const LAST_PORT = 5584;
/** How long an emulator has to quit once asked before its process is killed. */
const QUIT_WAIT_MS = 20_000;
const WAIT_EVERY_MS = 5_000;
const WAIT_PAST_MS = 2 * WATCH_EVERY_MS;
const LOCK_WAIT_MS = 60_000;

/** What the kit keeps for an emulator it started. */
export type Held = {
  serial: string;
  port: number;
  /** The checkout the run started in; the emulator goes when it is gone. */
  checkout: string;
  /** When the emulator shuts down, in milliseconds since 1970. */
  until: number;
  /** The run that took the place: a place with no emulator yet counts only while it runs. */
  runPid: number;
  emulatorPid: number | null;
  watcherPid: number | null;
};

export type Lifetime = {
  /** The state folder. */
  folder: string;
  run?: Run;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Starts the emulator's process in a session of its own, its output to `out`, and gives its process id; tests replace it. */
  spawn?: (command: string[], env: Record<string, string | undefined>, out: string) => number | null;
  /** Starts the watcher for an emulator and gives its process id. */
  startWatcher?: (serial: string) => number;
  /** Whether a process runs; tests replace it. */
  alive?: (pid: number) => boolean;
  /** Stops a process that would not quit. */
  kill?: (pid: number) => void;
  /** The run's process id, kept in the file. */
  pid?: number;
  watchEveryMs?: number;
  print?: (line: string) => void;
};

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const clock = (time: number): string => new Date(time).toTimeString().slice(0, 5);
const fileOf = (folder: string, serial: string) => join(folder, `${serial}.json`);
export const serialOf = (port: number) => `emulator-${port}`;

export function readHeld(folder: string, serial: string): Held | null {
  try {
    return JSON.parse(readFileSync(fileOf(folder, serial), 'utf8')) as Held;
  } catch {
    return null;
  }
}

function writeHeld(folder: string, held: Held): void {
  const file = fileOf(folder, held.serial);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.${process.pid}`, `${JSON.stringify(held, null, 2)}\n`);
  renameSync(`${file}.${process.pid}`, file);
}

function allHeld(folder: string): Held[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).flatMap((name) => {
    const held = name.endsWith('.json') ? readHeld(folder, name.slice(0, -'.json'.length)) : null;
    return held ? [held] : [];
  });
}

function forget(folder: string, serial: string): void {
  rmSync(fileOf(folder, serial), { force: true });
  rmSync(join(folder, `${serial}.out`), { force: true });
}

function log(lifetime: Pick<Lifetime, 'folder' | 'now'>, line: string): void {
  appendLog(join(lifetime.folder, 'emulators.log'), `${new Date((lifetime.now ?? Date.now)()).toISOString()} ${line}`);
}

/** Whether the record still holds a place: its emulator runs, or its run is still on its way to starting one. */
function holds(lifetime: Lifetime, held: Held): boolean {
  const isAlive = lifetime.alive ?? alive;
  return held.emulatorPid !== null ? isAlive(held.emulatorPid) : isAlive(held.runPid);
}

let turn: Promise<unknown> = Promise.resolve();

async function locked<T>(lifetime: Lifetime, step: () => Promise<T>): Promise<T> {
  const file = join(lifetime.folder, 'emulators.lock');
  const mine = turn.then(async () => {
    const sleep = lifetime.sleep ?? sleepFor;
    const now = lifetime.now ?? Date.now;
    const giveUp = now() + LOCK_WAIT_MS;
    while (!lock(file, lifetime.pid)) {
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

/** The serials adb lists, which an emulator started some other way also takes a port of. */
async function listedSerials(run: Run): Promise<Set<string>> {
  const listed = await run(['adb', 'devices']);
  return new Set(listed.out.split('\n').flatMap((line) => /^(emulator-\d+)\s/.exec(line)?.slice(1, 2) ?? []));
}

/** What `takePlace` gives: the emulator's place and port, or why there is none. */
export type Place = { held: Held } | { refused: string };

/** Takes one of the two places and a free console port, waiting for the soonest shut-down time when both are taken. */
export async function takePlace(lifetime: Lifetime, checkout: string): Promise<Place> {
  const run = lifetime.run ?? runCommand;
  const now = lifetime.now ?? Date.now;
  const sleep = lifetime.sleep ?? sleepFor;
  const pid = lifetime.pid ?? process.pid;
  let told = false;
  for (;;) {
    const outcome = await locked(lifetime, async (): Promise<Place | { wait: Held[] }> => {
      const records = allHeld(lifetime.folder);
      for (const held of records) {
        if (!holds(lifetime, held)) {
          forget(lifetime.folder, held.serial);
          log(lifetime, `${held.serial}: its emulator and run are gone; its place is free`);
        }
      }
      const live = records.filter((held) => holds(lifetime, held));
      if (live.length >= AT_ONCE) return { wait: live };
      const taken = new Set([...live.map((held) => held.serial), ...(await listedSerials(run))]);
      let port = FIRST_PORT;
      while (port <= LAST_PORT && taken.has(serialOf(port))) port += 2;
      if (port > LAST_PORT) return { refused: `every emulator port from ${FIRST_PORT} to ${LAST_PORT} is taken` };
      const held: Held = { serial: serialOf(port), port, checkout, until: now() + STARTING_MINUTES * 60_000, runPid: pid, emulatorPid: null, watcherPid: null };
      writeHeld(lifetime.folder, held);
      log(lifetime, `${held.serial}: place taken for ${checkout}`);
      return { held };
    });
    if (!('wait' in outcome)) return outcome;
    const soonest = Math.min(...outcome.wait.map((held) => held.until));
    const names = outcome.wait.map((held) => `${held.serial} (${held.checkout}, until ${clock(held.until)})`).join(' and ');
    if (now() > soonest + WAIT_PAST_MS) return { refused: `${AT_ONCE} emulators already run, ${names}, and are past their time` };
    if (!told) lifetime.print?.(`${AT_ONCE} emulators already run, ${names}; waiting for a place`);
    told = true;
    await sleep(WAIT_EVERY_MS);
  }
}

/** Starts the emulator in a session of its own, its output to `<serial>.out`, and its watcher, and records both. */
export function startEmulator(lifetime: Lifetime, held: Held, command: string[], env: Record<string, string | undefined>): Held {
  mkdirSync(lifetime.folder, { recursive: true });
  const emulatorPid = (lifetime.spawn ?? spawnDetached(lifetime.folder))(command, env, join(lifetime.folder, `${held.serial}.out`));
  const started = { ...held, emulatorPid };
  writeHeld(lifetime.folder, started);
  const watcherPid = (lifetime.startWatcher ?? startWatcher(lifetime.folder))(held.serial);
  const watched = { ...started, watcherPid };
  writeHeld(lifetime.folder, watched);
  log(lifetime, `${held.serial}: emulator ${emulatorPid} started, watcher ${watcherPid}`);
  return watched;
}

/** Starts a program in a session of its own from `folder`, its output and errors to `out`, outliving this process. */
function spawnDetached(folder: string) {
  return ([program = '', ...args]: string[], env: Record<string, string | undefined>, out: string): number | null => {
    const file = openSync(out, 'w');
    const child = spawn(program, args, { cwd: folder, detached: true, stdio: ['ignore', file, file], env });
    closeSync(file);
    child.unref();
    return child.pid ?? null;
  };
}

/** The emulator's own output so far, for a start that failed. */
export function emulatorOutput(folder: string, serial: string): string {
  try {
    return readFileSync(join(folder, `${serial}.out`), 'utf8');
  } catch {
    return '';
  }
}

/** Sets the shut-down time to `minutes` from now, as the app starts. */
export function setTime(lifetime: Lifetime, serial: string, minutes = MINUTES): Held | null {
  const held = readHeld(lifetime.folder, serial);
  if (!held) return null;
  const timed = { ...held, until: (lifetime.now ?? Date.now)() + Math.min(minutes, MOST_MINUTES) * 60_000 };
  writeHeld(lifetime.folder, timed);
  log(lifetime, `${serial}: shuts down at ${clock(timed.until)}`);
  return timed;
}

/** `app-kit android keep`: moves a kit emulator's shut-down time to `minutes` from now; null when the kit holds none. */
export async function keep(lifetime: Lifetime, serial: string, minutes = MINUTES): Promise<Held | null> {
  return locked(lifetime, async () => {
    const held = readHeld(lifetime.folder, serial);
    return held && holds(lifetime, held) ? setTime(lifetime, serial, minutes) : null;
  });
}

/** Asks the emulator to quit, and kills it when it has not within 20 seconds. */
async function shutDown(lifetime: Lifetime, held: Held): Promise<void> {
  const run = lifetime.run ?? runCommand;
  const isAlive = lifetime.alive ?? alive;
  const now = lifetime.now ?? Date.now;
  const sleep = lifetime.sleep ?? sleepFor;
  if (held.emulatorPid === null || !isAlive(held.emulatorPid)) return;
  await run(['adb', '-s', held.serial, 'emu', 'kill'], { timeoutMs: 10_000 });
  const giveUp = now() + QUIT_WAIT_MS;
  while (isAlive(held.emulatorPid) && now() < giveUp) await sleep(500);
  if (isAlive(held.emulatorPid)) (lifetime.kill ?? ((pid: number) => process.kill(pid, 'SIGKILL')))(held.emulatorPid);
}

/** Shuts down an emulator a run started, for a run that failed after the start. */
export async function release(lifetime: Lifetime, serial: string, why: string): Promise<void> {
  const held = readHeld(lifetime.folder, serial);
  if (!held) return;
  await shutDown(lifetime, held);
  forget(lifetime.folder, serial);
  log(lifetime, `${serial}: shut down, ${why}`);
}

/** The same, for a signal handler, which cannot wait on a promise: the emulator's process is killed outright. */
export function releaseNow(folder: string, serial: string, why: string): void {
  const held = readHeld(folder, serial);
  if (!held) return;
  if (held.emulatorPid !== null && alive(held.emulatorPid)) process.kill(held.emulatorPid, 'SIGKILL');
  forget(folder, serial);
  appendLog(join(folder, 'emulators.log'), `${new Date().toISOString()} ${serial}: shut down, ${why}`);
}

/** Starts `app-kit android watch <serial>` in a session of its own, from the state folder, and gives its process id. */
export function startWatcher(folder: string): (serial: string) => number {
  return (serial) => {
    mkdirSync(folder, { recursive: true });
    const bin = join(import.meta.dir, '../../bin/app-kit.ts');
    const child = spawn(process.execPath, [bin, 'android', 'watch', serial], { cwd: folder, detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid ?? 0;
  };
}

/** Why the watcher stopped. */
export type Watched = 'shut down' | 'nothing to do';

/** The watcher's loop, as the module's comment says. */
export async function watchEmulator(lifetime: Lifetime, serial: string): Promise<Watched> {
  const now = lifetime.now ?? Date.now;
  const sleep = lifetime.sleep ?? sleepFor;
  const isAlive = lifetime.alive ?? alive;
  const pid = lifetime.pid ?? process.pid;
  for (;;) {
    const held = readHeld(lifetime.folder, serial);
    if (!held) return 'nothing to do';
    // Another run took this serial since; null is the moment before the run writes this watcher's id.
    if (held.watcherPid !== null && held.watcherPid !== pid) return 'nothing to do';
    if (held.emulatorPid !== null && !isAlive(held.emulatorPid)) {
      forget(lifetime.folder, serial);
      log(lifetime, `${serial}: shut down by someone else, before its time; its place is free`);
      return 'nothing to do';
    }
    const gone = !existsSync(held.checkout);
    if (gone || now() >= held.until) {
      await shutDown(lifetime, held);
      forget(lifetime.folder, serial);
      log(lifetime, `${serial}: shut down by its watcher, ${gone ? `its checkout ${held.checkout} is gone` : `its time of ${clock(held.until)} came`}`);
      return 'shut down';
    }
    await sleep(lifetime.watchEveryMs ?? WATCH_EVERY_MS);
  }
}
