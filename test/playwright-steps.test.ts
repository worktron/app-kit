// The Playwright steps load from inside node_modules, where an app has the kit. Playwright's test runner leaves files
// under node_modules to Node, which refuses TypeScript there, and the kit's own browser test imports the steps from
// this folder, so only a copy installed under node_modules shows what an app's tests get.
import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const root = join(import.meta.dir, '..');
const app = mkdtempSync(join(tmpdir(), 'app-kit-steps-'));
afterAll(() => rmSync(app, { recursive: true, force: true }));

/** Every plain JavaScript steps file, by its import name, and what it exports. */
const STEPS = {
  'app-kit/authentication/stand-in/playwright': 'STAND_IN_CODE hidePage lockFor serveNewerBuild showPage signInByCode',
  'app-kit/web/playwright': 'countLoads expectFits expectSteady finger largestTextSize noNewWindows takeFrames watchFrames',
  'app-kit/tauri/playwright': 'IPHONE_USER_AGENT fakeTauri handOverSignIn launchedByTap loadWithSignIn tapNotification tauriCalls windowAsksForSignIn',
  'app-kit/authentication/clerk/playwright': 'removeThrowawayUsers signInWithTicket throwawayUser withClerkBackoff',
};

test('an app loads every Playwright steps file by its import name with Node, from inside node_modules', () => {
  const modules = join(app, 'node_modules');
  const kit = join(modules, 'app-kit');
  mkdirSync(kit, { recursive: true });
  cpSync(join(root, 'package.json'), join(kit, 'package.json'));
  for (const file of ['authentication/stand-in/playwright.js', 'authentication/stand-in/code.js', 'web/playwright.js', 'tauri/playwright.js', 'authentication/clerk/playwright.js']) {
    mkdirSync(join(kit, dirname(file)), { recursive: true });
    cpSync(join(root, file), join(kit, file));
  }
  // The packages the steps import, which an app has installed beside the kit.
  for (const dependency of ['@playwright', 'playwright', 'playwright-core', '@clerk']) symlinkSync(join(root, 'node_modules', dependency), join(modules, dependency));

  const load = `for (const name of ${JSON.stringify(Object.keys(STEPS))}) console.log(Object.keys(await import(name)).sort().join(' '));`;
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(done.stdout.toString().trim().split('\n')).toEqual(Object.values(STEPS));
});
