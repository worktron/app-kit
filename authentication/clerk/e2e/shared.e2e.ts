// The five signed-in tests on one user the worker signed in once, then a test that signs out with a user of its own,
// then one more on the shared user, which must still be signed in.
import { test as base, expect } from '@playwright/test';
import { signInWithTicket, testSignedInPerWorker, throwawayUser } from '../playwright.js';
import { countClerkRequests, FIVE } from './five-tests';
import { countedApi, DOMAIN, PREFIX, secretKey } from './names';

/** The users the app's clean-account step was given, in order, one before each test on the shared user. */
const cleaned: string[] = [];

const test = testSignedInPerWorker(base, {
  secretKey: secretKey(),
  apiUrl: countedApi('shared'),
  domain: DOMAIN,
  prefix: PREFIX,
  cleanAccount: async (user) => void cleaned.push(user.userId),
});

for (const { name, run } of FIVE) {
  test(name, async ({ page, context, clerkUser }) => {
    const requests = countClerkRequests(context);
    expect(cleaned.at(-1)).toBe(clerkUser.userId);
    await run(page, clerkUser.email);
    console.log(`[clerk e2e] shared: ${name}: ${requests.all} requests to Clerk's browser side, ${requests.signIns} sign-ins`);
    expect(requests.signIns).toBe(0);
  });
}

test.describe('with a user of its own', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signing out ends only its own session', async ({ page }) => {
    const user = await throwawayUser({ secretKey: secretKey(), apiUrl: countedApi('own'), domain: DOMAIN, prefix: PREFIX });
    try {
      await page.goto('/');
      await signInWithTicket(page, await user.ticket());
      await expect(page.getByTestId('person')).toHaveText(user.email);
      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    } finally {
      await user.remove();
    }
  });
});

test('the shared user is still signed in after another test signed out', async ({ page, clerkUser }) => {
  await page.goto('/');
  await expect(page.getByTestId('person')).toHaveText(clerkUser.email);
  expect(new Set(cleaned)).toEqual(new Set([clerkUser.userId]));
  expect(cleaned).toHaveLength(6);
});
