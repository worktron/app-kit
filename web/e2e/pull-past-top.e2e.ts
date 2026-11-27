import { devices, expect, test, type Page } from '@playwright/test';
import { finger } from '../playwright';

// A pull down past the top opens a conversation's earlier messages (fixture/pull-past-top.html, web/pull-past-top.ts),
// on the page's own scroll and on a box's, with a real finger through Chromium's debugging protocol, at an iPhone's size
// with touch, so a drag scrolls the page and a fast lift leaves it coasting. Chromium is not the phone, whose stretch
// past the top iOS draws, its scroll reading below zero until the spring back ends; the unit tests hold the pull to wait
// for that end, as the iPhone Simulator showed it (web/pull-past-top.ts).

const { defaultBrowserType: _webkit, ...iphone } = devices['iPhone 13'];
test.use(iphone);

type Where = 'window' | 'box';

/** Where the conversation is scrolled to: the page's place, or the box's. */
const place = (page: Page) => page.evaluate(() => Math.round(document.querySelector('#box')?.scrollTop ?? window.scrollY));

/** Scrolls the conversation to `y` and waits until it is there. */
async function scrollTo(page: Page, y: number) {
  await page.evaluate((y) => {
    const box = document.querySelector('#box');
    if (box) box.scrollTop = y;
    else window.scrollTo(0, y);
  }, y);
  await expect.poll(() => place(page)).toBe(y);
}

/**
 * Resolves once the conversation has held still for ten frames, more than the three a released pull waits for before
 * it acts, and two frames after: what a lifted finger opens has opened by then.
 */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const at = () => document.querySelector('#box')?.scrollTop ?? window.scrollY;
        let still = 0;
        let last = at();
        const look = () => {
          still = Math.abs(at() - last) < 0.5 ? still + 1 : 0;
          last = at();
          if (still >= 10) resolve();
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
  );

const opens = (page: Page) => page.locator('#opens');
const newestTop = (page: Page) => page.locator('#newest').evaluate((el) => Math.round(el.getBoundingClientRect().top));

async function load(page: Page, where: Where) {
  await page.goto(where === 'box' ? '/pull-past-top.html?scroll=box' : '/pull-past-top.html');
  await expect(page.locator('#line')).toHaveText('Show earlier messages');
  expect(await place(page)).toBe(0);
}

/** A flick: down `dy` in a tenth of a second by the touches' own times, and up at full speed, so Chromium carries the
 *  page on after the finger lifts. */
async function flick(page: Page, x: number, y: number, dy: number) {
  const session = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  const at = (i: number) => ({ timestamp: t0 + i * 0.016 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], ...at(0) });
  for (let i = 1; i <= 6; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 6 }], ...at(i) });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], ...at(7) });
}

for (const where of ['window', 'box'] as const) {
  test.describe(`on the ${where}'s scroll`, () => {
    test('a pull of 40 points past the top opens nothing, and one of 110 opens them, the newest message staying where it was', async ({ page }, testInfo) => {
      await load(page, where);
      const touch = await finger(page);
      await touch.slide({ x: 195, y: 300 }, { x: 195, y: 340 });
      await settled(page);
      await expect(opens(page)).toHaveText('0');
      await expect(page.locator('#line')).toHaveText('Show earlier messages');
      const was = await newestTop(page);
      await touch.slide({ x: 195, y: 300 }, { x: 195, y: 410 });
      await expect(opens(page)).toHaveText('1');
      await expect(page.locator('#earlier')).toBeAttached();
      await settled(page);
      expect(Math.abs((await newestTop(page)) - was)).toBeLessThan(2);
      await page.screenshot({ path: testInfo.outputPath(`opened-${where}.png`) });
    });

    test('one drag from below the top that runs on past it opens them', async ({ page }) => {
      await load(page, where);
      await scrollTo(page, 200);
      await (await finger(page)).slide({ x: 195, y: 150 }, { x: 195, y: 150 + 200 + 130 }, { steps: 40 });
      await expect(opens(page)).toHaveText('1');
    });

    test('a flick that reaches the top only after the finger lifts opens nothing', async ({ page }) => {
      await load(page, where);
      await scrollTo(page, 700);
      // Where the conversation is as the finger lifts, read by the page in the lift's own event.
      await page.evaluate(() => {
        const box = document.querySelector('#box');
        window.addEventListener('touchend', () => document.body.setAttribute('data-lifted-at', String(box ? box.scrollTop : window.scrollY)), { once: true, capture: true });
      });
      await flick(page, 195, 150, 400);
      await expect.poll(() => place(page)).toBeLessThan(1);
      // The finger lifted well short of the top: what reached it is the page coasting.
      expect(Number(await page.locator('body').getAttribute('data-lifted-at'))).toBeGreaterThan(100);
      await settled(page);
      await expect(opens(page)).toHaveText('0');
      await expect(page.locator('#line')).toHaveText('Show earlier messages');
    });

    test('a drag more sideways than down never opens them, though it goes down by more than the pull', async ({ page }) => {
      await load(page, where);
      await (await finger(page)).slide({ x: 360, y: 300 }, { x: 40, y: 420 });
      await settled(page);
      await expect(opens(page)).toHaveText('0');
    });

    test("in an installed app, a pull opens them and never reloads, and once they are open a pull reloads", async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
      await load(page, where);
      await expect(page.locator('#loads')).toHaveText('1');
      const touch = await finger(page);
      await touch.slide({ x: 195, y: 150 }, { x: 195, y: 450 });
      await expect(opens(page)).toHaveText('1');
      await settled(page);
      await expect(page.locator('#loads')).toHaveText('1');
      await scrollTo(page, 0);
      await touch.slide({ x: 195, y: 150 }, { x: 195, y: 450 });
      await expect(page.locator('#loads')).toHaveText('2');
    });
  });
}
