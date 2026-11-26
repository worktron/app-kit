import { expect, test, type Page } from '@playwright/test';
import { standInTicket } from '../../authentication/stand-in';
import { countLoads, expectQuietSignIn } from '../playwright';
import { fakeTauri, handOverSignIn, IPHONE_USER_AGENT, tauriCalls, windowAsksForSignIn } from '../../tauri/playwright';
import { OPENING_MICROSOFT, SIGNING_IN_WITH_MICROSOFT } from '../sign-in/SignInGate';

// Microsoft beside Google in the fixture app, on the stand-in, whose trip to Microsoft is one page load to the callback
// path as Google's is: in the browser, in the Mac app's window handing sign-in to the browser, and in the iPhone app's
// sheet and on the page it opens.

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const line = (page: Page, text: string) => page.getByText(text, { exact: true });

async function serve(page: Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === '/api/health' ? route.fulfill({ body: 'ok' }) : route.fulfill({ json: { items: [] } });
  });
}

/** Every line the page shows under the wordmark, across page loads, in order. */
async function linesSeen(page: Page) {
  const lines: string[] = [];
  await page.exposeBinding('__lineSeen', (_source, seen: string) => void lines.push(seen));
  await page.addInitScript(() => {
    let last = '';
    new MutationObserver(() => {
      const seen = document.querySelector('[role="status"]')?.textContent ?? '';
      if (seen && seen !== last) (window as unknown as { __lineSeen: (line: string) => void }).__lineSeen(seen);
      last = seen;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return lines;
}

test("Microsoft costs only the provider's own trip, lands on the asked address, and Continue as goes back to Microsoft", async ({ page }) => {
  await serve(page);
  await page.goto('/items/1');
  await expect(heading(page)).toHaveText('Sign in');
  const count = countLoads(page);

  await page.getByRole('button', { name: 'Continue with Microsoft' }).click();
  await expect(heading(page)).toHaveText('The app at /items/1');
  expect(count.loads).toBe(1);

  // Back on the sign-in screen with the account kept, as after the server ends a session: it names Microsoft.
  await page.evaluate(() => sessionStorage.setItem('stand-in.person', ''));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue as chosen@example.com' })).toBeVisible();
  await expect(line(page, 'Last signed in with Microsoft')).toBeVisible();
});

test.describe('the Tauri page halves', () => {
  test('in the Mac app, the window asks the browser for Microsoft by name, and the hand-over signs it in where it is', async ({ page }) => {
    await fakeTauri(page, { macApp: true });
    await page.goto('/tauri.html');
    const nonce = await windowAsksForSignIn(page, () => page.getByRole('button', { name: 'Continue with Microsoft in the Mac app' }).click());
    const opened = await page.evaluate(() => (window as unknown as { __appKitTauri: { opened: string[] } }).__appKitTauri.opened.at(-1)!);
    expect(new URL(opened).searchParams.get('with')).toBe('microsoft');
    await handOverSignIn(page, { ticket: standInTicket('bo@example.com'), nonce });
    await expect(line(page, 'Signed in as bo@example.com')).toBeVisible();
  });

  test.describe('in the iPhone app', () => {
    test.use({ userAgent: IPHONE_USER_AGENT });

    test("the sheet opens the browser page for Microsoft, and signs the app in with the sheet's ticket", async ({ page }) => {
      await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('bo@example.com'), nonce: 'asked' } });
      await page.goto('/tauri.html');
      await page.getByRole('button', { name: 'Continue with Microsoft in the iPhone app' }).click();
      await expect(line(page, 'Signed in as bo@example.com')).toBeVisible();
      const sheet = (await tauriCalls(page)).find((call) => call.command === 'plugin:web-auth|authenticate');
      const url = new URL((sheet!.args as { payload: { url: string } }).payload.url);
      expect(url.pathname).toBe('/desktop-sign-in');
      expect(url.searchParams.get('with')).toBe('microsoft');
    });
  });
});

test.describe('in the iPhone app', () => {
  test.use({ userAgent: IPHONE_USER_AGENT });

  test("Continue with Microsoft shows only the wordmark and Microsoft's line until the app's screen", async ({ page }) => {
    await serve(page);
    await fakeTauri(page, { iphoneSignIn: { ticket: standInTicket('bo@example.com'), nonce: 'asked' } });
    const lines = await linesSeen(page);
    await page.goto('/');
    await expect(heading(page)).toHaveText('Sign in');
    await expectQuietSignIn(page, () => page.getByRole('button', { name: 'Continue with Microsoft' }).click());
    await expect(heading(page)).toHaveText('The app at /');
    expect(lines).toEqual([SIGNING_IN_WITH_MICROSOFT]);
  });
});

test("the page Apple's sheet opens for Microsoft goes to Microsoft and on to the hand-over with no sign-in screen drawn", async ({ page }) => {
  await serve(page);
  const lines = await linesSeen(page);
  await expectQuietSignIn(page, () => page.goto(`/desktop-sign-in?nonce=${'a'.repeat(64)}&account=choose&with=microsoft`));
  await expect(heading(page)).toHaveText('Hand over to the app');
  await expect(page.getByRole('status')).toHaveText('Sign the app in as chosen@example.com');
  expect(lines[0]).toBe(OPENING_MICROSOFT);
});
