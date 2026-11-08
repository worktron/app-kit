import { expect, test, webkit } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { webkitWithoutDockIcon } from '../playwright-webkit.js';
import { type Seen, watchApplications } from '../../test/applications.ts';

// Playwright's WebKit started through the kit, watched in macOS's application list, where a Dock app is "Foreground"
// and one kept out of the Dock "UIElement". Playwright's own WebKit checks in as Foreground and turns itself into a
// UIElement some 50ms later, which is the icon that flashes; the copy must be a UIElement from its first event.

// The test's own copy of WebKit, so only the WebKit it starts is watched: the copy every checkout on the Mac shares is
// started by other threads' tests too, and one that started while this test watched held it open past its time limit
// (2026-11-07). It is made inside the test, since Playwright also loads this file in a process that runs no hooks.
test('WebKit started through the kit never shows in the Dock', async () => {
  test.skip(process.platform !== 'darwin', 'only macOS has a Dock');
  // Resolved, since macOS names a process's executable by its real path, under /private.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'app-kit-dock-')));
  let apps: Seen[];
  try {
    const options = webkitWithoutDockIcon(join(scratch, 'webkit'));
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
    apps = [...watch.seen.values()];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  // The copy was seen at all, so a watch that hears nothing cannot pass.
  expect(apps.length).toBeGreaterThan(0);
  expect(apps.flatMap((app) => app.types)).toContain('UIElement');
  expect(apps.flatMap((app) => app.types)).not.toContain('Foreground');
});
