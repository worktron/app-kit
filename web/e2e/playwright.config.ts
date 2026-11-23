import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { testsFolder, useOwnFolder } from '../../testing/temporary-folder.ts';

// The run keeps its temporary files, its tests' copies of WebKit and its browsers' profiles, in a folder of its own beside
// the unit tests', /tmp/app-kit-tests/<this process's pid>, never in the system temporary folder: a run killed partway
// reaches none of its cleanups, and the next run of either kind removes the folder and has macOS forget the copies
// (test/browser-test-killed.test.ts). Only Playwright's main process takes it, before it starts any worker or the
// server; they inherit its TMPDIR, and each worker loads this file again with TEST_WORKER_INDEX already set.
if (!process.env.TEST_WORKER_INDEX) useOwnFolder(testsFolder(join(import.meta.dirname, '../..')));

// scripts/e2e.sh builds the fixture and picks a free port for each run, and passes it in.
const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the browser tests through scripts/e2e.sh, which gives them their own port.');

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  // Runs the kit's command as a program under bun test, from scripts/gates.sh.
  testIgnore: 'drive.e2e.ts',
  forbidOnly: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun serve.ts',
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
});
