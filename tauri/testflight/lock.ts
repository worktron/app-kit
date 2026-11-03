/*
 * A lock file holding its holder's process id: the watcher's one pass at a time, and the upload's one signing build at
 * a time on a Mac. A lock whose holder is gone is taken over.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Takes the lock, or gives false while a live process other than this one holds it. */
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
  try {
    process.kill(holder, 0);
    return true;
  } catch {
    return false;
  }
}
