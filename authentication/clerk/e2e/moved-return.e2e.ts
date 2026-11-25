// Google's return landing in a browser that did not start the sign-in, as when Chrome moves it into another of its
// profiles, against the kit's real Clerk development instance. Clerk keeps a sign-in in the client of the browser that
// started it, so this browser, with a client of its own, finishes nothing; the gate then goes to Google once more from
// here, for the account the app asked for. Google itself is not reached: its address is answered here, since signing
// in there takes a person.
import { expect, test } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

const HAND_OVER = `/desktop-sign-in?${new URLSearchParams({ nonce: 'b'.repeat(64), account: 'ana@example.com' })}`;

test('a Google return this browser did not start goes to Google once more by itself, naming the account the app asked for', async ({ page, context }) => {
  await setupClerkTestingToken({ context });
  const google: URL[] = [];
  await context.route(
    (url) => url.hostname === 'accounts.google.com',
    (route) => {
      google.push(new URL(route.request().url()));
      return route.fulfill({ contentType: 'text/html', body: '<h1>Google</h1>' });
    },
  );
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.text().startsWith('[app-kit')) lines.push(message.text());
  });
  // The address Google's return carries, landing in a browser whose Clerk client started nothing.
  await page.goto(`/sso-callback?${new URLSearchParams({ return_to: HAND_OVER })}`);
  await expect(page.getByRole('heading', { name: 'Google' })).toBeVisible();
  console.log(`[clerk e2e] moved return: ${lines.join(' | ')}`);
  expect(google).toHaveLength(1);
  expect(google[0]!.searchParams.get('login_hint')).toBe('ana@example.com');
  expect(lines).toContain('[app-kit clerk] back from Google: Clerk ended with no session in this browser');
});
