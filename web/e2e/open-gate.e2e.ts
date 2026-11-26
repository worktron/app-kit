import { expect, test, type Page } from '@playwright/test';
import { standInTicket } from '../../authentication/stand-in';
import { signInByCode } from '../../authentication/stand-in/playwright';
import { countLoads, expectQuietSignIn } from '../playwright';
import { fakeTauri, IPHONE_USER_AGENT } from '../../tauri/playwright';
import { GATE_SHOWS_ATTRIBUTE } from '../sign-in/SignInGate';

// The sign-in gate's open mode, in the fixture app opened with ?open: the app drawn for people who are not signed in,
// with its own sign-in page at /sign-in. With ?held, the stand-in never loads until the test says, as a provider's
// script that is blocked or slow.

const ITEMS = [{ id: '1', title: 'Dentist on Tuesday' }];
const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const shows = (page: Page) => page.evaluate((attribute) => document.documentElement.getAttribute(attribute), GATE_SHOWS_ATTRIBUTE);

/** Answers the app's own requests, with or without a token, and records which carried one. */
async function serve(page: Page) {
  const tokens: (string | null)[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ body: 'ok' });
    tokens.push((await route.request().headerValue('authorization')) ?? null);
    return route.fulfill({ json: { items: ITEMS } });
  });
  return tokens;
}

test('signed out, with the provider never loading, the open app draws and loads its data at once', async ({ page }) => {
  const tokens = await serve(page);
  await page.goto('/?open&held');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  expect(await shows(page)).toBe('app-signed-out');
  expect(tokens).toEqual([null]);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test("sign-in from the open app's own page returns to where Sign in was pressed, with only the provider's trip loaded", async ({ page }) => {
  await serve(page);
  await page.goto('/items/1?open');
  await expect(heading(page)).toHaveText('The app at /items/1?open');
  const count = countLoads(page);

  // Signed in by emailed code: no page load at all.
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(heading(page)).toHaveText('Sign in');
  await signInByCode(page, 'ana@example.com');
  await expect(heading(page)).toHaveText('The app at /items/1?open');
  expect(await shows(page)).toBe('app');

  // Signed out from the account menu: the open app again, signed out, at the same address, with no load.
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect(await shows(page)).toBe('app-signed-out');
  expect(new URL(page.url()).pathname).toBe('/items/1');
  expect(count.loads).toBe(0);

  // Signed in with Google: the provider's one trip, back to the sign-in page, which moves on to where it was opened.
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(heading(page)).toHaveText('The app at /items/1?open');
  expect(count.loads).toBe(1);
});

test('a session the server ends brings sign-in up over the address, and Continue signed out puts the open app back', async ({ page }) => {
  await page.clock.install();
  let refuse = false;
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/health') return route.fulfill({ body: 'ok' });
    return refuse ? route.fulfill({ status: 401, body: '' }) : route.fulfill({ json: { items: ITEMS } });
  });
  await page.goto('/sign-in?open&back=%2F');
  await signInByCode(page, 'ana@example.com');
  await expect(page.getByRole('link', { name: 'Dentist on Tuesday' })).toBeVisible();
  // Past the window after a sign-in in which a refusal is taken for a server that refuses every session.
  await page.clock.fastForward(16_000);

  refuse = true;
  await page.getByRole('link', { name: 'Later' }).click();
  await page.goBack();
  await expect(heading(page)).toHaveText('Sign in');
  await expect(page.getByRole('alert')).toHaveText('Your session ended. Sign in again to carry on where you were.');
  expect(new URL(page.url()).pathname).toBe('/');

  refuse = false;
  await page.getByRole('button', { name: 'Continue signed out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect(await shows(page)).toBe('app-signed-out');
});

test.describe('in the iPhone app', () => {
  test.use({ userAgent: IPHONE_USER_AGENT });

  test('sign-in from the open app is the wordmark with one line from the tap to the app', async ({ page }) => {
    // Served first, so the fake sheet's answer for the window's sign-in, routed after, comes before it.
    await serve(page);
    await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('ana@example.com'), nonce: 'asked' } });
    await page.goto('/sign-in?open&back=%2F');
    await expect(heading(page)).toHaveText('Sign in');
    await expectQuietSignIn(page, () => page.getByRole('button', { name: 'Continue with Google' }).click());
    await expect(heading(page)).toHaveText('The app at /');
  });
});
