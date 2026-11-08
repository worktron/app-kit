// The copy of Playwright's full Chromium that macOS keeps out of the Dock (testing/playwright-dock.js), made in a
// scratch folder from a stand-in laid out as Playwright installs Chromium: the executable deep inside its app bundle,
// unlike WebKit's run script beside its app, which test/playwright-webkit.test.ts covers. That the copy of the real
// Chromium loads an extension and stays out of the Dock is extension/e2e/dock.e2e.ts's to show, since only a launch
// tells. The file imports no Playwright package, so it runs here, in the test's own process.
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { withoutDockIcon } from '../testing/playwright-dock.js';

const scratch = mkdtempSync(join(tmpdir(), 'app-kit-dock-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const APP = 'chrome-mac-arm64/Google Chrome for Testing.app';
const EXECUTABLE = `${APP}/Contents/MacOS/Google Chrome for Testing`;

/** A Chromium install under `browsers`, signed ad hoc as Playwright's is, and the browser type that names it. */
function installStandIn(browsers: string, { complete = true } = {}) {
  const folder = join(browsers, 'chromium-1248');
  const app = join(folder, APP);
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  writeFileSync(
    join(app, 'Contents/Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Google Chrome for Testing</string><key>CFBundleIdentifier</key><string>com.example.stand-in</string></dict></plist>\n`,
  );
  cpSync('/usr/bin/true', join(folder, EXECUTABLE));
  execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  if (complete) writeFileSync(join(folder, 'INSTALLATION_COMPLETE'), '');
  return { name: () => 'chromium', executablePath: () => join(folder, EXECUTABLE) };
}

describe.if(process.platform === 'darwin')('on macOS', () => {
  test("Chromium's copy marks the app its executable is inside background only, signed, and starts that executable", () => {
    const browserType = installStandIn(join(scratch, 'browsers'));
    const cache = join(scratch, 'cache');
    const { executablePath } = withoutDockIcon(browserType, cache);
    expect(executablePath).toBeTruthy();
    // The same executable, inside the copy of the install folder, which sits in the cache.
    const [browsers] = readdirSync(cache);
    expect(relative(cache, executablePath!)).toBe(join(browsers!, 'chromium-1248-1', EXECUTABLE));
    const app = join(cache, browsers!, 'chromium-1248-1', APP);
    // LSBackgroundOnly, never LSUIElement, which Chromium reads as the mark of its own helper processes.
    const plist = join(app, 'Contents/Info.plist');
    expect(execFileSync('plutil', ['-extract', 'LSBackgroundOnly', 'raw', plist], { encoding: 'utf8' }).trim()).toBe('true');
    expect(() => execFileSync('plutil', ['-extract', 'LSUIElement', 'raw', plist], { stdio: 'pipe' })).toThrow();
    execFileSync('codesign', ['--verify', app]);
    // Playwright's own is left as it was.
    expect(() => execFileSync('plutil', ['-extract', 'LSBackgroundOnly', 'raw', join(browserType.executablePath(), '../../Info.plist')], { stdio: 'pipe' })).toThrow();
    // A second call takes the copy that is there.
    expect(withoutDockIcon(browserType, cache)).toEqual({ executablePath });
  });

  test('a Chromium Playwright has not finished installing is left to Playwright', () => {
    const browserType = installStandIn(join(scratch, 'half'), { complete: false });
    expect(withoutDockIcon(browserType, join(scratch, 'half-cache'))).toEqual({});
    expect(existsSync(join(scratch, 'half-cache'))).toBe(false);
  });
});
