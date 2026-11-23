/*
 * The menu check a Mac release runs before it publishes: the exact update archive about to go up is sent to a worker
 * Mac through fleet's `worker-run`, which offers a job to the first free worker whose desktop a job can reach, one job
 * at a time; there the app is started with the check on, chooses every item in its own menu bar, and is judged
 * (menu-check-entry.ts). Nothing runs on this Mac, whose screen is the owner's.
 *
 * The door takes a job as a git bundle holding one commit with `scripts/worker-entry`, so the job is a repository of
 * its own, made in the release's temporary folder: the archive, the entry and the two files of the kit it runs. The
 * door copies it into its own folder for the repository's name and runs the entry there. A job holds no argument: the
 * door allows none with a space, and app names have them, so the worker reads the app's name from its Info.plist.
 *
 * Answers: 0 the app passed; 5 it failed, and holds until main moves, as a build that will not compile does; anything
 * else stops the release as a failure to try again (1): every worker busy for WAIT_MS (75 each time), none reachable
 * (68), the worker refused because it holds a real copy of the app (6), no `worker-run` on this Mac (127), or the
 * connection lost.
 */
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { lastLine } from '../testflight/key.ts';
import type { Run } from '../../command-line/run.ts';
import { FAILED, PASSED, REFUSED } from './menu-check-entry.ts';

/** The name the door keeps the job's copy under on each worker. */
export const JOB_REPOSITORY = 'app-kit-menu-check';
/** worker-run's answers when no worker took the job: every one busy, or none reachable (fleet's bin/worker-run.ts). */
export const BUSY = 75;
export const NONE_REACHABLE = 68;
/** How long a release waits for a free worker, and how often it asks again meanwhile. */
export const WAIT_MS = 15 * 60_000;
export const ASK_EVERY_MS = 30_000;
/** How long a job may run on the worker: the check's own limit is three minutes, and unpacking and cleaning up a minute. */
export const JOB_MS = 6 * 60_000;

/** The files of the kit the job carries, by their path in the kit, which is also their path in the job. */
const KIT_FILES = ['tauri/mac-release/menu-check-entry.ts', 'tauri/window/names.ts'];
const KIT = join(import.meta.dir, '../..');

/** The entry the door runs, from the job's own folder. */
export const ENTRY = `#!/bin/sh\n# app-kit's menu check, sent by a Mac release (tauri/mac-release/menu-check.ts).\ncd "$(dirname "$0")/.." && exec bun ${KIT_FILES[0]}\n`;

export type MenuCheckOptions = {
  run: Run;
  env: Record<string, string | undefined>;
  /** The update archive about to be published. */
  archive: string;
  /** A folder of the release's own to make the job in, which it removes. */
  folder: string;
  print: (line: string) => void;
  output: (chunk: string) => void;
  /** Waits between asks for a free worker; tests pass one that moves a clock. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type MenuCheckResult = { code: 0 | 1 | 5; line: string };

/** Makes the job's repository and its bundle, and returns the bundle's path and its commit. */
async function makeJob(options: MenuCheckOptions): Promise<{ bundle: string; sha: string } | string> {
  const { run, env, folder } = options;
  const job = join(folder, 'menu-check-job');
  mkdirSync(join(job, 'scripts'), { recursive: true });
  copyFileSync(options.archive, join(job, basename(options.archive)));
  for (const file of KIT_FILES) {
    mkdirSync(join(job, file, '..'), { recursive: true });
    copyFileSync(join(KIT, file), join(job, file));
  }
  writeFileSync(join(job, 'scripts/worker-entry'), ENTRY);
  chmodSync(join(job, 'scripts/worker-entry'), 0o755);
  const git = (...args: string[]) => run(['git', '-c', 'user.name=app-kit', '-c', 'user.email=app-kit@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: job, env });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'menu check']]) {
    const done = await git(...args);
    if (done.code !== 0) return `git ${args[0]} failed making the menu check's job: ${lastLine(done.out)}`;
  }
  const sha = (await git('rev-parse', 'HEAD')).out.trim();
  const bundle = join(folder, 'menu-check.bundle');
  const bundled = await git('bundle', 'create', bundle, 'main');
  if (bundled.code !== 0 || !/^[0-9a-f]{40}$/.test(sha)) return `git could not bundle the menu check's job: ${lastLine(bundled.out)}`;
  return { bundle, sha };
}

/** Runs the check on a worker, waiting for one while all are busy, and says how it went. */
export async function menuCheck(options: MenuCheckOptions): Promise<MenuCheckResult> {
  const job = await makeJob(options);
  if (typeof job === 'string') return { code: 1, line: job };
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const until = now() + WAIT_MS;
  for (;;) {
    const done = await options.run(['worker-run', JOB_REPOSITORY, job.sha], { env: options.env, inputFile: job.bundle, timeoutMs: JOB_MS, output: options.output });
    // The verdict is the check's own last line, printed after its notes, which start otherwise (NOTE); the door adds
    // lines of its own after it.
    const said = done.out.split('\n').filter((each) => each.startsWith('menu check: ')).pop() ?? lastLine(done.out);
    if (done.code === PASSED) return { code: 0, line: said };
    if (done.code === FAILED) return { code: 5, line: said };
    if (done.code === BUSY && now() < until) {
      options.print(`every worker Mac is busy; asking again in ${ASK_EVERY_MS / 1000} s`);
      await wait(ASK_EVERY_MS);
      continue;
    }
    if (done.code === BUSY) return { code: 1, line: `every worker Mac stayed busy for ${WAIT_MS / 60_000} minutes, so the built app was not tried and nothing is published` };
    if (done.code === NONE_REACHABLE) return { code: 1, line: `no worker Mac could be reached, so the built app was not tried and nothing is published: ${said}` };
    if (done.code === REFUSED) return { code: 1, line: `the worker Mac refused the check: ${said}` };
    if (done.code === 127) return { code: 1, line: "this Mac has no worker-run, fleet's command that runs a job on a worker Mac, which a release tries the built app through" };
    if (done.timedOut) return { code: 1, line: `the menu check ran past ${JOB_MS / 60_000} minutes on the worker and was stopped` };
    return { code: 1, line: `the menu check could not run on a worker Mac (worker-run exited ${done.code}): ${said}` };
  }
}
