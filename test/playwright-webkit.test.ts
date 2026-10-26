// The copy of Playwright's WebKit that macOS keeps out of the Dock (web/playwright-webkit.js), made in scratch folders,
// never the cache other checkouts' test runs use, from a stand-in for the WebKit Playwright installs: the parts the kit
// touches, a few files rather than WebKit's thousands. That the copy of the real WebKit starts, on Safari's engine, and
// stays out of the Dock is web/e2e/dock.e2e.ts's to show, since only a launch tells. The kit runs in its own
// process each time, as in an app's Playwright run: @playwright/test, which it imports, throws an AggregateError from a
// socket when it loads beside the simulated page every unit test here has.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import { webkit } from 'playwright';

// The tests run at once and each starts the kit in a bun process or more, up to nine together, so each is held to
// the fifteen seconds a test may take, not Bun's five, which a busy machine passed while they took 3.5 on main.
setDefaultTimeout(15_000);

const root = join(import.meta.dir, '..');
const scratch = mkdtempSync(join(tmpdir(), 'app-kit-webkit-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const folder = (name: string) => join(scratch, name);
const kit = join(root, 'web/playwright-webkit.js');

// Where Playwright puts this WebKit, under a browsers folder of the test's own, which PLAYWRIGHT_BROWSERS_PATH names.
const browsers = folder('browsers');
const executable = webkit.executablePath().slice(dirname(dirname(webkit.executablePath())).length + 1);
const installed = basename(dirname(executable));

/** Makes the stand-in: an app bundle signed ad hoc with the one entitlement Playwright's WebKit has, its run script, and the marker Playwright writes last. */
function installStandIn() {
  const app = join(browsers, installed, 'Playwright.app');
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${body}</dict></plist>\n`;
  writeFileSync(join(app, 'Contents/Info.plist'), plist('<key>CFBundleExecutable</key><string>Playwright</string><key>CFBundleIdentifier</key><string>com.example.stand-in</string>'));
  cpSync('/usr/bin/true', join(app, 'Contents/MacOS/Playwright'));
  const entitlements = folder('entitlements.plist');
  writeFileSync(entitlements, plist('<key>com.apple.security.get-task-allow</key><true/>'));
  execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', entitlements, app], { stdio: 'pipe' });
  writeFileSync(join(browsers, executable), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(browsers, installed, 'INSTALLATION_COMPLETE'), '');
}

/** Runs the kit's function in its own process, with `env` added, and returns what it returned and printed. */
function inProcess(cache: string, env: Record<string, string> = {}, before = '') {
  const script = `${before} const { webkitWithoutDockIcon } = await import(${JSON.stringify(kit)}); console.log(JSON.stringify(webkitWithoutDockIcon(${JSON.stringify(cache)})));`;
  return Bun.spawn(['bun', '-e', script], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, ...env }, stdout: 'pipe', stderr: 'pipe' });
}
const answer = async (run: ReturnType<typeof inProcess>) => ({
  options: JSON.parse((await new Response(run.stdout).text()) || 'null'),
  printed: await new Response(run.stderr).text(),
  code: await run.exited,
});

describe.if(process.platform === 'darwin')('on macOS', () => {
  beforeAll(installStandIn);

  test.concurrent('the copy says it is a background app, is signed and keeps the entitlement the original has', async () => {
    const cache = folder('one');
    const run = await answer(inProcess(cache));
    expect(run.printed).toContain("made a copy of Playwright's WebKit that stays out of the Dock");
    const { executablePath } = run.options;
    // In a folder of its own for this browsers folder, inside the cache.
    expect(basename(dirname(executablePath))).toBe(`${installed}-1`);
    expect(dirname(dirname(dirname(executablePath)))).toBe(cache);
    expect(basename(executablePath)).toBe(basename(executable));
    const app = join(dirname(executablePath!), 'Playwright.app');
    expect(execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()).toBe('true');
    execFileSync('codesign', ['--verify', app]);
    expect(execFileSync('codesign', ['-d', '--entitlements', '-', app], { encoding: 'utf8', stdio: 'pipe' })).toContain('com.apple.security.get-task-allow');
    // A second call takes the copy that is there, and says nothing.
    expect(await answer(inProcess(cache))).toEqual({ options: { executablePath }, printed: '', code: 0 });
  });

  test.concurrent('four runs making the copy at once leave one copy, and nothing half made', async () => {
    const cache = folder('four');
    const runs = await Promise.all([1, 2, 3, 4].map(() => answer(inProcess(cache))));
    expect(runs.map((run) => run.code)).toEqual([0, 0, 0, 0]);
    expect(new Set(runs.map((run) => run.options.executablePath)).size).toBe(1);
    const copy = dirname(runs[0]!.options.executablePath);
    expect(readdirSync(cache)).toEqual([basename(dirname(copy))]);
    expect(readdirSync(dirname(copy))).toEqual([basename(copy)]);
  });

  test.concurrent('a WebKit Playwright has not finished installing is left to Playwright, with a line saying so', async () => {
    // The folder Playwright would install this WebKit into, with no INSTALLATION_COMPLETE.
    const halfInstalled = folder('half-installed');
    mkdirSync(join(halfInstalled, installed), { recursive: true });
    const run = await answer(inProcess(folder('half-installed-cache'), { PLAYWRIGHT_BROWSERS_PATH: halfInstalled }));
    expect(run.options).toEqual({});
    expect(run.printed).toContain("Playwright's WebKit is not installed");
    expect(existsSync(folder('half-installed-cache'))).toBe(false);
  });

  test.concurrent('a new copy removes copies whose Playwright WebKit is gone, and keeps one whose WebKit is still there and anything it did not make', async () => {
    const cache = folder('orphans');
    const first = await answer(inProcess(cache));
    const copy = dirname(first.options.executablePath);
    const copies = dirname(copy);
    // Copies of a WebKit this browsers folder no longer has, a copy of the one it has made another way, and a file the kit never made.
    for (const name of ['webkit-1000-1', '.making-webkit-1000-1.123.456', `${installed}-0`]) mkdirSync(join(copies, name));
    writeFileSync(join(copies, 'webkit-1000-notes.txt'), '');
    // Another browsers folder's copies sit beside this one's, measured against their own.
    const other = join(cache, 'another-browsers-folder', 'webkit-1000-1');
    mkdirSync(other, { recursive: true });
    rmSync(copy, { recursive: true });
    const second = await answer(inProcess(cache));
    expect(second.code).toBe(0);
    expect(second.printed).toContain('removed');
    expect(readdirSync(copies).sort()).toEqual(['webkit-1000-notes.txt', `${installed}-0`, `${installed}-1`]);
    expect(existsSync(other)).toBe(true);
  });
});

test.concurrent('off macOS it gives no options, and Playwright starts its own WebKit', async () => {
  const run = await answer(inProcess(folder('linux'), {}, "Object.defineProperty(process, 'platform', { value: 'linux' });"));
  expect(run.options).toEqual({});
  expect(existsSync(folder('linux'))).toBe(false);
});

test.concurrent("an app loads it by its import name with Node, from inside node_modules, with only Playwright's test package beside it", () => {
  // Under Bun's isolated install the kit sees only its declared peers, so the file may import @playwright/test alone.
  const app = folder('app');
  const installed = join(app, 'node_modules', 'app-kit');
  mkdirSync(join(installed, 'web'), { recursive: true });
  cpSync(join(root, 'package.json'), join(installed, 'package.json'));
  for (const file of ['playwright-webkit.js', 'playwright-webkit.d.ts']) cpSync(join(root, 'web', file), join(installed, 'web', file));
  mkdirSync(join(app, 'node_modules', '@playwright'));
  symlinkSync(join(root, 'node_modules/@playwright/test'), join(app, 'node_modules/@playwright/test'));

  const load = "const kit = await import('app-kit/web/playwright-webkit'); console.log(Object.keys(kit).join(' '));";
  const done = Bun.spawnSync(['node', '--input-type=module', '-e', load], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
  expect(done.stderr.toString()).toBe('');
  expect(done.stdout.toString().trim()).toBe('webkitWithoutDockIcon');
});
