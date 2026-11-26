// The trip to Microsoft against the kit's real Clerk development instance, which has Microsoft on with Clerk's shared
// credentials: the address Clerk sends the browser to names the account the app asked for, or asks Microsoft for its
// list. Microsoft itself is not reached: its address is answered here, since signing in there takes a person.
import { expect, test, type BrowserContext } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

/** The desktop sign-in page Apple's sheet opens for Microsoft, where the gate goes to the provider by itself. */
const sheetPage = (account: string) => `/desktop-sign-in?${new URLSearchParams({ nonce: 'c'.repeat(64), account, with: 'microsoft' })}`;

/** Every address the browser was sent to at Microsoft's sign-in, answered with a page of its own. */
async function microsoftAddresses(context: BrowserContext) {
  const seen: URL[] = [];
  await context.route(
    (url) => url.hostname === 'login.microsoftonline.com' || url.hostname === 'login.live.com' || url.hostname === 'accounts.google.com',
    (route) => {
      seen.push(new URL(route.request().url()));
      return route.fulfill({ contentType: 'text/html', body: '<h1>Microsoft</h1>' });
    },
  );
  return seen;
}

test('Continue as goes to Microsoft naming the account the app asked for', async ({ page, context }) => {
  await setupClerkTestingToken({ context });
  const seen = await microsoftAddresses(context);
  await page.goto(sheetPage('ana@example.com'));
  await expect(page.getByRole('heading', { name: 'Microsoft' })).toBeVisible();
  console.log(`[clerk e2e] Microsoft, an account named: ${seen.map((url) => url.href).join(' | ')}`);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.hostname).toBe('login.microsoftonline.com');
  expect(seen[0]!.searchParams.get('login_hint')).toBe('ana@example.com');
});

test('Use a different account asks Microsoft for its list of accounts', async ({ page, context }) => {
  await setupClerkTestingToken({ context });
  const seen = await microsoftAddresses(context);
  await page.goto(sheetPage('choose'));
  await expect(page.getByRole('heading', { name: 'Microsoft' })).toBeVisible();
  console.log(`[clerk e2e] Microsoft, its list asked for: ${seen.map((url) => url.href).join(' | ')}`);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.hostname).toBe('login.microsoftonline.com');
  expect(seen[0]!.searchParams.get('prompt')).toBe('select_account');
  expect(seen[0]!.searchParams.get('login_hint')).toBeNull();
});
