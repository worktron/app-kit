import { chromium, expect, test, type Browser, type BrowserContext, type CDPSession } from '@playwright/test';
import { webPushMessage } from '../push/server';
import { WORKER_ADDRESS } from '../push/names';
import { withoutDockIcon } from '../../testing/playwright-dock.js';

// The kit's notification worker in a real browser: the Vite plugin serves it, the page's start registers it, and a
// push handed to it shows its notification. Pushes come through the DevTools protocol, since a browser with no window
// cannot subscribe to a real push service.
//
// Playwright's headless shell answers every notification permission no, so this runs Playwright's full Chromium,
// headless and kept out of the Dock. On a Mac, Chromium hands notifications to macOS, which would show them on the
// screen of whoever runs the tests, so its SystemNotifications feature is off and they stay in the browser.

const origin = `http://localhost:${process.env.E2E_PORT}`;

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch({ ...withoutDockIcon(chromium), headless: true, args: ['--disable-features=SystemNotifications'] });
});
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  await browser?.close();
});

type Shown = { title: string; body: string; tag: string; data: unknown };
type Recording = typeof globalThis & { shown: Shown[]; registration: { showNotification: (title: string, options: NotificationOptions) => Promise<void> } };

/**
 * The page with notifications allowed and the kit's worker registered and active, the worker's registration id, and
 * what the worker shows. Each notification the worker shows is recorded once the browser has taken it (its
 * showNotification resolved), rather than read back from registration.getNotifications(): in this headless run, with
 * notifications kept inside the browser, Chromium's own list sometimes drops one it has just taken (1 in 30 runs, seen
 * with the worker logging an empty list right after its showNotification resolved).
 */
async function started(): Promise<{ session: CDPSession; registrationId: string; shown: () => Promise<Shown[]> }> {
  const context = await browser.newContext();
  contexts.push(context);
  await context.grantPermissions(['notifications'], { origin });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const registered = new Promise<string>((resolve) => {
    session.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const ours = registrations.find((r: { scopeURL: string; isDeleted: boolean }) => r.scopeURL === `${origin}/` && !r.isDeleted);
      if (ours) resolve(ours.registrationId);
    });
  });
  await session.send('ServiceWorker.enable');
  const attached = context.waitForEvent('serviceworker', (w) => w.url() === `${origin}${WORKER_ADDRESS}`);
  await page.goto(`${origin}/push.html`);
  // A start whose subscribe the browser refuses still ends, and never throws.
  await expect(page.locator('#started')).toHaveText('started');
  await page.evaluate(async (address) => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active?.scriptURL.endsWith(address)) throw new Error(`the active worker is ${registration.active?.scriptURL}`);
  }, WORKER_ADDRESS);
  const worker = await attached;
  await worker.evaluate(() => {
    const scope = globalThis as Recording;
    const show = scope.registration.showNotification.bind(scope.registration);
    scope.shown = [];
    scope.registration.showNotification = async (title, options) => {
      await show(title, options);
      scope.shown.push({ title, body: options.body ?? '', tag: options.tag ?? '', data: options.data });
    };
  });
  return { session, registrationId: await registered, shown: () => worker.evaluate(() => (globalThis as Recording).shown) };
}

test('the plugin serves the worker at its address, asked for again on each load', async ({ request }) => {
  const res = await request.get(`${origin}${WORKER_ADDRESS}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-cache');
  expect(await res.text()).toContain("worker.addEventListener('push'");
});

test("a declarative message the server half makes shows its title, body, tag and page from the kit's worker", async () => {
  const { session, registrationId, shown } = await started();
  const data = webPushMessage({ title: 'Sam asked for more time', body: '30 minutes of drawing', url: '/requests/7', tag: 'requests' }, { origin });
  await session.send('ServiceWorker.deliverPushMessage', { origin: `${origin}/`, registrationId, data });
  await expect.poll(shown).toEqual([{ title: 'Sam asked for more time', body: '30 minutes of drawing', tag: 'requests', data: { url: `${origin}/requests/7` } }]);

  // A newer one with the same tag, which replaces it on the phone.
  await session.send('ServiceWorker.deliverPushMessage', { origin: `${origin}/`, registrationId, data: webPushMessage({ title: 'Sam asked again', body: '15 minutes', tag: 'requests' }, { origin }) });
  await expect.poll(shown).toEqual([
    { title: 'Sam asked for more time', body: '30 minutes of drawing', tag: 'requests', data: { url: `${origin}/requests/7` } },
    { title: 'Sam asked again', body: '15 minutes', tag: 'requests', data: { url: `${origin}/` } },
  ]);
});

test('a push with data that is not a message still shows a notification, so Safari never counts it as silent', async () => {
  const { session, registrationId, shown } = await started();
  await session.send('ServiceWorker.deliverPushMessage', { origin: `${origin}/`, registrationId, data: 'not JSON' });
  await expect.poll(shown).toEqual([{ title: 'localhost', body: 'not JSON', tag: '', data: { url: `${origin}/` } }]);
});
