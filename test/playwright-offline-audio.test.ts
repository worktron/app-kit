// The offline audio step loads from inside node_modules, where an app has the kit. Playwright's test runner leaves files
// under node_modules to Node, which refuses TypeScript there, and the kit's own browser test imports the step from
// web/, where Playwright compiles it, so only a copy installed under node_modules shows what an app's tests get: what
// reaches the page is the function's source alone, as Node reads it. That the page's audio opens no device is
// web/e2e/offline-audio.e2e.ts's to show.
import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const app = mkdtempSync(join(tmpdir(), 'app-kit-offline-audio-'));
afterAll(() => rmSync(app, { recursive: true, force: true }));

test('an app loads the offline audio step by its import name with Node, from inside node_modules, and it hands the page an init script with its options', () => {
  const kit = join(app, 'node_modules', 'app-kit');
  mkdirSync(join(kit, 'web'), { recursive: true });
  cpSync(join(root, 'package.json'), join(kit, 'package.json'));
  for (const file of ['playwright-offline-audio.js', 'playwright-offline-audio.d.ts']) cpSync(join(root, 'web', file), join(kit, 'web', file));
  mkdirSync(join(app, 'node_modules', '@playwright'));
  symlinkSync(join(root, 'node_modules/@playwright/test'), join(app, 'node_modules/@playwright/test'));

  // A stand-in for a page or browser context, which records the init script it is given.
  const load = `
    const { offlineAudio } = await import('app-kit/web/playwright-offline-audio');
    const given = [];
    const target = { addInitScript: async (script, arg) => given.push({ source: String(script), arg }) };
    await offlineAudio(target);
    await offlineAudio(target, { startsOnTap: true });
    console.log(JSON.stringify(given.map(({ source, arg }) => ({ installs: source.includes('OfflineAudioContext'), arg }))));`;
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(JSON.parse(done.stdout.toString())).toEqual([
    { installs: true, arg: { startsOnTap: false } },
    { installs: true, arg: { startsOnTap: true } },
  ]);
});
