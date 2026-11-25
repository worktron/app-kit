import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Desktop sign-in when Chrome moves Google's return into another of its profiles, as it does when the account picked at
// Google belongs to that profile: the trip starts in one browser context and finishes in a second one, which shares no
// storage with the first, as two Chrome profiles share none. The second must land on the fixture's hand-over page with
// its click, for the account picked, never on the app's root. Google is the stand-in's trip to the callback.

const NONCE = 'b'.repeat(64);
const handOverPage = (account: string) => `/desktop-sign-in?nonce=${NONCE}&account=${encodeURIComponent(account)}`;
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

/** A context answering the app's own requests with an empty list, as each profile's tab would be answered. */
async function profile(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === '/api/health' ? route.fulfill({ body: 'ok' }) : route.fulfill({ json: { items: [] } });
  });
  return context;
}

/**
 * Starts desktop sign-in for `account` in a first profile and returns the address Google came back to there, which
 * Chrome takes away from that profile: the first tab's load of it is stopped, as the person never sees it.
 */
async function startInFirstProfile(browser: Browser, account: string): Promise<string> {
  const first = await profile(browser);
  const page = await first.newPage();
  const returned = new Promise<string>((resolve) => {
    void page.route(
      (url) => url.pathname === '/sso-callback',
      (route) => {
        resolve(route.request().url());
        return route.fulfill({ contentType: 'text/html', body: '<h1>Moved to another profile</h1>' });
      },
    );
  });
  await page.goto(handOverPage(account));
  const address = await returned;
  await first.close();
  return address;
}

test('a return Chrome moves into another profile lands on the hand-over for the account named', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'ana@example.com');
  const second = await profile(browser);
  const page = await second.newPage();
  await page.goto(address);
  await expect(heading(page)).toHaveText('Hand over to the app');
  await expect(page.getByRole('status')).toHaveText('Sign the app in as ana@example.com');
  await expect(page.getByRole('button', { name: 'Sign in to the app' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
  expect(new URL(page.url()).searchParams.get('nonce')).toBe(NONCE);
  await second.close();
});

test('a return Chrome moves into another profile for Google’s list hands over the account picked, without going again', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'choose');
  const second = await profile(browser);
  const page = await second.newPage();
  let returns = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/sso-callback') returns++;
  });
  await page.goto(address);
  await expect(page.getByRole('status')).toHaveText('Sign the app in as chosen@example.com');
  await expect(page.getByRole('button', { name: 'Sign in to the app' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
  // Only the load Chrome moved here: the page drew its click without signing out and going to Google again.
  expect(returns).toBe(1);
  await second.close();
});

test('a profile already signed in as someone else is not offered for the hand-over when a return lands there', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'choose');
  const second = await profile(browser);
  // Signed in to the app in this profile already, as bo@example.com, in the stand-in's own record of who is signed in.
  await second.addInitScript(() => {
    if (!sessionStorage.getItem('stand-in.person')) sessionStorage.setItem('stand-in.person', JSON.stringify({ id: 'p-bo', email: 'bo@example.com' }));
  });
  const page = await second.newPage();
  // Signed out, the page goes to Google from this profile: its second trip is where this test stops.
  let returns = 0;
  const wentAgain = new Promise<void>((resolve) => {
    void page.route(
      (url) => url.pathname === '/sso-callback',
      (route) => {
        returns++;
        if (returns === 1) return route.continue();
        resolve();
        return route.fulfill({ contentType: 'text/html', body: '<h1>Google</h1>' });
      },
    );
  });
  await page.goto(address);
  await wentAgain;
  await expect(heading(page)).toHaveText('Google');
  await second.close();
});
