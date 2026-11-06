import { defineConfig, devices } from '@playwright/test';

// The kit's browser test against the App Kit Clerk development instance, run by scripts/e2e-clerk.sh with a free port
// and the instance's keys. One worker, tests in order: shared.e2e.ts's five tests share one user, and each.e2e.ts runs
// the same five making a user each, so the counts global-setup.ts checks compare the two.
const port = Number(process.env.E2E_PORT);
if (!port) throw new Error('Run the Clerk browser test through scripts/e2e-clerk.sh, which gives it its own port.');

export default defineConfig({
  testDir: '.',
  forbidOnly: true,
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  globalSetup: './global-setup.ts',
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'] },
  projects: [
    { name: 'shared', testMatch: 'shared.e2e.ts' },
    { name: 'each', testMatch: 'each.e2e.ts' },
  ],
  webServer: { command: 'bun serve.ts', url: `http://localhost:${port}`, reuseExistingServer: false },
});
