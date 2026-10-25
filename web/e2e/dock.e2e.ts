import { expect, test, webkit } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { webkitWithoutDockIcon } from '../playwright-webkit.js';

// Playwright's WebKit started through the kit, watched in macOS's application list, where a Dock app is "Foreground"
// and one kept out of the Dock "UIElement". Playwright's own WebKit checks in as Foreground and turns itself into a
// UIElement some 50ms later, which is the icon that flashes; the copy must be a UIElement from its first event.

/** One application's events, by its application serial number: its type in each event that names one, and whether it ended. */
type Seen = { types: string[]; ended: boolean };

/**
 * Listens to macOS's application events for processes whose executable is under `folder`. Resolves once the listener
 * is taking events: it registers a background-only marker of its own, named for this run, and waits to hear it.
 */
async function watchApplications(folder: string) {
  const listen = spawn('lsappinfo', ['listen', '+all', 'forever'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const marker = `app-kit-dock-test-${process.pid}-${Date.now()}`;
  const seen = new Map<string, Seen>();
  const field = (line: string, key: string) => line.match(new RegExp(`"${key}"=("[^"]*"|[^,} ]+)`))?.[1]?.replace(/"/g, '');
  let heardMarker = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    heardMarker = resolve;
    listen.on('exit', (code, signal) => reject(new Error(`lsappinfo listen ended (${code ?? signal}) before it heard its marker`)));
  });
  let changed = () => {};
  let rest = '';
  listen.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop()!;
    for (const line of lines) {
      if (line.includes(marker)) heardMarker();
      const asn = field(line, 'LSASN');
      if (!asn) continue;
      const path = field(line, 'CFBundleExecutablePath') ?? field(line, 'LSBundlePath');
      if (path?.startsWith(folder) && !seen.has(asn)) seen.set(asn, { types: [], ended: false });
      const app = seen.get(asn);
      if (!app) continue;
      const type = field(line, 'ApplicationType');
      if (type) app.types.push(type);
      if (line.startsWith('Notification: kLSNotifyApplicationDeath')) app.ended = true;
      changed();
    }
  });
  // The marker lives only as long as this lsappinfo, which registers it and exits.
  // A marker that cannot be registered stops the listener, which fails the wait with the reason above.
  const register = () => {
    const done = spawnSync('lsappinfo', ['register', 'ApplicationType=BackgroundOnly', `LSDisplayName=${marker}`], { encoding: 'utf8' });
    if (done.status !== 0) {
      console.error(`lsappinfo register failed: ${done.stderr || done.error}`);
      listen.kill();
    }
  };
  register();
  const retry = setInterval(register, 1000);
  try {
    await ready;
  } finally {
    clearInterval(retry);
  }
  return {
    seen,
    /** Resolves once every application seen has ended, the event that comes after any change of its type. */
    allEnded: () =>
      new Promise<void>((resolve) => {
        changed = () => [...seen.values()].every((app) => app.ended) && resolve();
        changed();
      }),
    stop: () => listen.kill(),
  };
}

test('WebKit started through the kit never shows in the Dock', async () => {
  test.skip(process.platform !== 'darwin', 'only macOS has a Dock');
  const options = webkitWithoutDockIcon();
  expect(options.executablePath, "Playwright's WebKit is installed: bunx playwright install webkit").toBeTruthy();
  const watch = await watchApplications(dirname(options.executablePath!));
  try {
    const browser = await webkit.launch(options);
    const page = await browser.newPage();
    // Safari's engine, not Chromium's.
    expect(await page.evaluate(() => navigator.userAgent)).toMatch(/AppleWebKit\/.*Safari\/(?!.*Chrome)/);
    await browser.close();
    await watch.allEnded();
  } finally {
    watch.stop();
  }
  const apps = [...watch.seen.values()];
  // The copy was seen at all, so a watch that hears nothing cannot pass.
  expect(apps.length).toBeGreaterThan(0);
  expect(apps.flatMap((app) => app.types)).toContain('UIElement');
  expect(apps.flatMap((app) => app.types)).not.toContain('Foreground');
});
