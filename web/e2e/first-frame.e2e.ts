import { expect, test, webkit, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { signInByCode } from '../../authentication/stand-in/playwright';
import { expectSteady, takeFrames, watchFrames } from '../playwright';
import { webkitWithoutDockIcon } from '../playwright-webkit.js';

// What the fixture shows while it opens: the name its index.html draws before the code loads, in one of two pictures
// (README, "The first frame and the fonts"). Signed out, where a home page draws its title. For a browser signed in last
// time, which firstPaint marks before the first paint, where the signed-in bar draws it, so the name never jumps: the
// gate's whileReturning draws it there while the list loads, and then the app's own bar. Each step of the load is held
// until the test has looked at the one before. In Chromium and in WebKit, Safari's engine, where the jump was recorded
// on a phone.

const PAPER = 'rgb(244, 239, 230)';
/** The fixture's built scripts, which draw everything after the name the page draws itself. */
const SCRIPTS = /\/assets\/[^/]+\.js$/;

/** Holds every request matching `url` until the test lets them go. */
async function hold(page: Page, url: string | RegExp, answer: (route: Route) => Promise<void> = (route) => route.continue()) {
  const held: Route[] = [];
  let open = false;
  await page.route(url, (route) => (open ? answer(route) : void held.push(route)));
  return {
    seen: () => expect.poll(() => held.length).toBeGreaterThan(0),
    release: async () => {
      open = true;
      for (const route of held.splice(0)) await answer(route);
    },
  };
}

/** The list the fixture's home screen asks for, and its health check. */
const answerApi = (route: Route) =>
  new URL(route.request().url()).pathname === '/api/health' ? route.fulfill({ body: 'ok' }) : route.fulfill({ json: { items: [{ id: '1', title: 'Dentist on Tuesday' }] } });

/** Waits until the page has drawn a frame of the name alone, before its code runs. */
const nameAlone = (page: Page) =>
  expect.poll(() => page.evaluate(() => (window as unknown as { __appKitFrames: { text: string }[] }).__appKitFrames.some((frame) => frame.text === 'fixture'))).toBe(true);

/**
 * The name as the page draws it before its code runs, in a new page of the same context, whose scripts never load: a
 * page still loading cannot be photographed in WebKit, which waits for the load to finish.
 */
async function nameBeforeTheCode(context: BrowserContext, clip: { x: number; y: number; width: number; height: number }) {
  const page = await context.newPage();
  await page.route(SCRIPTS, (route) => route.abort());
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('root')!, '::before').content)).toBe('"fixture"');
  const picture = await page.screenshot({ clip });
  const mark = await marked(page);
  await page.close();
  return { picture, marked: mark };
}

const marked = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-signed-in-before'));

const engines: { name: string; open: (chromium: Browser) => Promise<Browser>; close: (browser: Browser) => Promise<void> }[] = [
  { name: 'Chromium', open: async (chromium) => chromium, close: async () => {} },
  { name: 'WebKit', open: () => webkit.launch(webkitWithoutDockIcon()), close: (browser) => browser.close() },
];

for (const engine of engines) {
  test(`${engine.name}: opening signed out starts on the name, with no mark and no empty frame`, async ({ browser: chromium, baseURL }) => {
    const browser = await engine.open(chromium);
    try {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.route('**/api/**', answerApi);
      await page.goto('/');
      await expect(page.getByLabel('Email')).toBeVisible();

      await watchFrames(context);
      const scripts = await hold(page, SCRIPTS);
      const reloaded = page.reload();
      await scripts.seen();
      await nameAlone(page);
      expect(await marked(page)).toBe(false);
      await scripts.release();
      await reloaded;
      await expect(page.getByLabel('Email')).toBeVisible();

      const frames = await takeFrames(page);
      expectSteady(frames, PAPER);
      expect(frames[0]!.text).toBe('fixture');
      await context.close();
    } finally {
      await engine.close(browser);
    }
  });

  test(`${engine.name}: opening signed in draws the name where the bar draws it, then the bar, then the app, with no jump`, async ({ browser: chromium, baseURL }) => {
    const browser = await engine.open(chromium);
    try {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.route('**/api/**', answerApi);
      await page.goto('/');
      await signInByCode(page, 'ana@example.com');
      await expect(page.getByText('Dentist on Tuesday')).toBeVisible();
      // The bar's name, where its letters are, so the pictures are compared where the name stands.
      const clip = await page.locator('[data-bar-name]').evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const box = range.getBoundingClientRect();
        return { x: Math.floor(box.left) - 4, y: Math.floor(box.top) - 4, width: Math.ceil(box.width) + 8, height: Math.ceil(box.height) + 8 };
      });
      const finished = await page.screenshot({ clip });
      expect(await nameBeforeTheCode(context, clip), 'the name before the code, where the bar draws it').toEqual({ picture: finished, marked: true });

      await watchFrames(context);
      const scripts = await hold(page, SCRIPTS);
      const list = await hold(page, '**/api/**', answerApi);
      const reloaded = page.reload();
      await scripts.seen();
      await nameAlone(page);
      expect(await marked(page)).toBe(true);

      await scripts.release();
      await reloaded;
      await list.seen();
      // Held on the list, the gate draws whileReturning: the name in the bar, alone.
      await expect(page.getByRole('progressbar')).toHaveText('fixture');
      expect(await page.screenshot({ clip }), 'the gate’s name while the list loads').toEqual(finished);

      await list.release();
      await expect(page.getByText('Dentist on Tuesday')).toBeVisible();
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      expect(await page.screenshot({ clip }), 'the app’s own bar').toEqual(finished);

      const frames = await takeFrames(page);
      expectSteady(frames, PAPER);
      expect(frames[0]!.text).toBe('fixture');
      expect(frames.filter((frame) => !frame.text.startsWith('fixture')).map((frame) => frame.text)).toEqual([]);
      await context.close();
    } finally {
      await engine.close(browser);
    }
  });
}
