/*
 * Where the kit's commands that outlive a terminal keep what they share between runs on this Mac: the TestFlight
 * watcher's clones and records, and the iPhone Simulators' shut-down times. One folder per part under
 * $XDG_STATE_HOME/app-kit (~/.local/state/app-kit by default), never the temporary folder, which an agent's session can
 * set to one of its own, so every checkout on the Mac reads the same one. Beside it, the lock one process at a time holds
 * (the TestFlight upload's one signing build at a time takes it too) and the log each part writes its decisions to.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type Env = Record<string, string | undefined>;

/** The size past which a log is moved to `<name>.1` before the next line. */
const LOG_MAX = 1_000_000;

/** The folder `part` keeps its state in. */
export function stateFolder(part: string, env: Env = process.env, home = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'app-kit', part);
}

/** Takes the lock file for `pid`, or gives false when a live process other than it holds it. A lock whose holder is gone is taken over. */
export function lock(file: string, pid = process.pid): boolean {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, String(pid), { flag: 'wx' });
    return true;
  } catch {
    // held
  }
  if (held(file, pid)) return false;
  writeFileSync(file, String(pid));
  return true;
}

/** Whether a live process other than this one holds the lock file. */
function held(file: string, pid: number): boolean {
  let holder: number;
  try {
    holder = Number(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!holder || holder === pid) return false;
  return alive(holder);
}

/** Whether the process `pid` is running. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: running, as another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Adds a line to the log `file`, first moving a log past 1 MB to `<file>.1`. */
export function appendLog(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  try {
    if (statSync(file).size > LOG_MAX) renameSync(file, `${file}.1`);
  } catch {
    // no log yet
  }
  appendFileSync(file, `${line}\n`);
}
