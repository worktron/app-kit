import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Desktop sign-in when Chrome moves Google's return into another of its profiles, as it does when the account picked at
// Google belongs to that profile: the trip starts in one browser context and its return lands in a second one, which
// shares no storage with the first, as two Chrome profiles share none. The stand-in refuses a return its own context did
// not start, as Clerk refuses one its own client did not, so the second goes to Google once more from there, comes back,
// and lands on the fixture's hand-over page with its click, never on the app's root. Google is the stand-in's trip to
// the callback.

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

/** Counts the page's loads of Google's return. */
function countReturns(page: Page): () => number {
  let returns = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === '/sso-callback') returns++;
  });
  return () => returns;
}

test('a return Chrome moves into another profile goes to Google once more from there, then lands on the hand-over for the account named', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'ana@example.com');
  const second = await profile(browser);
  const page = await second.newPage();
  const returns = countReturns(page);
  await page.goto(address);
  await expect(heading(page)).toHaveText('Hand over to the app');
  // The stand-in's Google with no account named signs in as chosen@example.com, so this line says the second trip
  // named the account the app asked for.
  await expect(page.getByRole('status')).toHaveText('Sign the app in as ana@example.com');
  // The load Chrome moved here, and the one more trip from this profile.
  expect(returns()).toBe(2);
  await expect(page.getByRole('button', { name: 'Sign in to the app' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
  expect(new URL(page.url()).searchParams.get('nonce')).toBe(NONCE);
  await second.close();
});

test('a return Chrome moves into another profile for Google’s list goes to Google’s list once more from there, then hands over the account picked', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'choose');
  const second = await profile(browser);
  const page = await second.newPage();
  const returns = countReturns(page);
  await page.goto(address);
  await expect(page.getByRole('status')).toHaveText('Sign the app in as chosen@example.com');
  await expect(page.getByRole('button', { name: 'Sign in to the app' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
  // The load Chrome moved here and the one trip from this profile: back from it, the page draws its click rather than
  // signing out and going again.
  expect(returns()).toBe(2);
  await second.close();
});

test('a return refused again after the one more trip stops at the sign-in screen, saying Google did not finish, and goes no further', async ({ browser }) => {
  const address = await startInFirstProfile(browser, 'ana@example.com');
  const second = await profile(browser);
  // The second return is refused too: the stand-in's record of the trip from this profile is gone when it lands.
  await second.addInitScript(() => {
    if (window.location.pathname !== '/sso-callback') return;
    const seen = Number(sessionStorage.getItem('test.returns') ?? '0') + 1;
    sessionStorage.setItem('test.returns', String(seen));
    if (seen === 2) sessionStorage.removeItem('stand-in.google');
  });
  const page = await second.newPage();
  const returns = countReturns(page);
  await page.goto(address);
  await expect(heading(page)).toHaveText('Sign in');
  await expect(page.getByRole('alert')).toHaveText('Signing in with Google did not finish. Try again, or use an emailed code.');
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
  // The gate decided in the effect after drawing this screen; a turn of the page's own tasks later, it has not gone.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 0)));
  expect(returns()).toBe(2);
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
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
