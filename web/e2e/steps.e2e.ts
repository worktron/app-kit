import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { hidePage, lockFor, serveNewerBuild, showPage } from '../../authentication/stand-in/playwright';
import { standInTicket } from '../../authentication/stand-in';
import { NOT_FROM_THIS_WINDOW } from '../../tauri/sign-in';
import { fakeTauri, handOverSignIn, IPHONE_USER_AGENT, launchedByTap, loadWithSignIn, tapNotification, tauriCalls, windowAsksForSignIn } from '../../tauri/playwright';
import { countLoads, expectFits, expectSteady, finger, largestTextSize, noNewWindows, takeFrames, watchFrames } from '../playwright';

// The Playwright steps' own behavior, each against a page of the fixture or a page the test writes; kit.e2e.ts drives
// the steps against the fixture app.

test('serving a newer build fails at once, saying why, on a page that names no Vite entry', async ({ browser }) => {
  const server = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<p>No build here</p>'));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  try {
    await expect(serveNewerBuild(await context.newPage())).rejects.toThrow('names no module script under /assets/ to rename');
  } finally {
    await context.close();
    server.close();
  }
});

/** A plain page of the fixture's, which needs no server answers. */
const plainPage = '/text-size.html';

/** What the page reads of its own visibility, both ways, and the visibility changes it heard. */
async function visibility(page: Page) {
  return page.evaluate(() => ({ state: document.visibilityState, hidden: document.hidden, heard: (window as unknown as { heard: string[] }).heard }));
}

async function listenForVisibility(page: Page) {
  await page.evaluate(() => {
    const heard: string[] = [];
    Object.assign(window, { heard });
    document.addEventListener('visibilitychange', () => heard.push(document.visibilityState));
  });
}

test('hiding the page reads hidden both ways, and showing it reads visible both ways again', async ({ page }) => {
  await page.goto(plainPage);
  await listenForVisibility(page);
  await hidePage(page);
  expect(await visibility(page)).toEqual({ state: 'hidden', hidden: true, heard: ['hidden'] });
  await showPage(page);
  expect(await visibility(page)).toEqual({ state: 'visible', hidden: false, heard: ['hidden', 'visible'] });
});

test('a locked phone moves the page\'s own time on by exactly the time away, fires no timer, and comes back in front', async ({ page }) => {
  const start = Date.parse('2026-10-25T20:00:00Z');
  await page.clock.install({ time: start });
  await page.goto(plainPage);
  await page.clock.pauseAt(start + 60_000);
  await listenForVisibility(page);
  await page.evaluate(() => setTimeout(() => Object.assign(window, { fired: true }), 1000));
  await lockFor(page, 45 * 60_000);
  expect(await page.evaluate(() => Date.now())).toBe(start + 60_000 + 45 * 60_000);
  expect(await page.evaluate(() => (window as unknown as { fired?: boolean }).fired ?? false)).toBe(false);
  expect(await visibility(page)).toEqual({ state: 'visible', hidden: false, heard: ['hidden', 'visible'] });
});

test('a locked phone without an installed clock fails at once, saying so', async ({ page }) => {
  await page.goto(plainPage);
  await expect(lockFor(page, 60_000)).rejects.toThrow('install the clock with page.clock.install()');
});

test('page loads are counted from the step on', async ({ page }) => {
  await page.goto(plainPage);
  const count = countLoads(page);
  await page.reload();
  await page.goto(plainPage);
  expect(count.loads).toBe(2);
});

test('frames are noted from the first, and a page drawn in one background throughout is steady', async ({ page, context }) => {
  await watchFrames(context, { root: 'main' });
  await page.goto(plainPage);
  await expect(page.getByRole('heading', { name: 'Text size' })).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expectSteady(await takeFrames(page), 'rgb(244, 239, 230)');
});

test('a frame with nothing drawn, or in another background, is not steady', () => {
  const drawn = { background: 'rgb(0, 0, 0)', drawn: true, text: 'App' };
  expect(() => expectSteady([], 'rgb(0, 0, 0)')).toThrow('frames noted');
  expect(() => expectSteady([drawn, { ...drawn, drawn: false, text: '' }], 'rgb(0, 0, 0)')).toThrow('frames with nothing drawn');
  expect(() => expectSteady([drawn, { ...drawn, background: 'rgb(255, 255, 255)' }], 'rgb(0, 0, 0)')).toThrow('the backgrounds the page showed');
});

test('a finger\'s slide is touch from landing to lift, ending where it was sent', async ({ page }) => {
  await page.goto(plainPage);
  await page.evaluate(() => {
    // As a row that takes swipes does, so the browser leaves the finger to the page rather than panning it.
    document.documentElement.style.touchAction = 'none';
    const seen: string[] = [];
    Object.assign(window, { seen });
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      document.addEventListener(type, (event) => {
        const pointer = event as PointerEvent;
        seen.push(`${type} ${pointer.pointerType} ${Math.round(pointer.clientX)}`);
      });
    }
  });
  await (await finger(page)).slide({ x: 300, y: 200 }, { x: 60, y: 200 });
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen[0]).toBe('pointerdown touch 300');
  expect(seen.at(-1)).toBe('pointerup touch 60');
  expect(seen.filter((line) => line.startsWith('pointermove')).every((line) => line.includes(' touch '))).toBe(true);
});

test.describe('no new windows', () => {
  const [watchWindows] = noNewWindows;

  /** A page with a link that opens a new window, and the context it is in. */
  async function pageWithLink(page: Page) {
    await page.goto(plainPage);
    await page.evaluate(() => {
      const link = Object.assign(document.createElement('a'), { href: 'https://maps.example.com/place', target: '_blank', textContent: 'The place in Maps' });
      document.body.append(link);
    });
  }

  test('a link to a new window and window.open are refused in the page, and fail the test, with no window opened', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const run = watchWindows({ context }, async () => {
      await pageWithLink(page);
      await page.getByRole('link', { name: 'The place in Maps' }).click();
      expect(await page.evaluate(() => window.open('https://maps.example.com/other'))).toBeNull();
      expect(context.pages()).toHaveLength(1);
      expect(new URL(page.url()).pathname).toBe(plainPage);
    });
    await expect(run).rejects.toThrow('https://maps.example.com/other');
    await context.close();
  });

  test('a test that opens no window passes', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await watchWindows({ context }, async () => {
      await pageWithLink(page);
      await page.evaluate(() => document.querySelector('a')!.removeAttribute('target'));
      await page.route('https://maps.example.com/**', (route) => route.fulfill({ body: 'Maps' }));
      await page.getByRole('link', { name: 'The place in Maps' }).click();
      await expect(page).toHaveURL('https://maps.example.com/place');
      // window.open into this same window moves the page, as it does without the fixture.
      await page.evaluate(() => window.open('https://maps.example.com/other', '_self'));
      await expect(page).toHaveURL('https://maps.example.com/other');
    });
    await context.close();
  });
});

test('the largest Text Size reads 3.12 through the kit\'s own reading: the root size, --text-scale and the page that shows it', async ({ page }) => {
  await largestTextSize(page);
  await page.goto(plainPage);
  await expect(page.locator('#scale')).toHaveText('3.12');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))).toBe('3.12');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${16 * 3.12}px`);
});

test('a screen fits when nothing reaches past its edge, or what does is in a box that scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent('<div style="overflow-x: auto"><p style="width: 600px">A wide table, in its own scroller</p></div>');
  await expectFits(page);
  await page.setContent('<div style="width: 600px">A box past the edge</div>');
  await expect(expectFits(page)).rejects.toThrow('div A box past the edge');
});

test.describe('the Tauri bridge, on the kit\'s own Tauri page halves', () => {
  const tauriPage = '/tauri.html';
  const line = (page: Page, text: string) => page.getByText(text, { exact: true });

  test('the iPhone plugins need an iPhone user agent, and say so', async ({ page }) => {
    await expect(fakeTauri(page, { iphoneNotifications: {} })).rejects.toThrow('IPHONE_USER_AGENT');
  });

  test.describe('in the iPhone app', () => {
    test.use({ userAgent: IPHONE_USER_AGENT });

    test('the page registers with the token the plugin gives, and a tap opens its page', async ({ page }) => {
      await fakeTauri(page, { iphoneNotifications: { environment: 'production' } });
      await page.goto(tauriPage);
      await expect(line(page, 'Registered production ffffffff')).toBeVisible();
      await tapNotification(page, '/items/7');
      await expect(line(page, 'Opened /items/7')).toBeVisible();
      expect((await tauriCalls(page)).map((call) => call.command)).toEqual(
        expect.arrayContaining(['plugin:iphone-notifications|request_permission', 'plugin:iphone-notifications|get_token', 'plugin:iphone-notifications|take_tapped_address']),
      );
    });

    test('a tap that launched the app opens its page on the next load', async ({ page }) => {
      await fakeTauri(page, { iphoneNotifications: {} });
      await page.goto(tauriPage);
      await launchedByTap(page, '/items/9');
      await page.reload();
      await expect(line(page, 'Opened /items/9')).toBeVisible();
    });

    test('the sheet signs the app in with its ticket and the nonce the page asked with', async ({ page }) => {
      await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('ana@example.com'), nonce: 'asked' } });
      await page.goto(tauriPage);
      await page.getByRole('button', { name: 'Continue with Google in the iPhone app' }).click();
      await expect(line(page, 'Signed in as ana@example.com')).toBeVisible();
    });

    test('a sheet that closes on another nonce leaves the app signed out, saying why', async ({ page }) => {
      await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('ana@example.com'), nonce: 'other' } });
      await page.goto(tauriPage);
      await page.getByRole('button', { name: 'Continue with Google in the iPhone app' }).click();
      await expect(line(page, `Window failed: ${NOT_FROM_THIS_WINDOW}`)).toBeVisible();
      await expect(line(page, 'Signed in as nobody')).toBeVisible();
    });

    test('a cancelled sheet leaves the app signed out', async ({ page }) => {
      await fakeTauri(page, { iphoneSignIn: { nonce: 'cancel' } });
      await page.goto(tauriPage);
      const closed = page.waitForEvent('console', (message) => message.text().startsWith('[iphone-sign-in] sheet closed without signing in'));
      await page.getByRole('button', { name: 'Continue with Google in the iPhone app' }).click();
      await closed;
      await expect(line(page, 'Signed in as nobody')).toBeVisible();
      expect((await tauriCalls(page)).filter((call) => call.command === 'plugin:web-auth|authenticate')).toHaveLength(1);
    });
  });

  test.describe('in the Mac app', () => {
    test('the window asks the browser with its nonce, and the shell\'s hand-over signs it in where it is', async ({ page }) => {
      await fakeTauri(page, { macApp: true });
      await page.goto(tauriPage);
      const loads = countLoads(page);
      const nonce = await windowAsksForSignIn(page, () => page.getByRole('button', { name: 'Continue with Google in the Mac app' }).click());
      await handOverSignIn(page, { ticket: standInTicket('ana@example.com'), nonce });
      await expect(line(page, 'Signed in as ana@example.com')).toBeVisible();
      expect(loads.loads).toBe(0);
    });

    test('a window whose browser page loads has it cancelled, and a page still loading takes the sign-in from its address', async ({ page }) => {
      await fakeTauri(page);
      await page.goto(tauriPage);
      const nonce = await windowAsksForSignIn(page, () => page.getByRole('button', { name: 'Continue with Google in the Mac app' }).click());
      await loadWithSignIn(page, { ticket: standInTicket('bo@example.com'), nonce }, tauriPage);
      await expect(line(page, 'Signed in as bo@example.com')).toBeVisible();
      expect(new URL(page.url()).hash).toBe('');
    });
  });
});
