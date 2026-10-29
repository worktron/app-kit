// The test start-up file every project names in bunfig.toml's preload, as `app-kit/testing/start-up`: every `bun test`
// process keeps its temporary files in /tmp/<project>-tests/<pid>, outside the system temporary folder, which slows
// every process started in it as it fills. <project> is the name in package.json where the tests run, or the folder's
// name when it has none.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** The project's name as one folder name: `@perf-buddy/server` is `perf-buddy-server`, so its owner is checked once. */
export function projectName(folder: string): string {
  let name = '';
  try {
    name = (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { name?: unknown }).name as string;
  } catch {
    // No package.json, or none that reads: the folder's name.
  }
  if (typeof name !== 'string' || !name) name = basename(folder);
  return name.replace(/^@/, '').replace(/[/\\]/g, '-');
}

// /tmp is shared by every account: use the folder only when it is a real folder this user owns that no one else can
// write to, so no one can plant files in it.
export function folderProblem(path: string, uid = process.getuid!()): string | null {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (e) {
    if ((e as { code?: string }).code !== 'EEXIST') return `cannot make it: ${String(e)}`;
  }
  const s = lstatSync(path);
  if (s.isSymbolicLink()) return 'it is a symlink';
  if (!s.isDirectory()) return 'it is not a folder';
  if (s.uid !== uid) return `it belongs to uid ${s.uid}, not ${uid}`;
  if (s.mode & 0o022) return `others can write to it (mode ${(s.mode & 0o777).toString(8)})`;
  return null;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM';
  }
};

// bun test runs no exit handler, so the folders of ended processes are removed by the next one.
export function sweepEnded(root: string): void {
  for (const name of readdirSync(root)) {
    if (!/^\d+$/.test(name) || alive(Number(name))) continue;
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      // Another process removing it at once.
    }
  }
}

const ROOT = `/tmp/${projectName(process.cwd())}-tests`;
const problem = folderProblem(ROOT);
if (problem) throw new Error(`the tests keep their temporary files in ${ROOT}, and ${problem}. Look at what is there, remove it if it is not yours, and run the tests again`);
process.env.TEST_SHARED_TMPDIR ??= tmpdir(); // for what every test process shares, like port reservations
const own = join(ROOT, String(process.pid));
try {
  mkdirSync(own); // fails with EEXIST for every file after the first in this process
  sweepEnded(ROOT);
} catch (e) {
  if ((e as { code?: string }).code !== 'EEXIST') throw e;
}
process.env.TMPDIR = own;
