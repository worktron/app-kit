// A browser test run killed partway (a stopped landing, a gate that timed out) reaches none of its cleanups, and the
// Dock and offline audio tests' copies of WebKit stayed in the system temporary folder for good, registered with macOS
// (2026-11-23). The run keeps its temporary files in a folder of its own beside the unit tests', which the next run
// removes, forgetting any app in it. Here the kit's browser test configuration runs one test that makes a scratch
// folder with an app in it, the run is killed, and the next run is started.
import { afterAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testsFolder } from '../testing/temporary-folder';

const root = join(import.meta.dir, '..');
const playwright = join(root, 'node_modules/.bin/playwright');
const fixture = join(import.meta.dir, 'fixtures/killed-browser-run');
const runs = testsFolder(root);
// What the run is given as its system temporary folder.
const given = mkdtempSync(join(tmpdir(), 'killed-run-given-'));
const env = { ...process.env, TMPDIR: given, E2E_PORT: '1' };
let runner: ChildProcess | undefined;
const left: string[] = [];
afterAll(() => {
  // A test stopped before it killed the run.
  if (runner?.pid && runner.exitCode === null && runner.signalCode === null) process.kill(-runner.pid, 'SIGKILL');
  for (const folder of [given, ...left]) rmSync(folder, { recursive: true, force: true });
});

/** Resolves with the scratch folder once the run's test prints it, or rejects with the run's output when it ends first. */
function scratchFolder(run: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const heard = (chunk: Buffer) => {
      output += chunk;
      const said = /^scratch folder: (.+)$/m.exec(output);
      if (said) resolve(said[1]!);
    };
    run.stdout!.on('data', heard);
    run.stderr!.on('data', heard);
    run.once('exit', () => reject(new Error(`the run ended before its test said where its scratch folder is:\n${output}`)));
  });
}

// Two Playwright starts, each compiling its configuration, which takes some seconds on a busy Mac.
test('a browser run killed partway leaves nothing in the system temporary folder, and the next run removes what it left', async () => {
  // In its own process group, as a run started from a terminal is, so the kill takes its workers too.
  const run = spawn(playwright, ['test', '--config', 'playwright.config.ts'], { cwd: fixture, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  runner = run;
  const scratch = await scratchFolder(run);
  const ended = new Promise((resolve) => run.once('exit', resolve));
  process.kill(-run.pid!, 'SIGKILL');
  // Reaped, so the next run does not take it for a live one.
  await ended;

  // The scratch folder is in the run's own folder, named by Playwright's main process, not in the one it was given.
  const runFolder = join(runs, String(run.pid));
  left.push(runFolder);
  expect(scratch.startsWith(`${runFolder}/killed-run-`), `${scratch} is in ${runFolder}`).toBe(true);
  expect(existsSync(join(scratch, 'Stand-in.app'))).toBe(true);
  // Only the compile cache Playwright's main process keeps there, named before the configuration loads.
  expect(readdirSync(given).filter((name) => name !== `playwright-transform-cache-${process.geteuid!()}`)).toEqual([]);

  // The next run, listing the tests, removes the folder the killed run left.
  const next = spawnSync(playwright, ['test', '--config', 'playwright.config.ts', '--list'], { cwd: fixture, env, encoding: 'utf8' });
  if (next.pid) left.push(join(runs, String(next.pid)));
  expect(next.status, next.stderr).toBe(0);
  expect(existsSync(runFolder)).toBe(false);
}, 60_000);
