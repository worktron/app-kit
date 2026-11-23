/*
 * The gates install Playwright's Chromium and WebKit before the first browser test. Any project's `playwright install`
 * deletes every build in the cache every checkout on the Mac shares that no checkout still on disk has registered, and a
 * checkout registers only by installing, so without this step a landing stops whenever another project's install took
 * the builds. --no-remove keeps the gates' own install from deleting other projects' builds the same way.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lines = readFileSync(join(import.meta.dir, '../scripts/gates.sh'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const INSTALL = 'bunx playwright install --no-remove chromium webkit';
/** Every gates line that starts a browser: the web fixture's tests, and each Bun test file under an e2e folder. */
const startsBrowser = (line: string) => line === 'bash scripts/e2e.sh' || /^bun test \.\/\S+\/e2e\//.test(line);

test('the gates install Playwright browsers without deleting other projects builds, before any browser test', () => {
  const install = lines.indexOf(INSTALL);
  expect(install, `scripts/gates.sh runs ${INSTALL}`).toBeGreaterThan(-1);
  const firstBrowser = lines.findIndex(startsBrowser);
  expect(firstBrowser, 'scripts/gates.sh runs the browser tests').toBeGreaterThan(-1);
  expect(install).toBeLessThan(firstBrowser);
});

test('no other Playwright install in the gates runs its cleanup', () => {
  const installs = lines.filter((line) => /playwright install/.test(line));
  expect(installs).toEqual([INSTALL]);
});
