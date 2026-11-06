import { defineConfig, devices } from '@playwright/test';

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
