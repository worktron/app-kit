// In WebKit, which caps at 7 days the cookie Clerk sets at sign-in when Clerk's address is a DNS alias, a page that opens
// signed in goes once through Clerk's renewal address and back, with the gate's placeholder up the whole way, and the
// next open does not go again. The kit's development instance has no alias, so the cap itself is not here to see: this
// holds the trip, the quiet screen and the one load, which are the kit's part. Clerk's testing library, which adds its
// testing token to every request to Clerk, also fetches the renewal as if it answered JSON and logs that it could not
// read the page it was sent back to; the browser's own trip is untouched.
import { expect, test } from '@playwright/test';
import { expectQuietSignIn } from '../../../web/playwright.js';
import { countLoads } from '../../../web/playwright.js';
import { signInWithTicket, throwawayUser } from '../playwright.js';
import { countedApi, DOMAIN, PREFIX, secretKey } from './names';

test('a page that opens signed in renews Clerk\'s cookie once, under the placeholder, and lands back where it was', async ({ page }) => {
  const user = await throwawayUser({ secretKey: secretKey(), apiUrl: countedApi('renew'), domain: DOMAIN, prefix: PREFIX });
  try {
    const lines: string[] = [];
    page.on('console', (message) => {
      if (message.text().startsWith('[app-kit sign-in]')) lines.push(message.text());
    });
    const renewals: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && new URL(request.url()).pathname.endsWith('/v1/client/touch')) renewals.push(request.url());
    });

    // Signed in inside the page, as by an emailed code: no renewal then, since the page already holds the app.
    await page.goto('/notes?sort=new');
    await signInWithTicket(page, await user.ticket());
    await expect(page.getByTestId('person')).toHaveText(user.email);
    expect(renewals).toEqual([]);

    // The next open renews, with nothing but the placeholder on screen from the load to the app.
    const loads = countLoads(page);
    await expectQuietSignIn(page, () => page.reload(), { timeout: 30_000 });
    await expect(page.getByTestId('person')).toHaveText(user.email);
    expect(renewals).toHaveLength(1);
    expect(new URL(renewals[0]!).searchParams.get('redirect_url')).toMatch(/\/notes\?sort=new#app-kit-cookie-renewed=$/);
    expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe('/notes?sort=new');
    // The reload, then the one through Clerk's renewal back to this page.
    expect(loads.loads).toBe(2);
    expect(lines.some((line) => line.includes("renewing Clerk's cookie with a page load") && line.endsWith('the first for this session'))).toBe(true);
    expect(lines).toContain("[app-kit sign-in] back from renewing Clerk's cookie");

    // Renewed: the open after that goes nowhere.
    await page.reload();
    await expect(page.getByTestId('person')).toHaveText(user.email);
    expect(renewals).toHaveLength(1);
  } finally {
    await user.remove();
  }
});
