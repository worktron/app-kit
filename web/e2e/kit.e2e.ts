import { expect, test, type Page } from '@playwright/test';
import { hidePage, serveNewerBuild, showPage, signInByCode } from '../../authentication/stand-in/playwright';
import { countLoads } from '../playwright';

// The fixture app (e2e/fixture) built on the kit with the stand-in sign-in, served built, in Chromium. The app's server
// is played by page.route, so each test says what the server answers.

const ITEMS = [{ id: '1', title: 'Dentist on Tuesday' }, { id: '2', title: 'Renew the passport' }];

/** `field` is where the answer holds the items: `items` for the build a page opens on, `rows` for the newer one. */
type Server = { status: number; down: boolean; field: 'items' | 'rows' };

/** Answers the app's requests: the items, or the status set, or nothing at all while down. */
async function serve(page: Page): Promise<Server> {
  const server: Server = { status: 200, down: false, field: 'items' };
  await page.route('**/api/**', async (route) => {
    if (server.down) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ body: 'ok' });
    if (server.status !== 200) return route.fulfill({ status: server.status, body: '' });
    return route.fulfill({ json: { [server.field]: ITEMS } });
  });
  return server;
}

/**
 * Plays a deploy of the newer build: the index page names newer.html's entry from now on. With `cachedPage`, the page
 * itself still comes back as the older one, as from a cache that holds it, and only a look past every cache sees the
 * newer one.
 */
async function deployNewer(page: Page, { cachedPage = false } = {}) {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const older = cachedPage && route.request().resourceType() === 'document';
      const response = await route.fetch({ url: new URL(older ? '/index.html' : '/newer.html', route.request().url()).href });
      await route.fulfill({ response });
    },
  );
}

/** The built entry the page is running. */
const runningEntry = (page: Page) => page.locator('script[type="module"][src^="/assets/"]').getAttribute('src');

/** What the kit logs about a crash, in order. */
function crashLog(page: Page) {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[app-kit] crash')) lines.push(message.text());
  });
  return lines;
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test('signing in by emailed code and signing out load no page, and sign-in lands on the asked address', async ({ page }) => {
  await serve(page);
  await page.goto('/items/2?from=mail');
  await expect(heading(page)).toHaveText('Sign in');
  const count = countLoads(page);

  await signInByCode(page, 'ana@example.com');
  await expect(heading(page)).toHaveText('The app at /items/2?from=mail');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(heading(page)).toHaveText('Sign in');
  expect(new URL(page.url()).pathname).toBe('/items/2');
  expect(count.loads).toBe(0);
});

test('signing up by emailed code loads no page, and lands on the asked address', async ({ page }) => {
  await serve(page);
  await page.goto('/items/1?sign-up');
  await expect(heading(page)).toHaveText('Sign in');
  const count = countLoads(page);

  await signInByCode(page, 'new@example.com');
  await expect(heading(page)).toHaveText('The app at /items/1?sign-up');
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

  // Signed out by the person, the screen forgets that account and offers Google plainly.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue as/ })).toHaveCount(0);
});

test('a session the server refuses brings sign-in up over the current address, and signing in again returns there', async ({ page }) => {
  await page.clock.install();
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
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
  // The person did not ask to be forgotten, so the account is still offered by name.
  await expect(page.getByRole('button', { name: 'Continue as ana@example.com' })).toBeVisible();

  server.status = 200;
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  expect(count.loads).toBe(0);
});

test('a server that refuses a session just made says so, rather than offering sign-in again and again', async ({ page }) => {
  const server = await serve(page);
  server.status = 401;
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByText('The server refused the session.')).toBeVisible();
  await expect(heading(page)).toHaveText('The app at /');
});

test('an unknown address shows the not-found page at that address, drawn past the placeholder, with its title', async ({ page }) => {
  await serve(page);
  await page.goto('/nowhere?from=mail');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  await expect(page.getByText('Nothing is at /nowhere?from=mail.')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page).toHaveTitle('Not found · the fixture');
  expect(new URL(page.url()).pathname).toBe('/nowhere');

  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(heading(page)).toHaveText('The app at /');
  await expect(page).toHaveTitle('the fixture');
});

test('each screen sets its own page title', async ({ page }) => {
  await serve(page);
  await page.goto('/items/1');
  await signInByCode(page, 'ana@example.com');
  await expect(heading(page)).toHaveText('The app at /items/1');
  await expect(page).toHaveTitle('Item 1 · the fixture');
});

test('a row is a real link: a plain click moves in the page, ⌘-click opens a new tab', async ({ page, context }) => {
  await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
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
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();

  server.down = true;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('status')).toHaveText('Cannot reach the server. This page reconnects by itself.');

  server.down = false;
  await page.clock.fastForward(6_000);
  await expect(page.getByRole('status')).toHaveCount(0);
  // Back, the app loads what it missed.
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
});

/** The shelf screen's server: its answer, set by the test, or held until the test lets it go. */
async function serveShelf(page: Page) {
  const shelf: { answer: unknown; asked: number; held: (() => void) | null } = { answer: { items: ['Milk'] }, asked: 0, held: null };
  await page.route('**/api/shelf', async (route) => {
    shelf.asked++;
    if (shelf.answer === 'hold') await new Promise<void>((resolve) => (shelf.held = resolve));
    return route.fulfill({ json: shelf.answer === 'hold' ? { items: ['Bread'] } : shelf.answer });
  });
  return shelf;
}

const copyKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('fixture:copy:')));

test('an answer this build cannot draw is never saved, so the next load draws from the network', async ({ page }) => {
  await serve(page);
  const shelf = await serveShelf(page);
  await page.goto('/shelf');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('list', { name: 'Shelf' })).toHaveText('Milk');
  await expect.poll(() => copyKeys(page)).toHaveLength(1);

  // A newer server's answer, as an open page gets while a deploy goes out or is rolled back.
  shelf.answer = { at: '2026-10-25T20:00:00Z' };
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Something went wrong');

  // Rolled back: the next load draws the server's answer.
  shelf.answer = { items: ['Milk', 'Bread'] };
  let errors = 0;
  page.on('pageerror', () => errors++);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Shelf' })).toHaveText('MilkBread');
  expect(errors).toBe(0);
});

test('copies saved by another build are deleted and never drawn', async ({ page }) => {
  await serve(page);
  const shelf = await serveShelf(page);
  await page.goto('/shelf');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('list', { name: 'Shelf' })).toHaveText('Milk');
  await expect.poll(() => copyKeys(page)).toHaveLength(1);
  const [mine] = await copyKeys(page);
  // This build's copy, named by its built entry and the person signed in.
  expect(mine).toMatch(/^fixture:copy:index-[\w-]+:person-ana%40example.com:\/api\/shelf$/);

  // Only an older build's copy is left, as after a rollback to this build.
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.setItem('fixture:copy:index-older:person-ana%40example.com:/api/shelf', JSON.stringify({ data: { items: ['From the older build'] }, fetchedAt: Date.now() }));
  }, mine!);
  shelf.answer = 'hold';
  const asked = shelf.asked;
  await page.reload();
  // The screen asks the server only once it has drawn, so by now a copy it read would show.
  await expect.poll(() => shelf.asked).toBe(asked + 1);
  await expect(page.getByText('From the older build')).toHaveCount(0);
  expect(await copyKeys(page)).toEqual([]);

  shelf.held!();
  await expect(page.getByRole('list', { name: 'Shelf' })).toHaveText('Bread');
  await expect.poll(() => copyKeys(page)).toEqual([mine]);
});

test('a screen whose code is gone after a deploy reloads the page once, and never loops', async ({ page }) => {
  await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
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
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  const newer = await serveNewerBuild(page);
  const line = page.getByRole('status').filter({ hasText: 'the fixture has changed since this page loaded.' });

  // Just loaded, so coming back at once does not look.
  await showPage(page);
  await expect(line).toHaveCount(0);
  await page.clock.fastForward('01:01');
  // Away and back, as the person switching tabs: the page looks once it is shown again.
  await hidePage(page);
  await showPage(page);
  await expect(line).toBeVisible();

  // The real index page again, as the reload gets once the deploy is live: the app comes back, with no line.
  await newer.stop();
  const count = countLoads(page);
  await line.getByRole('button', { name: 'Reload' }).click();
  await expect.poll(() => count.loads).toBe(1);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  await expect(line).toHaveCount(0);
});

test('with a newer deploy waiting, a page that is hidden loads it by itself', async ({ page }) => {
  await page.clock.install();
  await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await serveNewerBuild(page);
  await page.clock.fastForward('01:01');
  await showPage(page);
  await expect(page.getByRole('status')).toContainText('has changed since this page loaded');
  const count = countLoads(page);

  // The person switches to another tab.
  await hidePage(page);
  await expect.poll(() => count.loads).toBe(1);
});

test("a screen that crashes on a newer server's data reloads once onto the newer build", async ({ page }) => {
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  const older = await runningEntry(page);
  const log = crashLog(page);

  // The newer build goes out, and its server names the items differently.
  await deployNewer(page);
  server.field = 'rows';
  const count = countLoads(page);
  // The person comes back to the tab: the list loads again, and the older build crashes drawing the answer.
  await hidePage(page);
  await showPage(page);

  await expect.poll(() => count.loads).toBe(1);
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  expect(await runningEntry(page)).toMatch(/^\/assets\/newer-/);
  expect(await runningEntry(page)).not.toBe(older);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(log).toEqual([expect.stringMatching(/^\[app-kit\] crash on an older build, reloading: the server serves a newer build, \/assets\/newer-/)]);
  expect(count.loads).toBe(1);
});

test('a crash with no newer build shows the crash screen and does not reload', async ({ page }) => {
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  const log = crashLog(page);
  const count = countLoads(page);

  // Only the server changed: no build to reload onto.
  server.field = 'rows';
  await hidePage(page);
  await showPage(page);

  // The crash screen is drawn only once the page has decided not to reload.
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  expect(log).toEqual([expect.stringMatching(/^\[app-kit\] crash, not reloading: the server serves this build/)]);
  expect(count.loads).toBe(0);
});

test('a reload that lands back on the older build shows the crash screen instead of reloading again', async ({ page }) => {
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  const log = crashLog(page);
  await deployNewer(page, { cachedPage: true });
  server.field = 'rows';
  const count = countLoads(page);

  await hidePage(page);
  await showPage(page);

  // One reload, which a cache answers with the older page; it crashes again and stops there.
  await expect.poll(() => count.loads).toBe(1);
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  expect(await runningEntry(page)).toMatch(/^\/assets\/index-/);
  expect(log).toEqual([
    expect.stringMatching(/^\[app-kit\] crash on an older build, reloading/),
    expect.stringMatching(/^\[app-kit\] crash, not reloading: the page already reloaded once toward \/assets\/newer-/),
  ]);
  expect(count.loads).toBe(1);
});

test('a server that does not answer the build check shows the crash screen', async ({ page }) => {
  await page.clock.install();
  const server = await serve(page);
  await page.goto('/');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  // The look at the index page is never answered; the page gives up on it at its deadline.
  let asked: () => void = () => {};
  const looked = new Promise<void>((resolve) => (asked = resolve));
  await page.route(
    (url) => url.pathname === '/',
    () => asked(),
  );
  const count = countLoads(page);
  server.field = 'rows';
  await hidePage(page);
  await showPage(page);

  await looked;
  // While it asks, the app's placeholder stands, never the crash.
  await expect(page.getByRole('progressbar')).toHaveText('fixture');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.clock.fastForward(3_000);
  await expect(page.getByRole('alert')).toContainText('Something went wrong');
  expect(count.loads).toBe(0);
});

test("off an iPhone the text size is 1 and the page's root size is left alone", async ({ page }) => {
  await page.goto('/text-size.html');
  await expect(page.locator('#scale')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('');
});
