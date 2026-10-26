import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FONT_WAIT_MS } from '../fonts';
import { finger } from './finger';

// The pieces an installed app adds (fixture/pieces.html), the font wait (fixture/fonts.html) and the first frame every
// fixture page paints, in Chromium with touch.

test.use({ hasTouch: true });

/** Opens the page as a web app opened from the home screen, which Safari tells by navigator.standalone. */
async function asInstalledApp(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
}

const loads = (page: Page) => page.locator('#loads');

test('in an installed app, a pull down from the top of the page reloads it', async ({ page }) => {
  await asInstalledApp(page);
  await page.goto('/pieces.html');
  await expect(loads(page)).toHaveText('1');
  await (await finger(page)).slide({ x: 300, y: 30 }, { x: 300, y: 330 });
  await expect(loads(page)).toHaveText('2');
});

test('a refresh that fails says so in words on the screen, within the narrowest phone at its largest Text Size, and reloads nothing', async ({ page }, testInfo) => {
  await asInstalledApp(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/pieces.html?pull=fails');
  await expect(loads(page)).toHaveText('1');
  // The root size followTextSize sets at the largest accessibility size, about 3.12 times the default.
  await page.evaluate(() => (document.documentElement.style.fontSize = '312%'));
  await (await finger(page)).slide({ x: 160, y: 30 }, { x: 160, y: 330 });
  const words = page.getByText('Refresh failed. Pull down to try again.');
  await expect(words).toBeVisible();
  const box = (await words.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: testInfo.outputPath('refresh-failed.png') });
  await expect(loads(page)).toHaveText('1');
});

test('a sideways swipe, and a pull inside a scrolled list, never reload', async ({ page }) => {
  await asInstalledApp(page);
  await page.goto('/pieces.html');
  await expect(loads(page)).toHaveText('1');
  const touch = await finger(page);
  await touch.slide({ x: 100, y: 30 }, { x: 500, y: 130 });
  await page.locator('#list').evaluate((list) => (list.scrollTop = 300));
  const list = (await page.locator('#list').boundingBox())!;
  await touch.slide({ x: list.x + 50, y: list.y + 10 }, { x: list.x + 50, y: list.y + 310 });
  // A pull that does reload, after them: had either reloaded, the page would count three loads.
  await touch.slide({ x: 300, y: 30 }, { x: 300, y: 330 });
  await expect(loads(page)).toHaveText('2');
});

test("a field drawn with the kit's field size, beside the app's own field settings, is never under 16 pixels and grows with the root size", async ({ page }) => {
  await page.goto('/pieces.html');
  const field = page.getByRole('textbox', { name: 'Note' });
  // The root sizes the smallest and largest Text Size give a 16 pixel root, set by hand: Chromium has no Text Size.
  const sizeAt = (root: string) =>
    field.evaluate((input, root) => {
      document.documentElement.style.fontSize = root;
      const style = getComputedStyle(input);
      return [style.fontSize, style.letterSpacing];
    }, root);
  expect(await sizeAt('13px')).toEqual(['16px', '0.16px']);
  expect(await sizeAt('50px')).toEqual(['50px', '0.5px']);
});

for (const [scheme, background, rgb] of [
  ['dark', '#14110f', 'rgb(20, 17, 15)'],
  ['light', '#f4efe6', 'rgb(244, 239, 230)'],
] as const) {
  test(`the first frame is in the ${scheme} scheme's colors before the app's code runs, with the bar color to match`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // The app's code never arrives, so what shows is the head's alone.
    await page.route('**/assets/**', (route) => route.abort());
    await page.goto('/pieces.html');
    const painted = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bars: [...document.querySelectorAll('meta[name="theme-color"]')].map((tag) => tag.getAttribute('content')),
    }));
    expect(painted).toEqual({ body: rgb, colorScheme: scheme, bars: [background] });
  });
}

/** A real font file to serve as the fixture's face: Playwright's own icon font, whose name carries a hash. */
function fontFile(): Buffer {
  const folder = join(import.meta.dirname, '../../node_modules/playwright-core/lib/vite/traceViewer');
  const name = readdirSync(folder).find((file) => /^codicon.*\.ttf$/.test(file));
  if (!name) throw new Error(`No codicon font in ${folder} to serve as the fixture's face; Playwright has moved it.`);
  return readFileSync(join(folder, name));
}

/** Time stands still in the page until the test moves it, so the font wait gives up only when the test says. */
async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T09:00:00') });
  await page.clock.pauseAt(new Date('2026-01-01T09:00:01'));
}

/** Holds the face's file until the test lets it go, and says when the page has asked for it. */
async function holdFont(page: Page) {
  let release: () => void = () => undefined;
  let asked: () => void = () => undefined;
  const wasAsked = new Promise<void>((resolve) => (asked = resolve));
  await page.route('**/fonts/fixture-face.ttf', async (route) => {
    asked();
    await new Promise<void>((resolve) => (release = resolve));
    await route.fulfill({ body: fontFile(), contentType: 'font/ttf' });
  });
  return { wasAsked, release: () => release() };
}

test('the first draw waits for the face, and draws in it once it is in', async ({ page }) => {
  await pauseClock(page);
  // The face's state at the moment the page first puts anything in its root.
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.getElementById('root')?.childElementCount) return;
      const face = [...document.fonts].find((f) => f.family.replace(/["']/g, '') === 'Fixture Face');
      (window as { faceAtFirstDraw?: string }).faceAtFirstDraw = face?.status ?? 'missing';
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  const font = await holdFont(page);
  // The page's load event waits for the face, so the test goes on once the page is under way.
  await page.goto('/fonts.html', { waitUntil: 'commit' });
  await font.wasAsked;
  await expect(page.locator('#root')).toBeEmpty();
  font.release();
  await expect(page.getByText('Drawn in the fixture face')).toBeVisible();
  expect(await page.evaluate(() => (window as { faceAtFirstDraw?: string }).faceAtFirstDraw)).toBe('loaded');
});

test('a face that never arrives holds the first draw only until the font wait gives up', async ({ page }) => {
  await pauseClock(page);
  const font = await holdFont(page);
  // The page's load event waits for the face, so the test goes on once the page is under way.
  await page.goto('/fonts.html', { waitUntil: 'commit' });
  await font.wasAsked;
  await page.clock.fastForward(FONT_WAIT_MS - 1);
  await expect(page.locator('#root')).toBeEmpty();
  await page.clock.fastForward(1);
  await expect(page.getByText('Drawn in the fixture face')).toBeVisible();
});

test("a request sent as the page closes goes out at once, with the provider's held token, while a fresh one is still being asked for", async ({ page, request }) => {
  const id = crypto.randomUUID();
  await page.goto(`/pieces.html?leave=${id}`);
  await expect(page.getByRole('heading', { name: 'Pieces' })).toBeVisible();
  await page.close();
  await expect.poll(async () => (await request.get(`/api/left/${id}`)).json()).toContainEqual({ method: 'DELETE', authorization: 'Bearer stand-in-token-0' });
  // Every send was signed: hidden and then left, the page may send twice.
  const sent: { authorization: string | null }[] = await (await request.get(`/api/left/${id}`)).json();
  expect(sent.every((s) => s.authorization === 'Bearer stand-in-token-0')).toBe(true);
});
