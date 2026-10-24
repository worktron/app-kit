// The Playwright steps load from inside node_modules, where an app has the kit. Playwright's test runner leaves files
// under node_modules to Node, which refuses TypeScript there, and the kit's own browser test imports the steps from
// this folder, so only a copy installed under node_modules shows what an app's tests get.
import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const app = mkdtempSync(join(tmpdir(), 'app-kit-steps-'));
afterAll(() => rmSync(app, { recursive: true, force: true }));

test('an app loads the Playwright steps by their import name with Node, from inside node_modules', () => {
  const kit = join(app, 'node_modules', 'app-kit');
  mkdirSync(kit, { recursive: true });
  cpSync(join(root, 'package.json'), join(kit, 'package.json'));
  cpSync(join(root, 'testing'), join(kit, 'testing'), { recursive: true });

  const load = "const steps = await import('app-kit/web/testing/playwright'); console.log(Object.keys(steps).sort().join(' '));";
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(done.stdout.toString().trim()).toBe('hidePage serveNewerBuild showPage');
});
