// Every test process gets its own temporary folder, /tmp/app-kit-tests/<pid>, made its TMPDIR before any test runs, so
// os.tmpdir() and everything started from a test write there and not in the system's shared folder. bun test runs no
// exit handler, so each process removes the folders of processes that have ended rather than its own.
import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PARENT = '/tmp/app-kit-tests';

/** A folder this user made and owns, that nobody else can write to, and not a link to somewhere else. */
function ownFolder(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const found = lstatSync(path);
  if (!found.isDirectory() || found.uid !== process.getuid?.() || (found.mode & 0o022) !== 0) {
    throw new Error(`${path} is not a folder only this user can write to; remove it and run the tests again.`);
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a process of another user's, which is running.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

ownFolder(PARENT);
for (const name of readdirSync(PARENT)) {
  const pid = Number(name);
  if (Number.isInteger(pid) && pid !== process.pid && !running(pid)) rmSync(join(PARENT, name), { recursive: true, force: true });
}
const mine = join(PARENT, String(process.pid));
ownFolder(mine);
process.env.TMPDIR = mine;
