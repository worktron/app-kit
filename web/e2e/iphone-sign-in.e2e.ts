import { expect, test, type Page } from '@playwright/test';
import { standInTicket } from '../../authentication/stand-in';
import { OPENING_GOOGLE, SIGNING_IN_WITH_GOOGLE } from '../sign-in/SignInGate';
import { fakeTauri, IPHONE_USER_AGENT } from '../../tauri/playwright';
import { expectQuietSignIn } from '../playwright';

// The sign-in gate running iPhone Google sign-in's in-between steps, in the fixture app, which passes it the iPhone
// settings: from the tap to the app's screen, and on the page Apple's sheet opens, every screen is the wordmark with at
// most one line. The sheet is fakeTauri's, and Google is the stand-in's trip to the callback.

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const SHEET_PAGE = `/desktop-sign-in?nonce=${'a'.repeat(64)}&account=choose`;

/** Answers the app's own requests with an empty list. */
async function serve(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === '/api/health' ? route.fulfill({ body: 'ok' }) : route.fulfill({ json: { items: [] } });
  });
}

/** Every line the page shows under the wordmark, across page loads, in order. */
async function linesSeen(page: Page) {
  const lines: string[] = [];
  await page.exposeBinding('__lineSeen', (_source, line: string) => void lines.push(line));
  await page.addInitScript(() => {
    let last = '';
    new MutationObserver(() => {
      const line = document.querySelector('[role="status"]')?.textContent ?? '';
      if (line && line !== last) (window as unknown as { __lineSeen: (line: string) => void }).__lineSeen(line);
      last = line;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return lines;
}

test.describe('in the iPhone app', () => {
  test.use({ userAgent: IPHONE_USER_AGENT });

  test('Continue with Google shows only the wordmark and a line until the app’s screen', async ({ page }) => {
    // Served first, so the fake sheet's answer for the window's sign-in, routed after, comes before it.
    await serve(page);
    await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('ana@example.com'), nonce: 'asked' } });
    const lines = await linesSeen(page);
    await page.goto('/');
    await expect(heading(page)).toHaveText('Sign in');
    await expectQuietSignIn(page, () => page.getByRole('button', { name: 'Continue with Google' }).click());
    await expect(heading(page)).toHaveText('The app at /');
    expect(lines).toEqual([SIGNING_IN_WITH_GOOGLE]);
  });

  test('a closed sheet brings the sign-in screen back ready, with nothing to say', async ({ page }) => {
    await serve(page);
    await fakeTauri(page, { iphoneSignIn: { nonce: 'cancel' } });
    await page.goto('/');
    const closed = page.waitForEvent('console', (message) => message.text().startsWith('[iphone-sign-in] sheet closed without signing in'));
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await closed;
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(heading(page)).toHaveText('Sign in');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});

test('the page Apple’s sheet opens goes to Google and on to the hand-over with no sign-in screen drawn', async ({ page }) => {
  await serve(page);
  const lines = await linesSeen(page);
  await expectQuietSignIn(page, () => page.goto(SHEET_PAGE));
  await expect(heading(page)).toHaveText('Hand over to the app');
  await expect(page.getByRole('status')).toHaveText('Sign the app in as chosen@example.com');
  expect(lines[0]).toBe(OPENING_GOOGLE);
});

test('Back from Google on the page Apple’s sheet opens shows the sign-in screen, ready, and does not go again', async ({ page }) => {
  await serve(page);
  // Google's page, where the person taps Back.
  await page.route(
    (url) => url.pathname === '/sso-callback',
    (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Google</h1>' }),
  );
  await page.goto(SHEET_PAGE);
  await expect(heading(page)).toHaveText('Google');
  await page.goBack();
  await expect(heading(page)).toHaveText('Sign in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/desktop-sign-in');
});

test.describe('the quiet sign-in step', () => {
  /** A page standing in for an app, whose button does what `onTap` says to the gate's mark and its own button. */
  async function standIn(page: Page, onTap: string) {
    await page.route(
      (url) => url.pathname === '/tap',
      (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html data-sign-in-gate="sign-in"><body><button id="tap">Continue with Google</button><script>
            const mark = (shows) => document.documentElement.setAttribute('data-sign-in-gate', shows);
            const button = document.getElementById('tap');
            const later = (step) => new Promise((resolve) => setTimeout(() => { step(); resolve(); }, 50));
            button.addEventListener('click', async () => { ${onTap} });
          </script></body></html>`,
        }),
    );
    await page.goto('/tap');
  }
  const tap = (page: Page) => () => page.locator('#tap').click();

  test('passes a tap followed by the wordmark and a line, then the app', async ({ page }) => {
    await standIn(page, `button.remove(); mark('placeholder-with-line'); await later(() => mark('app'));`);
    await expectQuietSignIn(page, tap(page));
  });

  test('fails a tap that leaves the button disabled while the sign-in goes on', async ({ page }) => {
    await standIn(page, `button.disabled = true; await later(() => mark('app'));`);
    await expect(expectQuietSignIn(page, tap(page))).rejects.toThrow('/tap: sign-in, with disabled Continue with Google');
  });

  test('fails a sign-in screen drawn again between the line and the app', async ({ page }) => {
    await standIn(page, `mark('placeholder-with-line'); await later(() => mark('sign-in')); await later(() => mark('app'));`);
    await expect(expectQuietSignIn(page, tap(page))).rejects.toThrow('/tap: sign-in');
  });

  test('fails when the app’s screen never comes, saying what the gate showed', async ({ page }) => {
    await standIn(page, `mark('placeholder-with-line');`);
    await expect(expectQuietSignIn(page, tap(page), { timeout: 500 })).rejects.toThrow("the app's screen was not drawn within 500ms");
  });
});
