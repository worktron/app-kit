import { expect, test, type Page } from '@playwright/test';

// The fixture app (e2e/fixture) built on the kit with the stand-in sign-in, served built, in Chromium. The app's server
// is played by page.route, so each test says what the server answers.

const ITEMS = { items: [{ id: '1', title: 'Dentist on Tuesday' }, { id: '2', title: 'Renew the passport' }] };

type Server = { status: number; down: boolean };

/** Answers the app's requests: the items, or the status set, or nothing at all while down. */
async function serve(page: Page): Promise<Server> {
  const server: Server = { status: 200, down: false };
  await page.route('**/api/**', async (route) => {
    if (server.down) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ body: 'ok' });
    if (server.status !== 200) return route.fulfill({ status: server.status, body: '' });
    return route.fulfill({ json: ITEMS });
  });
  return server;
}

/** Counts the page's loads after the first, a new page in the same tab included. */
function countLoads(page: Page) {
  const count = { loads: 0 };
  page.on('load', () => count.loads++);
  return count;
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function signInByCode(page: Page, email = 'ana@example.com') {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code').fill('424242');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('signing in by emailed code and signing out load no page, and sign-in lands on the asked address', async ({ page }) => {
  await serve(page);
  await page.goto('/items/2?from=mail');
  await expect(heading(page)).toHaveText('Sign in');
  const count = countLoads(page);

  await signInByCode(page);
  await expect(heading(page)).toHaveText('The app at /items/2?from=mail');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(heading(page)).toHaveText('Sign in');
  expect(new URL(page.url()).pathname).toBe('/items/2');
  expect(count.loads).toBe(0);
});

test("Google costs only the provider's own trip, and lands on the asked address", async ({ page }) => {
  await serve(page);
  await page.goto('/items/1');
  await expect(heading(page)).toHaveText('Sign in');
  const count = countLoads(page);

  // The stand-in's trip to Google is one page load, to the callback path, as the real trip ends.
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(heading(page)).toHaveText('The app at /items/1');
  expect(new URL(page.url()).pathname).toBe('/items/1');
  expect(count.loads).toBe(1);

  // Signed out, the screen offers that account by name.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue as chosen@example.com' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
});

test('a session the server refuses brings sign-in up over the current address, and signing in again returns there', async ({ page }) => {
  await page.clock.install();
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  const count = countLoads(page);
  // Past the window after a sign-in in which a refusal is taken for a server that refuses every session.
  await page.clock.fastForward(16_000);

  await page.getByRole('link', { name: 'Dentist on Tuesday' }).click();
  await expect(heading(page)).toHaveText('The app at /items/1');
  // Back on the list, which loads its items again, and the server no longer takes the session.
  server.status = 401;
  await page.goBack();
  await expect(heading(page)).toHaveText('Sign in');
  await expect(page.getByRole('alert')).toHaveText('Your session ended. Sign in again to carry on where you were.');
  expect(new URL(page.url()).pathname).toBe('/');

  server.status = 200;
  await signInByCode(page);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  expect(count.loads).toBe(0);
});

test('a server that refuses a session just made says so, rather than offering sign-in again and again', async ({ page }) => {
  const server = await serve(page);
  server.status = 401;
  await page.goto('/');
  await signInByCode(page);
  await expect(page.getByText('The server refused the session.')).toBeVisible();
  await expect(heading(page)).toHaveText('The app at /');
});

test('a row is a real link: a plain click moves in the page, ⌘-click opens a new tab', async ({ page, context }) => {
  await serve(page);
  await page.goto('/');
  await signInByCode(page);
  const count = countLoads(page);
  const row = page.getByRole('link', { name: 'Renew the passport' });

  const opened = context.waitForEvent('page');
  await row.click({ modifiers: ['ControlOrMeta'] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe('/items/2');
  await expect(heading(page)).toHaveText('The app at /');

  await row.click();
  await expect(heading(page)).toHaveText('The app at /items/2');
  expect(count.loads).toBe(0);
});

test('the server-unreachable line comes and goes by itself', async ({ page }) => {
  await page.clock.install();
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();

  server.down = true;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signInByCode(page);
  await expect(page.getByRole('status')).toHaveText('Cannot reach the server. This page reconnects by itself.');

  server.down = false;
  await page.clock.fastForward(6_000);
  await expect(page.getByRole('status')).toHaveCount(0);
  // Back, the app loads what it missed.
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
});

test('a screen whose code is gone after a deploy reloads the page once, and never loops', async ({ page }) => {
  await serve(page);
  await page.goto('/');
  await signInByCode(page);
  await expect(page.getByRole('link', { name: 'Later' })).toBeVisible();
  await page.route('**/assets/Later-*.js', (route) => route.fulfill({ status: 404, body: '' }));
  const count = countLoads(page);

  await page.getByRole('link', { name: 'Later' }).click();
  await expect.poll(() => count.loads).toBe(1);
  // The reload asks again, still fails, and stops there: the error boundary says what failed.
  // The guard decides before the error reaches the boundary, so once the boundary shows, no reload is coming.
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  expect(count.loads).toBe(1);
});

test('an open page finds a newer deploy when it comes back in front, and Reload loads it', async ({ page }) => {
  await page.clock.install();
  await serve(page);
  await page.goto('/');
  await signInByCode(page);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/\/assets\/index-[^"]+\.js/, '/assets/index-Newer123.js');
      await route.fulfill({ response, body: html });
    },
  );
  const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const line = page.getByRole('status').filter({ hasText: 'A new version of the fixture is ready.' });

  // Just loaded, so coming back at once does not look.
  await comeBack();
  await expect(line).toHaveCount(0);
  await page.clock.fastForward('01:01');
  await comeBack();
  await expect(line).toBeVisible();

  const count = countLoads(page);
  await line.getByRole('button', { name: 'Reload' }).click();
  await expect.poll(() => count.loads).toBe(1);
});

test('with a newer deploy waiting, a page that is hidden loads it by itself', async ({ page }) => {
  await page.clock.install();
  await serve(page);
  await page.goto('/');
  await signInByCode(page);
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/\/assets\/index-[^"]+\.js/, '/assets/index-Newer123.js') });
    },
  );
  await page.clock.fastForward('01:01');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('status')).toContainText('A new version');
  const count = countLoads(page);

  // The person switches to another tab.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => count.loads).toBe(1);
});
