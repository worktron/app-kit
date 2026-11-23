// Playwright loads every browser test file in its main process to list the tests, a process that runs none of their
// hooks, so a file that makes a temporary folder as it loads leaves one behind on every run, and the system temporary
// folder filled with them (web/e2e/offline-audio.e2e.ts, 2026-11-22). Listing the tests does that load and nothing
// else, here with a temporary folder of the test's own.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const folder = mkdtempSync(join(tmpdir(), 'browser-tests-load-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

// The listing compiles all the browser test files afresh in an empty folder, which takes some seconds on a busy Mac,
// past bun's five second default.
test('loading the browser test files leaves nothing in the temporary folder', () => {
  const listed = Bun.spawnSync([join(root, 'node_modules/.bin/playwright'), 'test', '--config', 'playwright.config.ts', '--list'], {
    cwd: join(root, 'web/e2e'),
    // The config asks for the port scripts/e2e.sh picks; listing starts no server.
    env: { ...process.env, TMPDIR: folder, E2E_PORT: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(listed.exitCode, listed.stderr.toString()).toBe(0);
  expect(listed.stdout.toString()).toContain('offline-audio.e2e.ts');
  // Playwright keeps its own compile cache there.
  expect(readdirSync(folder).filter((name) => !name.startsWith('playwright-'))).toEqual([]);
}, 60_000);
