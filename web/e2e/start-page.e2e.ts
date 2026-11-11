import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { START_PAGE_SETTINGS } from '../../tauri/window/names';

// The kit's start page (tauri/window/start/index.html), which a Mac or iPhone window onto a hosted site opens on: it
// waits for the site, says when it cannot reach it, tries again, and moves on. The page is served at an address of its
// own and the site at another, both answered here (page.route), so the test owns every answer and needs no server;
// the settings are the ones the window plugin hands it (Site::start_page_window), under the same name, and time is
// Playwright's clock.

const PAGE = readFileSync(join(import.meta.dirname, '../../tauri/window/start/index.html'), 'utf8');
const START = 'https://start.example.com/index.html';
const SITE = 'https://app.example.com/';
const SETTINGS = { address: SITE, health: '/api/health', name: 'Example', background: '#0a0e1f', text: '#e0e2eb' };

const CLOCK = Date.parse('2026-11-11T09:00:00Z');

type Site = 'answers' | 'refuses' | 'holds';

/** The start page with the site answering, refusing or holding its health check as `site()` says at each ask. */
async function open(page: Page, site: () => Site, settings: Record<string, string> = SETTINGS) {
  const asked: string[] = [];
  const held: Route[] = [];
  // Paused, so the page's timers run only when the test moves the clock.
  await page.clock.install({ time: CLOCK });
  await page.clock.pauseAt(CLOCK + 1_000);
  await page.addInitScript(([name, value]) => Object.assign(window, { [name as string]: value }), [START_PAGE_SETTINGS, settings] as const);
  await page.route(START, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.route('https://app.example.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== settings.health) return route.fulfill({ contentType: 'text/html', body: '<title>The site</title><p>The site</p>' });
    asked.push(url.pathname);
    const now = site();
    if (now === 'refuses') return route.abort('connectionrefused');
    if (now === 'holds') return void held.push(route);
    // Any answer counts, as a no-cors fetch reads none of it.
    return route.fulfill({ status: 200, body: '{"ok":true}' });
  });
  await page.goto(START);
  return { asked, held };
}

const offline = (page: Page) => page.getByText("Example can't reach app.example.com.");

test('a site that answers is opened at once, and nothing is said', async ({ page }) => {
  const { asked } = await open(page, () => 'answers');
  await expect(page).toHaveURL(SITE);
  await expect(page.getByText('The site')).toBeVisible();
  expect(asked).toEqual(['/api/health']);
});

test("a site it cannot reach is named with the app's name, in the app's colors, with Try again, which opens it once it answers", async ({ page }, testInfo) => {
  let site: Site = 'refuses';
  await open(page, () => site);
  await expect(offline(page)).toBeVisible();
  await expect(page.getByText('It keeps trying, and opens by itself once it answers.')).toBeVisible();
  await expect(page).toHaveTitle('Example');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(10, 14, 31)');
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe('rgb(224, 226, 235)');
  await page.screenshot({ path: testInfo.outputPath('start-page-offline.png') });
  site = 'answers';
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(SITE);
});

test('it tries again by itself every 30 seconds, and not before', async ({ page }) => {
  let site: Site = 'refuses';
  const { asked } = await open(page, () => site);
  await expect(offline(page)).toBeVisible();
  await page.clock.runFor(29_000);
  expect(asked).toHaveLength(1);
  await page.clock.runFor(1_000);
  await expect.poll(() => asked.length).toBe(2);
  await expect(offline(page)).toBeVisible();
  site = 'answers';
  await page.clock.runFor(30_000);
  await expect(page).toHaveURL(SITE);
});

test('it tries again when the device says it is back online', async ({ page }) => {
  let site: Site = 'refuses';
  await open(page, () => site);
  await expect(offline(page)).toBeVisible();
  site = 'answers';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(SITE);
});

test('a slow answer says what it is waiting for after two seconds, and the site opens once it comes', async ({ page }, testInfo) => {
  const { held } = await open(page, () => 'holds');
  await expect.poll(() => held.length).toBe(1);
  await page.clock.runFor(1_999);
  await expect(page.getByText('Reaching app.example.com')).toBeHidden();
  await page.clock.runFor(1);
  await expect(page.getByText('Reaching app.example.com')).toBeVisible();
  await expect(offline(page)).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('start-page-reaching.png') });
  await held[0]!.fulfill({ status: 200, body: '{"ok":true}' });
  await expect(page).toHaveURL(SITE);
});

test('an app whose server answers elsewhere names its own health route, and the site opens at its own address', async ({ page }) => {
  const { asked } = await open(page, () => 'answers', { ...SETTINGS, address: 'https://app.example.com/start?from=app', health: '/health' });
  await expect(page).toHaveURL('https://app.example.com/start?from=app');
  expect(asked).toEqual(['/health']);
});
